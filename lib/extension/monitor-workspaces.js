/*
 * This file is part of the Forge extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import GLib from "gi://GLib";
import Meta from "gi://Meta";

// Gnome Shell imports
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import * as Compat from "./compat.js";
import * as Utils from "./utils.js";

/** @typedef {import('gi://Meta').default.Window & { _forgeMwsStuck?: boolean, _forgeMwsIndex?: number }} MwsWindow */

/**
 * Parse `monitor-workspaces`: "DP-5:3,5;HDMI-1:7" (1-based workspace numbers).
 * A monitor may also be given by index ("1:3,5").
 * @param {string} spec
 * @returns {Map<string, number[]>} monitor key → 0-based workspace indices
 */
export function parseMonitorWorkspaces(spec) {
  const result = new Map();
  if (!spec) return result;
  for (const entry of spec.split(";")) {
    const sep = entry.lastIndexOf(":");
    if (sep <= 0) continue;
    const key = entry.slice(0, sep).trim();
    const indices = entry
      .slice(sep + 1)
      .split(",")
      .map((n) => parseInt(n.trim(), 10) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0);
    if (key && indices.length)
      result.set(
        key,
        [...new Set(indices)].sort((a, b) => a - b)
      );
  }
  return result;
}

/**
 * Resolve workspace ownership: every workspace belongs to exactly one monitor;
 * unclaimed ones (and those of absent monitors) go to the primary.
 * @param {Map<string, number[]>} spec - from parseMonitorWorkspaces
 * @param {number} nWorkspaces
 * @param {number} primary - primary monitor index
 * @param {(key: string) => number} resolveMonitor - monitor key → index, -1 if absent
 * @returns {number[]} owner monitor index per workspace index
 */
export function resolveOwners(spec, nWorkspaces, primary, resolveMonitor) {
  const owners = new Array(nWorkspaces).fill(primary);
  for (const [key, indices] of spec) {
    const monitor = resolveMonitor(key);
    if (monitor < 0 || monitor === primary) continue;
    for (const ws of indices) if (ws < nWorkspaces) owners[ws] = monitor;
  }
  return owners;
}

/**
 * Hyprland-style per-monitor workspaces on top of Mutter's global ones.
 *
 * The primary monitor shows Mutter's active workspace. A secondary monitor shows
 * its own workspace by making that workspace's windows sticky; windows of its
 * other workspaces sit unstuck on their Mutter workspace, which is never
 * activated, so Mutter hides them. Requires workspaces-only-on-primary=false.
 */
export class MonitorWorkspaces {
  /** @type {number[]} owner monitor per workspace index */
  _owners = [];

  /** @type {Map<number, number>} secondary monitor → shown workspace index */
  _shown = new Map();

  /** @type {Set<() => void>} */
  _listeners = new Set();

  _signals = [];
  _busy = false;
  _lastPrimaryWs = 0;
  _reconcileSrcId = 0;

  constructor(ext) {
    this.ext = ext;
  }

  get enabled() {
    return this._signals.length > 0;
  }

  enable() {
    if (this.enabled) return;
    const display = global.display;
    const wsm = global.workspace_manager;
    this._lastPrimaryWs = wsm.get_active_workspace_index();
    this._signals = [
      [display, display.connect("window-entered-monitor", (_d, _m, w) => this._reconcile(w))],
      [display, display.connect("window-created", () => this._queueReconcileAll())],
      [wsm, wsm.connect("active-workspace-changed", () => this._onActiveWorkspaceChanged())],
      [wsm, wsm.connect("notify::n-workspaces", () => this.reload())],
      [Main.layoutManager, Main.layoutManager.connect("monitors-changed", () => this.reload())],
      [
        this.ext.settings,
        this.ext.settings.connect("changed::monitor-workspaces", () => this.reload()),
      ],
    ];
    this.reload();
  }

  disable() {
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    if (this._reconcileSrcId) GLib.source_remove(this._reconcileSrcId);
    this._reconcileSrcId = 0;
    for (const w of this._managedWindows()) {
      if (w._forgeMwsStuck) {
        w._forgeMwsStuck = false;
        w.unstick();
      }
      delete w._forgeMwsIndex;
    }
    this._shown.clear();
    this._owners = [];
    this._emit();
  }

