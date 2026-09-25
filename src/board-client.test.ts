import { describe, expect, it } from "vitest";
import { toCrewTask } from "./board-client";

describe("toCrewTask", () => {
  it("carries the persistent creation timestamp into the task model", () => {
    expect(toCrewTask({ id: "t1", project_id: "p1", title: "A task", status: "backlog", created_at: "2026-09-01T09:00:00Z" }))
      .toMatchObject({ id: "t1", createdAt: "2026-09-01T09:00:00Z" });
  });

  it("leaves the timestamp absent for older task shapes that lack one", () => {
    expect(toCrewTask({ id: "t1", title: "A task", status: "backlog" })).not.toHaveProperty("createdAt");
  });
});
