import { describe, expect, it } from "vitest";
import { adaptMessages, encodeEnvelope } from "../webharness/adapter.js";
import { initialCrewState, reduceCrewEvent } from "../../src/event-core.js";
import type { EventEnvelope } from "../../shared/crew-events.js";
import type { Message } from "../../shared/contracts.js";

/**
 * The adapter and the reducer were written by different agents against a
 * contract agreed in chat rather than in shared code. Unit tests on each prove
 * each works; only these prove they agree. A mismatch would otherwise surface
 * as "the UI is empty", with each of us pointing at our own passing suite.
 */

const msg = (id: number, content: string, overrides: Partial<Message> = {}): Message => ({
  id,
  username: "codex",
  content,
  msgType: "text",
  createdAt: "2026-09-03T00:00:00Z",
  updatedAt: "2026-09-03T00:00:00Z",
  streaming: false,
  ...overrides,
});

const env = (eventId: string, cursor: number, payload: EventEnvelope["payload"]): EventEnvelope => ({
  version: 1,
  eventId,
  source: "codex",
  sourceCursor: cursor,
  occurredAt: "2026-09-03T00:00:00Z",
  payload,
});

const room: Message[] = [
  msg(1, "morning all"),
  msg(2, encodeEnvelope(env("e1", 1, {
    type: "task.upserted",
    task: { id: "t1", title: "Wire the room", status: "assigned", points: 3 },
  }))),
  msg(3, "I think t1 is blocked, someone take a look"),
  msg(4, encodeEnvelope(env("e2", 2, { type: "task.transitioned", taskId: "t1", to: "in_progress" }))),
];

describe("adapter -> reducer", () => {
  it("drives state from envelopes and never from prose", () => {
    const { events, transcript } = adaptMessages(room);
    const state = events.reduce(reduceCrewEvent, initialCrewState);

    expect(state.tasks.t1.status).toBe("in_progress");
    // Message 3 says "blocked" in plain language. It must not have moved anything.
    expect(state.tasks.t1.status).not.toBe("blocked");
    // Every message still reaches the transcript, including the two that
    // carried envelopes — state and conversation are separate concerns.
    expect(transcript.map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it("replays a whole room without drift", () => {
    const { events } = adaptMessages(room);
    const once = events.reduce(reduceCrewEvent, initialCrewState);
    const twice = events.reduce(reduceCrewEvent, once);

    expect(twice).toEqual(once);
  });

  it("keeps a refused envelope out of the reducer entirely", () => {
    const bad = msg(5, '```crew-event\n{"version":1,"eventId":"x","source":"s","sourceCursor":1,"occurredAt":"2026-09-03T00:00:00Z","payload":{"type":"task.upserted","task":{"nonsense":true}}}\n```');
    const { events, transcript, rejected } = adaptMessages([...room, bad]);
    const state = events.reduce(reduceCrewEvent, initialCrewState);

    expect(rejected).toHaveLength(1);
    // The reducer has its own rejection log; nothing should have reached it,
    // because the adapter refused the event at the boundary.
    expect(state.rejectedEvents).toEqual([]);
    expect(transcript.some((m) => m.id === 5)).toBe(true);
  });

  it("resumes correctly across a poll boundary using seenEventIds", () => {
    // Simulates two successive polls over overlapping windows, which is what a
    // reconnect actually produces.
    const first = adaptMessages(room.slice(0, 3));
    const applied = new Set(first.events.map((e) => e.eventId));
    const second = adaptMessages(room, { seenEventIds: applied });

    const state = [...first.events, ...second.events].reduce(reduceCrewEvent, initialCrewState);

    expect(second.events.map((e) => e.eventId)).toEqual(["e2"]);
    expect(state.tasks.t1.status).toBe("in_progress");
  });

  it("ignores a streaming envelope and applies it once finalized", () => {
    const streaming = msg(6, encodeEnvelope(env("e3", 3, {
      type: "task.transitioned", taskId: "t1", to: "review",
    })), { streaming: true });

    const midStream = adaptMessages([...room, streaming]);
    const midState = midStream.events.reduce(reduceCrewEvent, initialCrewState);
    expect(midState.tasks.t1.status).toBe("in_progress");

    const finalized = adaptMessages([...room, { ...streaming, streaming: false }]);
    const finalState = finalized.events.reduce(reduceCrewEvent, initialCrewState);
    expect(finalState.tasks.t1.status).toBe("review");
  });
});
