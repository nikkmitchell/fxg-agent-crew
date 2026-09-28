import { describe, expect, it } from "vitest";
import { teaPourFrame, TEA_POUR_MS } from "./tea-motion";

describe("tea table motion", () => {
  it("keeps the cup empty until someone starts a pour", () => {
    expect(teaPourFrame(null, 1_000, false)).toEqual({ fill: 0, pouring: false, complete: false });
  });

  it("fills progressively and marks the end of the pour", () => {
    expect(teaPourFrame(1_000, 1_000 + TEA_POUR_MS / 2, false)).toEqual({ fill: 0.5, pouring: true, complete: false });
    expect(teaPourFrame(1_000, 1_000 + TEA_POUR_MS, false)).toEqual({ fill: 1, pouring: false, complete: true });
  });

  it("snaps a pour to a still, full cup for reduced-motion users", () => {
    expect(teaPourFrame(1_000, 1_001, true)).toEqual({ fill: 1, pouring: false, complete: true });
  });

  it("keeps an already-snapped pour still if the preference is turned back off", () => {
    expect(teaPourFrame(1_000, 1_001, false, 1_000)).toEqual({ fill: 1, pouring: false, complete: true });
    expect(teaPourFrame(2_000, 2_001, false, 1_000)).toEqual({ fill: 1 / TEA_POUR_MS, pouring: true, complete: false });
  });

  it("does not show time reversal as a negative pour", () => {
    expect(teaPourFrame(2_000, 1_000, false)).toEqual({ fill: 0, pouring: true, complete: false });
  });
});
