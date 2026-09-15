import { describe, expect, it } from "vitest";
import { byArrival } from "./board-order";
import type { CrewTask } from "./event-core";

const task = (id: string, over: Partial<CrewTask> = {}): CrewTask =>
  ({ id, title: id, status: "backlog", ...over }) as CrewTask;

describe("the order a column stacks in", () => {
  it("puts the card that arrived last first, so it is drawn on the title", () => {
    const ordered = byArrival([
      task("old", { updatedAt: "2026-09-15T06:00:00Z" }),
      task("newest", { updatedAt: "2026-09-15T07:00:00Z" }),
      task("middle", { updatedAt: "2026-09-15T06:30:00Z" }),
    ]);
    expect(ordered.map((t) => t.id)).toEqual(["newest", "middle", "old"]);
  });

  it("goes by when a card moved, when the room still knows it", () => {
    const ordered = byArrival([
      task("moved-just-now", { updatedAt: "2026-09-15T06:00:00Z", fresh: { changedAt: "2026-09-15T07:10:00Z", revealAt: "2026-09-15T07:10:05Z" } }),
      task("edited", { updatedAt: "2026-09-15T07:05:00Z" }),
    ]);
    expect(ordered[0].id).toBe("moved-just-now");
  });

  it("keeps a stable order for cards that arrived together, and for cards with no time at all", () => {
    const at = "2026-09-15T07:00:00Z";
    expect(byArrival([task("b", { updatedAt: at }), task("a", { updatedAt: at })]).map((t) => t.id)).toEqual(["a", "b"]);
    expect(byArrival([task("z"), task("y")]).map((t) => t.id)).toEqual(["y", "z"]);
  });

  it("does not reorder what it was given", () => {
    const input = [task("a", { updatedAt: "2026-09-15T06:00:00Z" }), task("b", { updatedAt: "2026-09-15T07:00:00Z" })];
    byArrival(input);
    expect(input.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
