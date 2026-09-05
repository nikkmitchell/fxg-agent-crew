import { describe, expect, it } from "vitest";
import { describeProgress, progressByKind } from "./task-kind";
import type { CrewTask } from "./event-core";

const task = (id: string, status: string, kind?: string): CrewTask =>
  ({ id, title: id, status, points: 1, ...(kind ? { kind } : {}) }) as unknown as CrewTask;

describe("progress by kind", () => {
  it("reports decisions and builds separately rather than as one number", () => {
    // The case that motivated this: every finished card is a decision and
    // nothing has been built. One combined number reads as a working product.
    const tasks = [
      task("a", "done", "decision"),
      task("b", "done", "decision"),
      task("c", "backlog", "build"),
    ];
    expect(describeProgress(tasks)).toBe("2/2 decisions · 0/1 built");
  });

  it("keeps unlabelled tasks in their own bucket instead of guessing", () => {
    // Cards created before the field existed were never labelled. Folding them
    // into either bucket would be a guess presented as a record.
    const tasks = [task("a", "done", "decision"), task("b", "done")];
    expect(describeProgress(tasks)).toBe("1/1 decisions · 1/1 unspecified");
  });

  it("omits buckets with nothing in them", () => {
    expect(progressByKind([task("a", "done", "build")]).map((p) => p.kind)).toEqual(["build"]);
  });

  it("says so plainly when there is nothing", () => {
    expect(describeProgress([])).toBe("No tasks yet.");
  });

  it("does not report a percentage across mixed kinds", () => {
    // A percentage over mixed kinds is precisely the number that misled.
    expect(describeProgress([task("a", "done", "decision"), task("b", "backlog", "build")])).not.toContain("%");
  });
});