  /** @param {() => void} cb */
  connectChanged(cb) {
    this._listeners.add(cb);
    return cb;
  }

  disconnectChanged(cb) {
    this._listeners.delete(cb);
  }

  _emit() {
    for (const cb of this._listeners) {
      try {
        cb();
      } catch (e) {
        Logger.warn(`monitor-workspaces listener: ${e}`);
      }
    }
  }

  get primary() {
    return global.display.get_primary_monitor();
  }

  /** @returns {number} owner monitor of a workspace index */
  ownerOf(ws) {
    return this._owners[ws] ?? this.primary;
  }

  /** @returns {number[]} workspace indices owned by a monitor */
  workspacesOf(monitor) {
    return this._owners.flatMap((owner, ws) => (owner === monitor ? [ws] : []));
  }

  /** @returns {number} workspace index currently shown on a monitor */
  shownOn(monitor) {
    if (monitor === this.primary || !this._shown.has(monitor)) {
      return global.workspace_manager.get_active_workspace_index();
    }
    return /** @type {number} */ (this._shown.get(monitor));
  }

  _resolveMonitor(key) {
    if (/^\d+$/.test(key)) {
      const idx = parseInt(key, 10);
      return idx < global.display.get_n_monitors() ? idx : -1;
    }
    return global.backend.get_monitor_manager().get_monitor_for_connector(key);
  }

  reload() {
    if (!this.enabled) return;
    const spec = parseMonitorWorkspaces(this.ext.settings.get_string("monitor-workspaces"));
    const nWs = global.workspace_manager.get_n_workspaces();
    this._owners = resolveOwners(spec, nWs, this.primary, (k) => this._resolveMonitor(k));

    const shown = new Map();
    for (let m = 0; m < global.display.get_n_monitors(); m++) {
      if (m === this.primary) continue;
      const owned = this.workspacesOf(m);
      if (!owned.length) continue;
      const prev = this._shown.get(m);
      shown.set(m, prev !== undefined && owned.includes(prev) ? prev : owned[0]);
    }
    this._shown = shown;
    if (this.ownerOf(this._lastPrimaryWs) !== this.primary) {
      this._lastPrimaryWs = this.workspacesOf(this.primary)[0] ?? 0;
    }
    this._reconcileAll();
    this._emit();
  }

  /** Normal, user-facing windows this feature manages. */
  /** @returns {MwsWindow[]} */
  _managedWindows() {
    return global.display
      .get_tab_list(Meta.TabList.NORMAL_ALL, null)
      .filter((w) => Utils.isWindowAlive(w) && !w.skip_taskbar);
  }

