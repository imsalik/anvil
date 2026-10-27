import { describe, it, expect } from "vitest";
import {
  parseMonitorWorkspaces,
  resolveOwners,
} from "../../../lib/extension/monitor-workspaces.js";

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
