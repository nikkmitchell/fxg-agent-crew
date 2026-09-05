import { describe, expect, it } from "vitest";
import type { CrewTask } from "./event-core";
import { calculateProjectProgress } from "./project-model";

describe("calculateProjectProgress", () => {
  it("weights progress by points rather than card count", () => {
    const tasks: CrewTask[] = [
      { id: "small", title: "Small", status: "done", points: 2 },
      { id: "large", title: "Large", status: "review", points: 8 },
    ];
    expect(calculateProjectProgress(tasks)).toEqual({ complete: 2, total: 10, percent: 20 });
  });

  it("handles an empty project without NaN", () => {
    expect(calculateProjectProgress([])).toEqual({ complete: 0, total: 0, percent: 0 });
  });
});

