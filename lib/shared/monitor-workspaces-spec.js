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

// `monitor-workspaces` spec helpers, shared by the extension and prefs.

/** Monitor keys that name a role instead of a connector. */
export const MONITOR_ROLES = ["primary", "secondary", "builtin"];

/** Connectors Mutter treats as built-in panels. */
export const BUILTIN_CONNECTORS = ["eDP-1", "eDP-2", "LVDS-1", "LVDS-2", "DSI-1", "DSI-2"];

/** @param {string} connector */
export function isBuiltinConnector(connector) {
  return /^(eDP|LVDS|DSI)-/.test(connector);
}

/**
 * Monitor for a role. Secondary is the leftmost non-primary external monitor,
 * else a non-primary built-in one.
 * @param {string} role
 * @param {{ primary: boolean, builtin: boolean, x: number, y: number }[]} monitors
 * @returns {number} index into `monitors`, -1 if none
 */
export function resolveRole(role, monitors) {
  const indexed = monitors.map((m, i) => ({ ...m, i }));
  if (role === "primary") return indexed.find((m) => m.primary)?.i ?? -1;
  if (role === "builtin") return indexed.find((m) => m.builtin)?.i ?? -1;
  if (role !== "secondary") return -1;
  const others = indexed
    .filter((m) => !m.primary)
    .sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.x - b.x || a.y - b.y);
  return others[0]?.i ?? -1;
}

/**
 * Parse `monitor-workspaces`: "secondary:3,5;DP-5:7" (1-based workspace numbers).
 * A monitor is a role (MONITOR_ROLES), a connector, or an index ("1:3,5").
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
 * Serialize a monitor → 0-based workspace indices map back to the spec string.
 * @param {Map<string, number[]>} spec
 * @returns {string}
 */
export function formatMonitorWorkspaces(spec) {
  return [...spec]
    .filter(([, indices]) => indices.length)
    .map(
      ([key, indices]) =>
        `${key}:${[...indices]
          .sort((a, b) => a - b)
          .map((i) => i + 1)
          .join(",")}`
    )
    .join(";");
}

/**
 * Reassign workspaces 0..keys.length-1: keys[ws] is the owning monitor key, or
 * "" for the primary. Entries for higher workspaces are kept.
 * @param {Map<string, number[]>} spec
 * @param {string[]} keys
 * @returns {Map<string, number[]>}
 */
export function assignWorkspaces(spec, keys) {
  const result = new Map();
  for (const [key, indices] of spec)
    result.set(
      key,
      indices.filter((ws) => ws >= keys.length)
    );
  keys.forEach((key, ws) => {
    if (key) result.set(key, [...(result.get(key) ?? []), ws]);
  });
  return result;
}
