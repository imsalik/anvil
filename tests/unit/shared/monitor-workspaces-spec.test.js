import { describe, it, expect } from "vitest";
import {
  parseMonitorWorkspaces,
  resolveOwners,
  formatMonitorWorkspaces,
  assignWorkspaces,
  isBuiltinConnector,
  resolveRole,
} from "../../../lib/shared/monitor-workspaces-spec.js";

describe("parseMonitorWorkspaces", () => {
  it("returns an empty map for an empty spec", () => {
    expect(parseMonitorWorkspaces("").size).toBe(0);
  });

  it("parses connectors to 0-based, sorted, de-duplicated indices", () => {
    const spec = parseMonitorWorkspaces("DP-5:5,3,3; HDMI-1:7");
    expect(spec.get("DP-5")).toEqual([2, 4]);
    expect(spec.get("HDMI-1")).toEqual([6]);
  });

  it("accepts monitor indices and skips malformed entries", () => {
    const spec = parseMonitorWorkspaces("1:2;bogus;:3;DP-1:x,0");
    expect([...spec.keys()]).toEqual(["1"]);
    expect(spec.get("1")).toEqual([1]);
  });
});

describe("resolveOwners", () => {
  const resolve = (k) => ({ "DP-5": 1, "DP-8": 0 }[k] ?? -1);

  it("assigns listed workspaces to their monitor and the rest to the primary", () => {
    const owners = resolveOwners(parseMonitorWorkspaces("DP-5:3,5"), 6, 0, resolve);
    expect(owners).toEqual([0, 0, 1, 0, 1, 0]);
  });

  it("falls back to the primary for absent monitors and out-of-range workspaces", () => {
    const owners = resolveOwners(parseMonitorWorkspaces("HDMI-1:2;DP-5:9"), 4, 0, resolve);
    expect(owners).toEqual([0, 0, 0, 0]);
  });

  it("ignores entries naming the primary monitor", () => {
    const owners = resolveOwners(parseMonitorWorkspaces("DP-8:1"), 3, 0, resolve);
    expect(owners).toEqual([0, 0, 0]);
  });
});

describe("formatMonitorWorkspaces", () => {
  it("round-trips a parsed spec and drops empty monitors", () => {
    const spec = parseMonitorWorkspaces("DP-5:5,3;HDMI-1:7");
    spec.set("eDP-1", []);
    expect(formatMonitorWorkspaces(spec)).toBe("DP-5:3,5;HDMI-1:7");
  });
});

describe("assignWorkspaces", () => {
  it("moves workspaces between monitors and back to the primary", () => {
    const spec = assignWorkspaces(parseMonitorWorkspaces("DP-5:3,5"), [
      "",
      "DP-5",
      "",
      "",
      "HDMI-1",
      "",
    ]);
    expect(formatMonitorWorkspaces(spec)).toBe("DP-5:2;HDMI-1:5");
  });

  it("keeps assignments beyond the edited rows", () => {
    const spec = assignWorkspaces(parseMonitorWorkspaces("DP-5:3,12"), ["", "", ""]);
    expect(formatMonitorWorkspaces(spec)).toBe("DP-5:12");
  });
});

describe("resolveRole", () => {
  const mon = (primary, builtin, x, y = 0) => ({ primary, builtin, x, y });

  it("picks the leftmost non-primary external monitor as secondary", () => {
    const monitors = [
      mon(false, true, 0),
      mon(false, false, 5000),
      mon(true, false, 2000),
      mon(false, false, 4000),
    ];
    expect(resolveRole("secondary", monitors)).toBe(3);
    expect(resolveRole("primary", monitors)).toBe(2);
    expect(resolveRole("builtin", monitors)).toBe(0);
  });

  it("falls back to the built-in screen when no other external monitor exists", () => {
    expect(resolveRole("secondary", [mon(false, true, 0), mon(true, false, 1920)])).toBe(0);
  });

  it("returns -1 for a missing role or an unknown key", () => {
    expect(resolveRole("secondary", [mon(true, true, 0)])).toBe(-1);
    expect(resolveRole("builtin", [mon(true, false, 0)])).toBe(-1);
    expect(resolveRole("DP-5", [mon(true, false, 0)])).toBe(-1);
  });
});

describe("isBuiltinConnector", () => {
  it("matches panel connectors only", () => {
    expect(["eDP-1", "LVDS-1", "DSI-2"].every(isBuiltinConnector)).toBe(true);
    expect(["DP-6", "HDMI-1", "DP-10"].some(isBuiltinConnector)).toBe(false);
  });
});
