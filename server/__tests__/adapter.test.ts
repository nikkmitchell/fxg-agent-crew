import { describe, expect, it } from "vitest";
import { adaptMessages, encodeEnvelope } from "../webharness/adapter.js";
import { LIMITS, type EventEnvelope } from "../../shared/crew-events.js";
import type { Message } from "../../shared/contracts.js";

const message = (
  id: number,
  content: string,
  overrides: Partial<Message> = {},
): Message => ({
  id,
  username: "codex",
  content,
  msgType: "text",
  createdAt: "2026-09-03T00:00:00Z",
  updatedAt: "2026-09-03T00:00:00Z",
  streaming: false,
  ...overrides,
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
  it("extracts a fully validated envelope", () => {
    const result = adaptMessages([message(1, fenced(envelope))]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(envelope);
    expect(result.rejected).toEqual([]);
  });

  it("NEVER infers state from prose, however suggestive", () => {
    // The core guarantee. Each of these is something we actually say in the
    // room, and each would be trivial to regex into a state change.
    const prose = [
      message(1, "I am blocked on auth"),
      message(2, "task t1 is now done"),
      message(3, "status: in_progress, assignee: codex, points: 5"),
      message(4, "BLOCKED: cannot reach github"),
      message(5, '{"type":"task.transitioned","taskId":"t1","to":"done"}'),
    ];

    const result = adaptMessages(prose);

    expect(result.events).toEqual([]);
    expect(result.transcript).toHaveLength(5);
    // Unfenced JSON is prose too — it never claimed to be an envelope.
    expect(result.rejected).toEqual([]);
  });
});

describe("transcript is independent of state", () => {
  it("keeps a message carrying a VALID envelope in the transcript", () => {
    const result = adaptMessages([
      message(1, `Taking this now.\n\n${fenced(envelope)}\n\nWill report back.`),
    ]);

    // Previously an accepted envelope removed the message, silently deleting
    // the human's words around it. State and transcript are separate concerns.
    expect(result.events).toHaveLength(1);
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0].content).toContain("Taking this now.");
  });

  it("keeps a message whose envelope was refused", () => {
    const result = adaptMessages([message(1, `Here is my update.\n${fenced({ version: 9 })}`)]);

    expect(result.transcript).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("preserves every message in order regardless of contents", () => {
    const result = adaptMessages([
      message(1, "prose"),
      message(2, fenced(envelope)),
      message(3, "```crew-event\n{bad json}\n```"),
      message(4, "diagram.png", { msgType: "attachment" }),
    ]);

    expect(result.transcript.map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("streaming messages", () => {
  it("ignores envelopes while the message is still being written", () => {
    // A streaming message may be truncated mid-object, or look complete now and
    // differ once finished. Applying it early shows state the author has not
    // committed to.
    const result = adaptMessages([message(1, fenced(envelope), { streaming: true })]);

    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([]);
    // It still belongs in the transcript — the human can see it being typed.
    expect(result.transcript).toHaveLength(1);
  });

  it("applies the same envelope once the message is finalized", () => {
    const partial = message(1, fenced(envelope), { streaming: true });
    const final = message(1, fenced(envelope), { streaming: false });

    expect(adaptMessages([partial]).events).toEqual([]);
    expect(adaptMessages([final]).events).toHaveLength(1);
  });

  it("does not apply a partial envelope that happens to parse", () => {
    // A truncated block whose JSON is still valid is the dangerous case.
    const truncated = fenced({ ...envelope, payload: { type: "task.transitioned", taskId: "t1", to: "done" } });
    const result = adaptMessages([message(1, truncated, { streaming: true })]);

    expect(result.events).toEqual([]);
  });
});

describe("echo handling is by event identity, not author", () => {
  it("accepts our own events when they are new", () => {
    // Suppressing everything from our own username would discard our own
    // legitimate events — the reason that approach was removed.
    const result = adaptMessages([message(1, fenced(envelope), { username: "claude-nikk2mbp" })]);

    expect(result.events).toHaveLength(1);
  });

  it("skips events already applied, whoever authored them", () => {
    const result = adaptMessages([message(1, fenced(envelope))], { seenEventIds: new Set(["e1"]) });

    expect(result.events).toEqual([]);
  });

  it("deduplicates within a single batch", () => {
    const result = adaptMessages([message(1, fenced(envelope)), message(2, fenced(envelope))]);

    expect(result.events).toHaveLength(1);
  });

  it("catches a duplicate relayed by a different author", () => {
    const result = adaptMessages([
      message(1, fenced(envelope), { username: "codex" }),
      message(2, fenced(envelope), { username: "someone-else" }),
    ]);

    expect(result.events).toHaveLength(1);
  });
});

describe("runtime validation of payload contents", () => {
  // The previous version checked only that payload.type was known and passed
  // the contents through unvalidated — a cast standing in for validation, at
  // the one boundary whose whole job is refusing untrusted input.

  it("rejects a known type carrying garbage", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, payload: { type: "task.upserted", task: { nonsense: true } } })),
    ]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("task.id");
  });

  it.each([
    ["non-string task id", { type: "task.upserted", task: { id: 5, title: "t", status: "backlog", points: 1 } }, "task.id"],
    ["unknown status", { type: "task.upserted", task: { id: "t", title: "t", status: "invented", points: 1 } }, "status"],
    ["negative points", { type: "task.upserted", task: { id: "t", title: "t", status: "backlog", points: -1 } }, "negative"],
    ["fractional points", { type: "task.upserted", task: { id: "t", title: "t", status: "backlog", points: 1.5 } }, "integer"],
    ["blocked without reason", { type: "task.transitioned", taskId: "t", to: "blocked" }, "blocker"],
    ["missing nested agent", { type: "agent.upserted", agent: { id: "a" } }, "agent.name"],
    ["non-array usernames", { type: "presence.snapshotted", usernames: "codex" }, "array"],
    ["non-string in usernames", { type: "presence.snapshotted", usernames: ["ok", 7] }, "usernames[1]"],
  ])("rejects %s", (_label, payload, expected) => {
    const result = adaptMessages([message(1, fenced({ ...envelope, payload }))]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain(expected);
  });

  it("rejects a missing or unparseable timestamp instead of defaulting it", () => {
    // Defaulting to the epoch would order the log wrongly while looking
    // correct, which is worse than dropping the event.
    const missing = adaptMessages([message(1, fenced({ ...envelope, occurredAt: undefined }))]);
    const garbage = adaptMessages([message(2, fenced({ ...envelope, occurredAt: "not a date" }))]);

    expect(missing.events).toEqual([]);
    expect(garbage.events).toEqual([]);
    expect(garbage.rejected[0].reason).toContain("timestamp");
  });

  it.each([
    ["negative cursor", { sourceCursor: -1 }, "negative"],
    ["fractional cursor", { sourceCursor: 1.5 }, "integer"],
    ["string cursor", { sourceCursor: "1" }, "finite number"],
    ["empty eventId", { eventId: "" }, "empty"],
    ["missing source", { source: undefined }, "source"],
  ])("rejects an envelope with %s", (_label, override, expected) => {
    const result = adaptMessages([message(1, fenced({ ...envelope, ...override }))]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain(expected);
  });

  it("fails closed on an unknown envelope version", () => {
    const result = adaptMessages([message(1, fenced({ ...envelope, version: 2 }))]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("version");
  });

  it("refuses an unknown event type", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, payload: { type: "task.deleted", taskId: "t1" } })),
    ]);

    expect(result.rejected[0].reason).toContain("unknown event type");
  });

  it("rebuilds the value so smuggled extra keys cannot survive", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, injected: "surprise", payload: { ...envelope.payload, injected: "also" } })),
    ]);

    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result.events[0])).not.toContain("surprise");
    expect(JSON.stringify(result.events[0])).not.toContain("also");
  });
});

