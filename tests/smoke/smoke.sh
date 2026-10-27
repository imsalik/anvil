#!/usr/bin/env bash
# Headless smoke test of per-monitor workspaces in an isolated gnome-shell.
# Usage: make build debug && tests/smoke/smoke.sh tests/smoke/<name>.steps
# Steps: a JS expression run via Shell.Eval, "# comment", "sleep N", "spawn CLASS" (kitty), or "!shell cmd".
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
D=$HOME/.cache/forge-smoke
UUID=forge@saliksalam
EXT=$D/data/gnome-shell/extensions/$UUID
rm -rf "$D" && mkdir -p "$EXT" "$D/config"
cp -r "$REPO"/temp/* "$EXT"
export XDG_CONFIG_HOME=$D/config XDG_DATA_HOME=$D/data
STEPS=$(realpath "$1")
exec dbus-run-session -- bash -c '
set -u
gs() { gsettings "$@"; }
fs() { gsettings --schemadir "'"$EXT"'/schemas" set org.gnome.shell.extensions.forge "$@"; }
gs set org.gnome.shell enabled-extensions "[\"'"$UUID"'\"]"
gs set org.gnome.mutter dynamic-workspaces false
gs set org.gnome.desktop.wm.preferences num-workspaces 6
fs monitor-workspaces-enabled true
fs monitor-workspaces "1:3,5"
fs monitor-bar-enabled true
gnome-shell --headless --wayland --unsafe-mode --wayland-display=wl-smoke \
  --virtual-monitor 2560x1440 --virtual-monitor 1920x1080 >"'"$D"'/shell.log" 2>&1 &
SHELL_PID=$!
sleep 8
ev() { gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell -m org.gnome.Shell.Eval "$1" | sed -E "s/^\(true, //; s/\)$//"; }
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in
    "#"*) echo "$line" ;;
    "!"*) bash -c "${line#!}" ;;
    sleep\ *) sleep ${line#sleep } ;;
    spawn\ *) WAYLAND_DISPLAY=wl-smoke kitty --class "${line#spawn }" -T "${line#spawn }" -e sleep 600 >/dev/null 2>&1 & sleep 2 ;;
    *) echo "> ${line:0:90}"; ev "$line"; echo ;;
  esac
done < "'"$STEPS"'"
kill $SHELL_PID; wait 2>/dev/null
'
