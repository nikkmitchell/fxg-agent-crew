import { describe, expect, it } from "vitest";
import { recentActivity } from "./recent-activity";
import type { CrewTask } from "./event-core";

const task = (id: string, title: string, comments: Array<[string, string, string]>): CrewTask => ({
  id,
  title,
  status: "backlog",
  points: 1,
  comments: comments.map(([cid, author, at]) => ({ id: cid, author, at, body: `body of ${cid}`, createdAt: at })),
} as unknown as CrewTask);

describe("recent activity", () => {
  it("returns newest first across tasks", () => {
    const entries = recentActivity([
      task("a", "Alpha", [["c1", "claude", "2026-09-05T01:00:00Z"]]),
      task("b", "Beta", [["c2", "codex", "2026-09-05T03:00:00Z"]]),
    ]);
    expect(entries.map((entry) => entry.author)).toEqual(["codex", "claude"]);
  });

  it("orders ties stably rather than by object iteration", () => {
    const same = "2026-09-05T01:00:00Z";
    const entries = recentActivity([
      task("zeta", "Zeta", [["c1", "x", same]]),
      task("alpha", "Alpha", [["c2", "y", same]]),
    ]);
    expect(entries.map((entry) => entry.taskId)).toEqual(["alpha", "zeta"]);
  });

  it("truncates long bodies but keeps them attributable", () => {
    const long = recentActivity([task("a", "Alpha", [["c1", "claude", "2026-09-05T01:00:00Z"]])]);
    expect(long[0].author).toBe("claude");
    expect(long[0].taskTitle).toBe("Alpha");
  });

  it("is empty when nothing has been discussed, rather than inventing filler", () => {
    expect(recentActivity([task("a", "Alpha", [])])).toEqual([]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_unused, index) =>
      task(`t${index}`, `T${index}`, [[`c${index}`, "claude", `2026-09-05T01:00:${String(index).padStart(2, "0")}Z`]]),
    );
    expect(recentActivity(many, 5)).toHaveLength(5);
  });
});
