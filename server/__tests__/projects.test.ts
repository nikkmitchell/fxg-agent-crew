import { describe, expect, it, vi } from "vitest";
import { encodeActionRequest } from "../webharness/adapter.js";
import { replayProjectState } from "../routes/projects.js";

const transport = (id: number, content: string) => ({
  id,
  username: "nikk",
  content,
  msgType: "text",
  createdAt: `2026-09-04T00:00:0${id}Z`,
  updatedAt: `2026-09-04T00:00:0${id}Z`,
  streaming: false,
});

describe("project replay", () => {
  it("rebuilds a project and its scoped task from durable room events", async () => {
    const project = encodeActionRequest({
      type: "project.upserted",
      project: {
        id: "many-player-go",
        name: "Multiplayer Go",
        summary: "A real project used to exercise Mission Control.",
        goals: ["Support three or more players"],
        steps: [{ id: "rules", title: "Agree on rules", status: "in_progress" }],
      },
    });
    const task = encodeActionRequest({
      type: "task.upserted",
      task: { id: "go-rules", projectId: "many-player-go", title: "Agree on rules", status: "assigned", points: 3 },
    });
    const request = vi.fn()
      .mockResolvedValueOnce({ messages: [transport(1, project), transport(2, task)] })
      .mockResolvedValueOnce({ messages: [] });

    const state = await replayProjectState({ request } as never, "AgentParty", "secret-never-returned", () => true);

    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].name).toBe("Multiplayer Go");
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].projectId).toBe("many-player-go");
    expect(state.rejected).toEqual([]);
  });

  it("does not materialize an orphan task", async () => {
    const task = encodeActionRequest({
      type: "task.upserted",
      task: { id: "orphan", projectId: "missing", title: "Orphan", status: "backlog", points: 1 },
    });
    const request = vi.fn().mockResolvedValueOnce({ messages: [transport(1, task)] });
    const state = await replayProjectState({ request } as never, "AgentParty", "secret-never-returned", () => true);
    expect(state.tasks).toEqual([]);
    expect(state.rejected.at(-1)).toMatchObject({ reason: "project not found" });
  });

  it("fails instead of returning a silently truncated projection", async () => {
    const fullPage = Array.from({ length: 50 }, (_, index) => transport(index + 1, "ordinary prose"));
    let cursor = 0;
    const request = vi.fn().mockImplementation(() => {
      const page = fullPage.map((message) => ({ ...message, id: message.id + cursor }));
      cursor += 50;
      return Promise.resolve({ messages: page });
    });
    await expect(replayProjectState({ request } as never, "AgentParty", "secret-never-returned", () => true))
      .rejects.toThrow("exceeded 10000 messages");
  });
});