describe("prototype pollution and size bounds", () => {
  it.each(["__proto__", "constructor", "prototype"])("rejects an envelope with a %s key", (key) => {
    const result = adaptMessages([message(1, `\`\`\`crew-event\n{"version":1,"${key}":{}}\n\`\`\``)]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain(key);
  });

  it("rejects a polluting key nested inside a payload", () => {
    const result = adaptMessages([
      message(1, `\`\`\`crew-event\n{"version":1,"eventId":"e","source":"s","sourceCursor":1,"occurredAt":"2026-09-03T00:00:00Z","payload":{"type":"task.upserted","task":{"__proto__":{"polluted":true},"id":"t","title":"t","status":"backlog","points":1}}}\n\`\`\``),
    ]);

    expect(result.events).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects an oversized envelope before parsing it", () => {
    const huge = fenced({ ...envelope, payload: { ...envelope.payload, blocker: "x".repeat(LIMITS.maxEnvelopeBytes) } });
    const result = adaptMessages([message(1, huge)]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("bytes");
  });

  it("rejects a message carrying too many envelopes", () => {
    const many = Array.from({ length: LIMITS.maxEnvelopesPerMessage + 1 }, (_, i) =>
      fenced({ ...envelope, eventId: `e${i}` }),
    ).join("\n");
    const result = adaptMessages([message(1, many)]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("limit");
  });

  it("rejects an over-long string field", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, eventId: "x".repeat(LIMITS.maxStringLength + 1) })),
    ]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("characters");
  });

  it("rejects an over-long array", () => {
    const result = adaptMessages([
      message(1, fenced({
        ...envelope,
        payload: { type: "presence.snapshotted", usernames: Array.from({ length: LIMITS.maxArrayLength + 1 }, () => "u") },
      })),
    ]);

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("entries");
  });
});

describe("wire format", () => {
  it("round-trips through encodeEnvelope", () => {
    // If encoder and parser disagree, agents emit events nobody can read.
    const result = adaptMessages([message(1, encodeEnvelope(envelope))]);

    expect(result.events[0]).toEqual(envelope);
  });

  it("handles several distinct envelopes in one message, in order", () => {
    const second = { ...envelope, eventId: "e2", sourceCursor: 2 };
    const result = adaptMessages([message(1, `${fenced(envelope)}\n${fenced(second)}`)]);

    expect(result.events.map((e) => e.eventId)).toEqual(["e1", "e2"]);
  });

  it("reports malformed JSON instead of throwing", () => {
    const result = adaptMessages([message(1, "```crew-event\n{not json}\n```")]);

    expect(result.rejected[0].reason).toContain("JSON");
  });
});
