import { describe, expect, it } from "vitest";
import { adaptMessages, encodeEnvelope } from "../webharness/adapter.js";
import { initialCrewState, reduceCrewEvent, type EventEnvelope } from "../../src/event-core.js";
import type { Message } from "../../shared/contracts.js";

/**
 * The adapter and the reducer were written by different agents against a
 * contract agreed in chat. Unit tests on each prove they each work; only this
 * proves they agree. A mismatch here is exactly the kind of thing that would
 * otherwise surface as "the UI is empty" with no obvious cause.
 */
const msg = (id: number, content: string, username = "codex"): Message => ({
  id, username, content, msgType: "text",
  createdAt: "2026-09-03T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z", streaming: false,
});

const env = (eventId: string, cursor: number, payload: EventEnvelope["payload"]): EventEnvelope => ({
  version: 1, eventId, source: "codex", sourceCursor: cursor,
  occurredAt: "2026-09-03T00:00:00Z", payload,
});

describe("adapter -> reducer", () => {
  const room: Message[] = [
    msg(1, "morning all"),
    msg(2, encodeEnvelope(env("e1", 1, { type: "task.upserted", task: { id: "t1", title: "Wire the room", status: "assigned", points: 3 } }))),
    msg(3, "I think t1 is blocked, someone look"),
    msg(4, encodeEnvelope(env("e2", 2, { type: "task.transitioned", taskId: "t1", to: "in_progress" }))),
  ];

  it("drives real state from envelopes and none from prose", () => {
    const { events, chat } = adaptMessages(room);
    const state = events.reduce(reduceCrewEvent, initialCrewState);

    expect(state.tasks.t1.status).toBe("in_progress");
    // msg 3 says "blocked" in plain language. It must not have moved anything.
    expect(state.tasks.t1.status).not.toBe("blocked");
    expect(chat.map((m) => m.id)).toEqual([1, 3]);
  });

  it("survives a full replay of the same room without drift", () => {
    const { events } = adaptMessages(room);
    const once = events.reduce(reduceCrewEvent, initialCrewState);
    const twice = events.reduce(reduceCrewEvent, once);

    expect(twice).toEqual(once);
  });

  it("keeps a refused envelope out of state while keeping the message visible", () => {
    const bad = msg(5, "```crew-event\n{\"version\":2}\n```");
    const { events, chat, rejected } = adaptMessages([...room, bad]);
    const state = events.reduce(reduceCrewEvent, initialCrewState);

    expect(rejected).toHaveLength(1);
    expect(state.rejectedEvents).toEqual([]);   // never reached the reducer
    expect(chat.some((m) => m.id === 5)).toBe(true);
  });
});
