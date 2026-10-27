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
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GnomeDesktop from "gi://GnomeDesktop";
import St from "gi://St";

// Gnome Shell imports
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Shared state
import { Logger } from "../shared/logger.js";

/** Workspace number buttons for the workspaces one monitor owns. */
class WorkspacePills {
  constructor(mws, monitor) {
    this._mws = mws;
    this.monitor = monitor;
    this.actor = new St.BoxLayout({
      style_class: "forge-ws-pills",
      y_align: Clutter.ActorAlign.CENTER,
    });
  }

  update() {
    this.actor.destroy_all_children();
    const shown = this._mws.shownOn(this.monitor);
    for (const ws of this._mws.workspacesOf(this.monitor)) {
      const classes = ["forge-ws-pill"];
      if (ws === shown) classes.push("active");
      else if (this._mws.windowCount(ws) === 0) classes.push("empty");
      const button = new St.Button({
        style_class: classes.join(" "),
        label: `${ws + 1}`,
        y_align: Clutter.ActorAlign.CENTER,
      });
      // eslint-disable-next-line local/no-untracked-connect -- button is destroyed with its parent in update()/destroy().
      button.connect("clicked", () => this._mws.focusWorkspace(ws));
      this.actor.add_child(button);
    }
  }

  destroy() {
    this.actor.destroy();
  }
}

/**
 * Workspace pills in the main panel (primary monitor) plus a bar with pills
 * and a clock on each secondary monitor.
 */
export class MonitorBars {
  /** @type {WorkspacePills[]} */
  _pills = [];

  /** @type {St.BoxLayout[]} */
  _bars = [];

  /** @type {St.Label[]} */
  _clocks = [];

  _signals = [];
  _updateSrcId = 0;

  constructor(ext) {
    this.ext = ext;
  }

  enable() {
    if (this._stylesheet) return;
    const mws = this.ext.monitorWorkspaces;
    this._stylesheet = this.ext.dir.get_child("monitor-bar.css");
    St.ThemeContext.get_for_stage(/** @type {Clutter.Stage} */ (global.stage))
      .get_theme()
      .load_stylesheet(this._stylesheet);

    this._wallClock = new GnomeDesktop.WallClock();
    this._changedCb = mws.connectChanged(() => this._queueUpdate());
    const display = global.display;
    const wsm = global.workspace_manager;
    this._signals = [
      [this._wallClock, this._wallClock.connect("notify::clock", () => this._updateClocks())],
      [Main.layoutManager, Main.layoutManager.connect("monitors-changed", () => this._rebuild())],
      [display, display.connect("window-created", () => this._queueUpdate())],
      [display, display.connect("window-entered-monitor", () => this._queueUpdate())],
      [display, display.connect("window-left-monitor", () => this._queueUpdate())],
      [wsm, wsm.connect("workspace-switched", () => this._queueUpdate())],
      [global.window_manager, global.window_manager.connect("destroy", () => this._queueUpdate())],
    ];
    this._rebuild();
  }

  disable() {
    if (!this._stylesheet) return;
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    this.ext.monitorWorkspaces?.disconnectChanged(this._changedCb);
    if (this._updateSrcId) GLib.source_remove(this._updateSrcId);
    this._updateSrcId = 0;
    this._teardown();
    this._wallClock = null;
    St.ThemeContext.get_for_stage(/** @type {Clutter.Stage} */ (global.stage))
      .get_theme()
      .unload_stylesheet(this._stylesheet);
    this._stylesheet = null;
  }

  _teardown() {
    for (const pills of this._pills) pills.destroy();
    for (const bar of this._bars) {
      Main.layoutManager.removeChrome(bar);
      bar.destroy();
    }
    this._pills = [];
    this._bars = [];
    this._clocks = [];
  }

  _rebuild() {
    this._teardown();
    const mws = this.ext.monitorWorkspaces;
    const primary = global.display.get_primary_monitor();

    const primaryPills = new WorkspacePills(mws, primary);
    /** @type {any} */ (Main.panel)._leftBox.insert_child_at_index(primaryPills.actor, 0);
    this._pills.push(primaryPills);

    for (let m = 0; m < global.display.get_n_monitors(); m++) {
      if (m === primary) continue;
      const rect = global.display.get_monitor_geometry(m);
      const bar = new St.BoxLayout({
        style_class: "forge-monitor-bar",
        reactive: true,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: Main.panel.height || 32,
      });
      const pills = new WorkspacePills(mws, m);
      const left = new St.BoxLayout({ x_expand: true });
      left.add_child(pills.actor);
      const clock = new St.Label({
        style_class: "forge-monitor-bar-clock",
        y_align: Clutter.ActorAlign.CENTER,
      });
      bar.add_child(left);
      bar.add_child(clock);
      bar.add_child(new St.Widget({ x_expand: true }));
      Main.layoutManager.addChrome(bar, { affectsStruts: true, trackFullscreen: true });
      this._bars.push(bar);
      this._pills.push(pills);
      this._clocks.push(clock);
    }
    this._update();
    this._updateClocks();
  }

  _queueUpdate() {
    if (this._updateSrcId) return;
    this._updateSrcId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._updateSrcId = 0;
      this._update();
      return GLib.SOURCE_REMOVE;
    });
  }

  _update() {
    try {
      for (const pills of this._pills) pills.update();
    } catch (e) {
      Logger.warn(`monitor-bar update: ${e}`);
    }
  }

  _updateClocks() {
    const text = this._wallClock?.clock ?? "";
    for (const clock of this._clocks) clock.text = text;
  }
}
