import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import { Logger } from "../shared/logger.js";
import {
  MONITOR_ROLES,
  parseMonitorWorkspaces,
  formatMonitorWorkspaces,
  assignWorkspaces,
  isBuiltinConnector,
  resolveRole,
} from "../shared/monitor-workspaces-spec.js";

import { PreferencesPage, SwitchRow } from "./widgets.js";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * Active monitors from Mutter's DisplayConfig, primary first.
 * Falls back to GDK (no display names or primary flag) if D-Bus fails.
 * @returns {{ connector: string, name: string, primary: boolean, builtin: boolean, x: number, y: number }[]}
 */
export function listMonitors() {
  try {
    const reply = Gio.DBus.session.call_sync(
      "org.gnome.Mutter.DisplayConfig",
      "/org/gnome/Mutter/DisplayConfig",
      "org.gnome.Mutter.DisplayConfig",
      "GetCurrentState",
      null,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null
    );
    /** @type {[number, [string[], unknown, Record<string, string>][], [number, number, number, number, boolean, string[][]][]]} */
    const [, monitors, logicalMonitors] = /** @type {any} */ (reply.recursiveUnpack());
    const primaries = new Set(
      logicalMonitors.filter((lm) => lm[4]).flatMap((lm) => lm[5].map((spec) => spec[0]))
    );
    const origins = new Map(
      logicalMonitors.flatMap((lm) => lm[5].map((spec) => [spec[0], { x: lm[0], y: lm[1] }]))
    );
    return monitors
      .filter(([[connector]]) => origins.has(connector))
      .map(([[connector, vendor, product], , props]) => ({
        connector,
        name: props["display-name"] || `${vendor} ${product}`.trim(),
        primary: primaries.has(connector),
        builtin: Boolean(props["is-builtin"]) || isBuiltinConnector(connector),
        ...(origins.get(connector) ?? { x: 0, y: 0 }),
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  } catch (e) {
    Logger.warn(`monitors: DisplayConfig unavailable, using GDK: ${e}`);
  }
  const list = Gdk.Display.get_default()?.get_monitors();
  const result = [];
  for (let i = 0; list && i < list.get_n_items(); i++) {
    const monitor = /** @type {Gdk.Monitor} */ (list.get_item(i));
    const connector = monitor.get_connector() ?? `${i}`;
    const { x, y } = monitor.get_geometry();
    result.push({
      connector,
      name: monitor.get_model() ?? "",
      primary: i === 0,
      builtin: isBuiltinConnector(connector),
      x,
      y,
    });
  }
  return result;
}

export class MonitorsPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  /** @type {Adw.ComboRow[]} */
  _rows = [];

  /** @type {string[]} monitor key per combo index; "" is the primary */
  _choices = [];

  _syncing = false;

  constructor({ settings }) {
    super({ title: _("Monitors"), icon_name: "video-display-symbolic" });
    this.settings = settings;

    this.add_group({
      title: _("Per-monitor workspaces"),
      description: _(
        "Each workspace lives on one monitor. Super+N shows workspace N on its monitor and focuses it; Super+Shift+N moves the focused window there"
      ),
      children: [
        new SwitchRow({
          title: _("Per-monitor workspaces"),
          subtitle: _("Turns off GNOME's workspaces-only-on-primary and takes over Super+N"),
          settings,
          bind: "monitor-workspaces-enabled",
        }),
        new SwitchRow({
          title: _("Workspace bars"),
          subtitle: _(
            "Workspace numbers in the top bar, plus a bar with workspaces and clock on other monitors"
          ),
          settings,
          bind: "monitor-bar-enabled",
        }),
      ],
    });

    this._assignGroup = this.add_group({
      title: _("Workspace assignment"),
      description: _("Pick the monitor for each workspace. Unassigned ones stay on the primary"),
      children: [],
    });
    this._build();

    const changedId = settings.connect("changed::monitor-workspaces", () => this._sync());
    this.connect("destroy", () => settings.disconnect(changedId));
  }

  _build() {
    const monitors = listMonitors();
    const spec = parseMonitorWorkspaces(this.settings.get_string("monitor-workspaces"));
    const connectorOf = (role) => monitors[resolveRole(role, monitors)]?.connector ?? _("none");

    const labels = [
      `${_("Primary")} (${connectorOf("primary")})`,
      `${_("Secondary")} (${connectorOf("secondary")})`,
    ];
    this._choices = ["", "secondary"];
    if (monitors.some((m) => m.builtin && !m.primary) || spec.has("builtin")) {
      labels.push(`${_("Built-in")} (${connectorOf("builtin")})`);
      this._choices.push("builtin");
    }
    const names = monitors.map((m) => `${m.connector}: ${m.name}`).join(", ");
    // Keep assignments that name a fixed port or index.
    for (const key of spec.keys()) {
      if (MONITOR_ROLES.includes(key)) continue;
      const connected = monitors.some((m) => m.connector === key);
      labels.push(
        /^\d+$/.test(key)
          ? `${_("Monitor")} #${key}`
          : `${key} (${connected ? _("fixed port") : _("disconnected")})`
      );
      this._choices.push(key);
    }

    const nWorkspaces = new Gio.Settings({
      schemaId: "org.gnome.desktop.wm.preferences",
    }).get_int("num-workspaces");
    for (let ws = 0; ws < Math.min(nWorkspaces, 9); ws++) {
      const row = new Adw.ComboRow({
        title: `${_("Workspace")} ${ws + 1}`,
        model: Gtk.StringList.new(labels),
      });
      row.connect("notify::selected", () => this._save());
      this._assignGroup.add(row);
      this._rows.push(row);
    }
    const limit = nWorkspaces > 9 ? ` ${_("Only workspaces 1-9 have Super+N bindings.")}` : "";
    this._assignGroup.set_description(
      `${_(
        "Pick the monitor for each workspace. Unassigned ones stay on the primary. Secondary is the leftmost other external monitor, or the built-in screen if there is none, so it survives docks renaming ports."
      )}${limit}\n${names}`
    );
    this._sync();
  }

  /** Reflect the current setting in the rows. */
  _sync() {
    const spec = parseMonitorWorkspaces(this.settings.get_string("monitor-workspaces"));
    this._syncing = true;
    try {
      this._rows.forEach((row, ws) => {
        let selected = 0;
        for (const [key, indices] of spec) {
          const idx = this._choices.indexOf(key);
          if (idx > 0 && indices.includes(ws)) selected = idx;
        }
        row.selected = selected;
      });
    } finally {
      this._syncing = false;
    }
  }

  _save() {
    if (this._syncing) return;
    const spec = assignWorkspaces(
      parseMonitorWorkspaces(this.settings.get_string("monitor-workspaces")),
      this._rows.map((row) => this._choices[row.selected] ?? "")
    );
    const value = formatMonitorWorkspaces(spec);
    if (value !== this.settings.get_string("monitor-workspaces")) {
      this.settings.set_string("monitor-workspaces", value);
    }
  }
}
