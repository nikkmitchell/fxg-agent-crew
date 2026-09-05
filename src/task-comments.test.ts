import { describe, expect, it } from "vitest";
import { initialCrewState, reduceCrewEvent, type EventEnvelope } from "./event-core";

/**
 * Appending a comment, rather than re-sending the whole card.
 *
 * The bug this replaces is a lost update: adding a comment used to mean
 * sending the entire task from the state you last read, so two people
 * commenting concurrently would each overwrite the other. It never bit this
 * team only because we happened to take turns.
 */

const envelope = (id: string, payload: EventEnvelope["payload"], cursor: number): EventEnvelope => ({
  version: 1,
  eventId: id,
  stream: "AgentParty",
  source: "claude-nikk2mbp",
  sourceCursor: cursor,
  occurredAt: "2026-09-05T00:00:00Z",
  payload,
});

const comment = (id: string, author: string, body: string) => ({
  id,
  author,
  body,
  createdAt: "2026-09-05T00:00:00Z",
});

const withTask = () => {
  const project = envelope("e0", {
    type: "project.upserted",
    project: {
      id: "go",
      name: "Multiplayer Go",
      summary: "s",
      goals: ["g"],
      steps: [{ id: "s1", title: "Rules", status: "not_started" }],
    },
  }, 1);
  const task = envelope("e1", {
    type: "task.upserted",
    task: { id: "ko", projectId: "go", title: "Ko", status: "backlog", points: 3 },
  }, 2);
  return [project, task].reduce(reduceCrewEvent, initialCrewState);
};

describe("task.commented", () => {
  it("appends without touching the rest of the card", () => {
    const state = reduceCrewEvent(
      withTask(),
      envelope("e2", { type: "task.commented", taskId: "ko", comment: comment("c1", "claude-nikk2mbp", "first") }, 3),
    );

    expect(state.tasks.ko.comments).toHaveLength(1);
    expect(state.tasks.ko.title).toBe("Ko");
    expect(state.tasks.ko.status).toBe("backlog");
  });

  it("keeps BOTH comments when two authors append concurrently", () => {
    // THE POINT. Under the old whole-card write, whichever of these arrived
    // second would have carried a comments array built from the state its
    // author read first — silently erasing the other.
    const state = [
      envelope("e2", { type: "task.commented", taskId: "ko", comment: comment("c1", "claude-nikk2mbp", "mine") }, 3),
      envelope("e3", { type: "task.commented", taskId: "ko", comment: comment("c2", "Nikk2Macbook-Codex-001", "theirs") }, 4),
    ].reduce(reduceCrewEvent, withTask());

    expect(state.tasks.ko.comments?.map((entry) => entry.id)).toEqual(["c1", "c2"]);
  });

  it("is idempotent by comment id, so a retried append does not duplicate", () => {
    // Writes time out here in practice; a retry must not post the comment twice.
    const once = reduceCrewEvent(
      withTask(),
      envelope("e2", { type: "task.commented", taskId: "ko", comment: comment("c1", "me", "hello") }, 3),
    );
    const twice = reduceCrewEvent(
      once,
      envelope("e3", { type: "task.commented", taskId: "ko", comment: comment("c1", "me", "hello") }, 4),
    );

    expect(twice.tasks.ko.comments).toHaveLength(1);
  });

  it("rejects a comment on a task that does not exist", () => {
    const state = reduceCrewEvent(
      withTask(),
      envelope("e2", { type: "task.commented", taskId: "nope", comment: comment("c1", "me", "x") }, 3),
    );

    expect(state.rejectedEvents.at(-1)?.reason).toBe("task not found");
  });
});
