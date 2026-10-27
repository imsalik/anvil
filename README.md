# Anvil

My personal fork of [Forge](https://github.com/forge-ext/forge), the GNOME Shell extension for i3/sway-style tiling. It is based on [jcrussell/forge](https://github.com/jcrussell/forge), the actively maintained fork, and adds what I need for a dual-monitor GNOME 50 setup: Hyprland-style per-monitor workspaces and a workspace bar on every monitor.

Anvil installs as `anvil@imsalik`, so updates to Forge from extensions.gnome.org never overwrite it. It reuses Forge's GSettings schemas and `~/.config/forge` paths, so existing Forge settings, keybindings and window rules carry over as-is.

## What Anvil adds

### Per-monitor workspaces

Each workspace belongs to one monitor, like Hyprland's workspace rules. For example, pin workspaces 3 and 5 to the secondary monitor and keep the rest on the primary.

- `Super+1..9` shows that workspace on its own monitor without changing what the other monitor shows.
- `Super+Shift+1..9` sends the focused window to that workspace without following it.
- Switching to an empty workspace on another monitor moves the pointer there, so new windows open on that monitor.
- Dragging a window to another monitor moves it to the workspace that monitor is showing.
- Windows keep their workspace when a monitor is unplugged and plugged back in (tested with virtual monitors, not yet with a real dock).
- Configure it under **Preferences → Monitors**: one switch for the feature, and a monitor picker for each workspace. Unassigned workspaces stay on the primary. Monitors are listed by connector (for example `DP-5`), and a configured monitor that is disconnected stays in the list, marked "disconnected".

Per-monitor workspaces and the bar have only been tested on GNOME 50 (Wayland).

While the feature is on, Anvil turns off GNOME's "workspaces on primary display only" and its default `Super+N` workspace and app shortcuts. It restores them when the feature or the extension is turned off.

### Workspace bar on every monitor

- Workspace pills in the top panel on the primary monitor, plus a panel with pills and a clock on each secondary monitor.
- The secondary panel copies the main panel's style classes, so it follows the shell theme and Open Bar styling.
- Hides the Activities button while the bar is on (even if another extension shows it again), and restores it when the bar is off.
- Clicking a pill switches workspace without moving the pointer.

## Inherited from Forge

- Tree-based tiling with horizontal and vertical splits, stacked and tabbed layouts, and workspace monocle
- Vim-style and arrow-key bindings to focus, swap and move windows, plus keyboard resize
- Drag-and-drop tiling, floating windows and floating rules, smart gaps, focus hint
- Auto split ("quarter tiling"), screen edge margins, monitor exclusion
- Keybinding cheatsheet (`Super+Shift+/`)
- Export and import of settings and keybindings
- GNOME 45 to 51, on X11 and Wayland

The fixes and features from jcrussell/forge (tests, refactors, app-specific fixes) are included. See the [user guide](docs/user/) for details.

**Limitations** (inherited from Forge): dynamic workspaces are not supported, and vertical/portrait monitor setups only partly work. See [multi-monitor](docs/user/monitors.md).

## Install from source

Anvil is not on extensions.gnome.org and has no release builds. Install it from source; the `main` branch is always the current version. Needs Node.js 20+ and gettext.

```bash
git clone git@github.com:imsalik/anvil.git && cd anvil
npm install
make build install          # make dev = debug build
```

Log out and back in (Wayland needs a fresh login; on X11, `Alt+F2` then `r` also works), then enable it:

```bash
gnome-extensions enable anvil@imsalik
```

Run `enable` after the re-login: until the shell has rescanned, it fails with "does not exist".

### Switching from Forge

Disable Forge first (`gnome-extensions disable forge@jmmaranan.com`), since both would tile the same windows. If you use a workspace-bar extension such as Space Bar, disable it too, because Anvil draws its own workspace pills. Your Forge settings carry over.

### Updating

```bash
git pull && make build install
```

Then log out and back in. Changes to settings and keybindings apply live, but code changes need a new shell session on Wayland.

## Configuration

- Preferences: `gnome-extensions prefs anvil@imsalik`
- Window rules: `~/.config/forge/config/windows.json` ([window rules](docs/user/rules.md))
- Stylesheet overrides: `~/.config/forge/stylesheet/forge/stylesheet.css` ([theming](docs/user/theming.md))
- Per-monitor workspaces from the command line, using the `monitor-workspaces`, `monitor-workspaces-enabled` and `monitor-bar-enabled` keys of `org.gnome.shell.extensions.forge`. The format is `CONNECTOR:workspaces`, with workspaces 1-based and monitors separated by `;`:

  ```bash
  gsettings --schemadir ~/.local/share/gnome-shell/extensions/anvil@imsalik/schemas \
    set org.gnome.shell.extensions.forge monitor-workspaces 'DP-5:3,5'
  ```

## Docs

- [User guide](docs/user/): [layouts](docs/user/layouts.md), [keybindings](docs/user/keybindings.md), [theming](docs/user/theming.md), [window rules](docs/user/rules.md), [portable config](docs/user/config.md), [multi-monitor](docs/user/monitors.md), [troubleshooting](docs/user/troubleshooting.md)
- [Developer reference](docs/dev/): architecture, rendering pipeline, Mutter compatibility, hazards

## Development

Run `make help` for every target. The ones I use most:

- `npm test`: unit tests (Vitest, mocked GNOME APIs)
- `npm run lint:src`, `npm run typecheck`: ESLint and `tsc`
- `make test-devkit`: nested shell with two virtual monitors, using its own config and cache dirs so it doesn't touch the desktop session
- `tests/smoke/smoke.sh tests/smoke/<name>.steps` (after `make build debug`): headless dual-monitor smoke tests for per-monitor workspaces, drag and hotplug
- `make e2e-test`: Dockerized end-to-end tests against real GNOME Shell

More in [CONTRIBUTING.md](CONTRIBUTING.md) and [tests/README.md](tests/README.md).

### Keeping up with the base fork

Remotes: `origin` is this repo, `jc` is [jcrussell/forge](https://github.com/jcrussell/forge) (the base) and `upstream` is [forge-ext/forge](https://github.com/forge-ext/forge).

```bash
git fetch jc && git merge jc/main
```

## Credits

- [@jmmaranan](https://github.com/jmmaranan) and the [Forge contributors](https://github.com/forge-ext/forge), for creating Forge
- [@jcrussell](https://github.com/jcrussell) and contributors to [jcrussell/forge](https://github.com/jcrussell/forge), for keeping it alive
- Michael Stapelberg and contributors to i3; System76 and contributors to pop-shell; ReworkCSS for css-parse/css-stringify

Licensed under the [GPL-3.0](LICENSE), like Forge.