  _queueReconcileAll() {
    if (this._reconcileSrcId) return;
    // New windows report monitor -1 until placed; settle before enforcing.
    this._reconcileSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      this._reconcileSrcId = 0;
      this._reconcileAll();
      return GLib.SOURCE_REMOVE;
    });
  }

  _reconcileAll() {
    for (const w of this._managedWindows()) this._reconcile(w);
    this._emit();
  }

  /**
   * Enforce: a window's workspace is owned by the monitor it is on, and it is
   * stuck exactly when that workspace is shown on a secondary monitor.
   */
  _reconcile(w) {
    if (this._busy || !this.enabled || !Utils.isWindowAlive(w) || w.skip_taskbar) return;
    // A user "Always on Visible Workspace" pin is not ours to manage.
    if (!w._forgeMwsStuck && Compat.isAlwaysOnAllWorkspaces(w)) return;
    const monitor = w.get_monitor();
    if (monitor < 0) return;
    const ws = Utils.effectiveWorkspace(w)?.index() ?? -1;

    if (monitor === this.primary) {
      if (w._forgeMwsStuck || ws < 0 || this.ownerOf(ws) !== monitor) {
        this._place(w, this.shownOn(monitor));
      }
      return;
    }
    if (!this._shown.has(monitor)) return;
    if (ws < 0 || this.ownerOf(ws) !== monitor) {
      this._place(w, this.shownOn(monitor));
    } else if (Boolean(w._forgeMwsStuck) !== (ws === this.shownOn(monitor))) {
      this._place(w, ws);
    }
  }

  /** Put a window on workspace `ws`, stuck iff `ws` is shown on a secondary. */
  _place(w, ws) {
    const owner = this.ownerOf(ws);
    const stick = owner !== this.primary && this._shown.get(owner) === ws;
    this._busy = true;
    try {
      w._forgeMwsIndex = ws;
      if (w._forgeMwsStuck && !stick) {
        w._forgeMwsStuck = false;
        w.unstick();
      }
      if (w.get_monitor() !== owner) w.move_to_monitor(owner);
      w.change_workspace_by_index(ws, false);
      if (stick && !w._forgeMwsStuck) {
        w._forgeMwsStuck = true;
        w.stick();
      }
      if (owner === this.primary) delete w._forgeMwsIndex;
    } finally {
      this._busy = false;
    }
    this.ext.extWm?.updateMetaWorkspaceMonitor("monitor-workspaces", owner, w);
  }

  _onActiveWorkspaceChanged() {
    if (this._busy) return;
    const active = global.workspace_manager.get_active_workspace_index();
    if (this.ownerOf(active) === this.primary) {
      this._lastPrimaryWs = active;
      this._emit();
      return;
    }
    // Something (overview, GNOME bindings) activated a secondary-owned
    // workspace: keep the primary where it was and show it on its monitor.
    const back = global.workspace_manager.get_workspace_by_index(this._lastPrimaryWs);
    this._busy = true;
    try {
      back?.activate(global.get_current_time());
    } finally {
      this._busy = false;
    }
    this.focusWorkspace(active);
  }

  /** Show workspace `ws` on its monitor and focus that monitor (Super+N). */
  focusWorkspace(ws) {
    if (!this.enabled || ws < 0 || ws >= this._owners.length) return;
    const owner = this.ownerOf(ws);
    const time = global.get_current_time();
    if (owner === this.primary) {
      const target = global.workspace_manager.get_workspace_by_index(ws);
      if (ws !== global.workspace_manager.get_active_workspace_index()) {
        target?.activate(time);
      }
    } else if (this._shown.get(owner) !== ws) {
      const prev = this._shown.get(owner);
      this._shown.set(owner, ws);
      for (const w of this._managedWindows()) {
        if (w.get_monitor() !== owner) continue;
        const wws = Utils.effectiveWorkspace(w)?.index();
        if (wws === prev || wws === ws) this._place(w, /** @type {number} */ (wws));
      }
    }
    this._focusMonitor(owner, ws, time);
    this._emit();
  }

  /** Move the focused window to workspace `ws` without following (Super+Shift+N). */
  moveFocusedWindowTo(ws) {
    const w = /** @type {MwsWindow | null} */ (global.display.get_focus_window());
    if (!this.enabled || !w || ws < 0 || ws >= this._owners.length) return;
    if (!w._forgeMwsStuck && Compat.isAlwaysOnAllWorkspaces(w)) return;
    this._place(w, ws);
    this._emit();
  }

  _focusMonitor(monitor, ws, time) {
    const top = global.display
      .get_tab_list(Meta.TabList.NORMAL_ALL, null)
      .find(
        (w) =>
          Utils.isWindowAlive(w) &&
          !w.minimized &&
          w.get_monitor() === monitor &&
          Utils.effectiveWorkspace(w)?.index() === ws
      );
    if (top) {
      top.activate(time);
      return;
    }
    const rect = global.display.get_monitor_geometry(monitor);
    Compat.getClutterBackend()
      .get_default_seat()
      ?.warp_pointer(rect.x + rect.width / 2, rect.y + rect.height / 2);
    global.display.focus_default_window(time);
  }

  /** @returns {number} windows on workspace `ws` (on its owner monitor) */
  windowCount(ws) {
    const owner = this.ownerOf(ws);
    return this._managedWindows().filter(
      (w) => w.get_monitor() === owner && Utils.effectiveWorkspace(w)?.index() === ws
    ).length;
  }
}
