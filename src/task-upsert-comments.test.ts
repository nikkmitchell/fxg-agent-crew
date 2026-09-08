import { describe, expect, it } from "vitest";
import { initialCrewState, reduceCrewEvent, type EventEnvelope } from "./event-core";

/**
 * An upsert that says nothing about comments must not delete them.
 *
 * `task.upserted` replaces the stored card. To keep a discussion, a client had
 * to re-send every comment — and comments outgrow a 2000-character durable
 * message after about the third one. Eleven real cards had passed that point:
 * claiming, accepting, renaming and writing a brief all failed with a 400,
 * because the discussion rode along in a payload that had nothing to do with
 * it. Sending the card without comments deleted them instead. There was no
 * third option, which makes it a deadlock rather than a limit.
 */

let seq = 0;
const envelope = (payload: unknown): EventEnvelope =>
  ({
    version: 1,
    eventId: `e${++seq}`,
    stream: "AgentParty",
    source: "claude-nikk2mbp",
    sourceCursor: seq,
    occurredAt: "2026-09-09T00:00:00Z",
    payload,
  }) as EventEnvelope;

const project = envelope({ type: "project.upserted", project: { id: "p", name: "P", summary: "s", goals: [], steps: [] } });
const card = { id: "t1", projectId: "p", title: "A card", status: "backlog", points: 1 };
const comment = { id: "c1", author: "someone", body: "worth keeping", createdAt: "2026-09-09T00:00:00Z" };

const fold = (payloads: unknown[]) =>
  [project, ...payloads.map(envelope)].reduce(reduceCrewEvent, initialCrewState);

describe("task.upserted and an existing discussion", () => {
  it("keeps comments when the payload omits them", () => {
    const state = fold([
      { type: "task.upserted", task: card },
      { type: "task.commented", taskId: "t1", comment },
      { type: "task.upserted", task: { ...card, title: "Renamed" } },
    ]);

    expect(state.tasks.t1.title).toBe("Renamed");
    expect(state.tasks.t1.comments).toEqual([comment]);
  });

  it("still lets an explicit array replace them, so a deliberate edit stays possible", () => {
    const state = fold([
      { type: "task.upserted", task: card },
      { type: "task.commented", taskId: "t1", comment },
      { type: "task.upserted", task: { ...card, comments: [] } },
    ]);

    expect(state.tasks.t1.comments).toEqual([]);
  });

  it("leaves a card with no discussion exactly as it was", () => {
    const state = fold([{ type: "task.upserted", task: card }]);

    expect(state.tasks.t1.comments).toBeUndefined();
  });

  it("replays identically when the same events are folded twice", () => {
    // The rule reads prior state, so it is the kind of rule that can make a
    // replay disagree with itself. Folding the same log twice must not.
    const events = [
      { type: "task.upserted", task: card },
      { type: "task.commented", taskId: "t1", comment },
      { type: "task.upserted", task: { ...card, title: "Renamed" } },
    ];

    expect(fold(events).tasks.t1).toEqual(fold(events).tasks.t1);
  });
});
