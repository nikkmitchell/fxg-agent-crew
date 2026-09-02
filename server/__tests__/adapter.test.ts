import { describe, expect, it } from "vitest";
import { adaptMessages, encodeEnvelope } from "../webharness/adapter.js";
import type { Message } from "../../shared/contracts.js";
import type { EventEnvelope } from "../../src/event-core.js";

const message = (id: number, content: string, username = "codex", msgType = "text"): Message => ({
  id,
  username,
  content,
  msgType,
  createdAt: "2026-09-03T00:00:00Z",
  updatedAt: "2026-09-03T00:00:00Z",
  streaming: false,
});

const envelope: EventEnvelope = {
  version: 1,
  eventId: "e1",
  source: "codex",
  sourceCursor: 1,
  occurredAt: "2026-09-03T00:00:00Z",
  payload: { type: "task.transitioned", taskId: "t1", to: "blocked", blocker: "waiting on auth" },
};

const fenced = (body: unknown) => ["```crew-event", JSON.stringify(body), "```"].join("\n");

describe("adaptMessages", () => {
  it("extracts a valid envelope", () => {
    const result = adaptMessages([message(1, fenced(envelope))]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload).toEqual(envelope.payload);
    expect(result.rejected).toEqual([]);
  });

  it("NEVER infers state from prose, however suggestive", () => {
    // This is the core guarantee. Each of these would be trivial to regex into
    // a task transition, and doing so would put a claim on a mission-control
    // screen that no event supports. A blocker the system invented is worse
    // than one it missed, because a human acts on it.
    const prose = [
      message(1, "I am blocked on auth"),
      message(2, "task t1 is now done"),
      message(3, "status: in_progress, assignee: codex, points: 5"),
      message(4, "BLOCKED: cannot reach github"),
      message(5, '{"type":"task.transitioned","taskId":"t1","to":"done"}'),
    ];

    const result = adaptMessages(prose);

    expect(result.events).toEqual([]);
    expect(result.chat).toHaveLength(5);
    // Bare JSON without the fence is prose too — it is not a rejected envelope,
    // because it never claimed to be one.
    expect(result.rejected).toEqual([]);
  });

  it("keeps prose alongside an envelope in the same message", () => {
    const result = adaptMessages([
      message(1, `Taking this now.\n\n${fenced(envelope)}\n\nWill report back.`),
    ]);

    expect(result.events).toHaveLength(1);
    // The message drove state, so it is not double-counted as chat.
    expect(result.chat).toEqual([]);
  });

  it("suppresses our own messages so a poll cannot echo our writes back", () => {
    const result = adaptMessages(
      [message(1, fenced(envelope), "claude-nikk2mbp"), message(2, fenced({ ...envelope, eventId: "e2" }), "codex")],
      { selfUsername: "claude-nikk2mbp" },
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventId).toBe("e2");
  });

  it("fails closed on an unknown envelope version", () => {
    const result = adaptMessages([message(1, fenced({ ...envelope, version: 2 }))]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("version");
  });

  it("refuses an unknown event type rather than passing it to the reducer", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, payload: { type: "task.deleted", taskId: "t1" } })),
    ]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("unknown event type");
  });

  it.each([
    ["missing eventId", { ...envelope, eventId: undefined }],
    ["missing source", { ...envelope, source: undefined }],
    ["non-numeric sourceCursor", { ...envelope, sourceCursor: "1" }],
  ])("rejects an envelope with %s", (_label, bad) => {
    const result = adaptMessages([message(1, fenced(bad))]);

    expect(result.events).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("reports malformed JSON instead of throwing", () => {
    const result = adaptMessages([message(1, "```crew-event\n{not json}\n```")]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("JSON");
  });

  it("keeps a message in the feed when its only envelope was refused", () => {
    // Otherwise a malformed block would erase a human's words from the
    // transcript, which is a worse failure than the bad envelope itself.
    const result = adaptMessages([message(1, `Here is my update.\n${fenced({ version: 9 })}`)]);

    expect(result.chat).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("treats attachments as chat, never as envelope carriers", () => {
    const result = adaptMessages([message(1, "diagram.png", "codex", "attachment")]);

    expect(result.events).toEqual([]);
    expect(result.chat).toHaveLength(1);
  });

  it("handles several envelopes in one message, in order", () => {
    const second = { ...envelope, eventId: "e2", sourceCursor: 2 };
    const result = adaptMessages([message(1, `${fenced(envelope)}\n${fenced(second)}`)]);

    expect(result.events.map((event) => event.eventId)).toEqual(["e1", "e2"]);
  });

  it("round-trips through encodeEnvelope", () => {
    // The encoder is the single definition of the wire format; if it and the
    // parser ever disagree, agents emit events nobody can read.
    const result = adaptMessages([message(1, encodeEnvelope(envelope))]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(envelope);
  });
});
