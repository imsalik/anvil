# Developing Anvil

Anvil is my personal fork of [Forge](https://github.com/forge-ext/forge), based on
[jcrussell/forge](https://github.com/jcrussell/forge). This page covers building,
testing and code style.

## Prerequisites

- **Node.js 20+** and **gettext**
- A GNOME Shell 45+ session for manual testing (X11 or Wayland)

## Set up & build

```bash
npm install        # dependencies + git hooks

make dev           # compile schemas + install to ~/.local/share/gnome-shell/extensions/
make prod          # like dev, then enable + restart shell
```

Apply changes: on X11, `Alt+F2` → `r` → Enter; on Wayland, log out/in, or use a
nested session that needs no restart:

```bash
make test          # build + launch a nested Wayland GNOME Shell (no restart needed)
make test-x        # build + restart gnome-shell (X11)
make log           # tail Forge's logs
```

## Tests

```bash
npm test                 # unit tests (Vitest, mocked GNOME APIs)
make unit-test-docker    # the same, in the canonical Docker environment
make e2e-test            # end-to-end tests against real GNOME Shell in Docker
make test-devkit         # nested shell with two virtual monitors, isolated config dirs
```

Per-monitor workspace smoke tests run a headless dual-monitor shell (after
`make build debug`):

```bash
tests/smoke/smoke.sh tests/smoke/monitor-workspaces.steps
tests/smoke/smoke.sh tests/smoke/monitor-workspaces-drag.steps
tests/smoke/smoke.sh tests/smoke/monitor-hotplug.steps
tests/smoke/smoke.sh tests/smoke/monitor-focus.steps
```

- Unit-test guide (fixtures, mocks, avoiding vacuous tests):
  [tests/README.md](tests/README.md).
- E2E infrastructure: [tests/e2e/README.md](tests/e2e/README.md).

New behavior should come with a test. Unit tests must drive real `lib/` code, not
reimplement it. A test that can't go red when you break the code under test isn't
testing anything.

## Code style

- **Prettier**, 2-space indent, 100-char width. Run `npm run format`; `npm run lint`
  checks. A pre-commit hook formats staged files and runs the related unit tests, so
  commits are gated automatically.
- Match the surrounding code's naming and idioms.
- Core classes are `GObject`s registered with the
  `static { GObject.registerClass(this); }` pattern; track signal IDs and disconnect
  them on teardown (see [docs/dev/architecture.md](docs/dev/architecture.md)).

## Understanding the codebase

Start with [docs/dev/](docs/dev/): architecture (lifecycle, tree model, dispatch,
signal discipline), rendering (the placement pipeline), and compat (Mutter version
shims). The user-facing behavior is documented in [docs/user/](docs/user/).

## Translations

User-facing strings are wrapped in `_("...")` and localized with gettext. When you
add or change a string, run `make update-pot` and commit `po/forge.pot`. Catalogs
(`po/<lang>.po`) are maintained manually via `make update-po`.
Full workflow: [docs/dev/translations.md](docs/dev/translations.md).

## Making changes

Work happens on `main`. Make the change with a test, run `npm test` and
`npm run lint`, then commit. The pre-commit hook also runs `ruff` on the Python
smoke and e2e helpers, so it needs `ruff` installed.

GNOME compatibility matters: changes should work on GNOME 45+ across X11 and
Wayland. Mutter API differences belong in `lib/extension/compat.js`
([docs/dev/compat.md](docs/dev/compat.md)), not scattered through the codebase.

## Releases

There are none: Anvil is not on extensions.gnome.org, and it is installed from
source (see the [README](README.md)).

## Syncing with the base fork

`jc` is the [jcrussell/forge](https://github.com/jcrussell/forge) remote:

```bash
git fetch jc && git merge jc/main
```
