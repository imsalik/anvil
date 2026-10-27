"""Toggle virtual monitors via Mutter DisplayConfig: `single` (Meta-0 only) or `dual`."""
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION)
NAME = "org.gnome.Mutter.DisplayConfig"
PATH = "/org/gnome/Mutter/DisplayConfig"


def call(method, params=None, reply=None):
    return bus.call_sync(NAME, PATH, NAME, method, params, reply, Gio.DBusCallFlags.NONE, -1, None).unpack()


serial, monitors, _logical, _props = call("GetCurrentState")
modes = {}
for (connector, *_), mode_list, _p in monitors:
    pref = next((m for m in mode_list if m[6].get("is-preferred")), mode_list[0])
    modes[connector] = pref[0]

logical = [(0, 0, 1.0, 0, True, [("Meta-0", modes["Meta-0"], {})])]
if sys.argv[1] == "dual":
    logical.append((2560, 0, 1.0, 0, False, [("Meta-1", modes["Meta-1"], {})]))

call(
    "ApplyMonitorsConfig",
    GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", (serial, 1, logical, {})),
)
print(sys.argv[1], "applied")
