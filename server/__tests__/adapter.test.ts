import { describe, expect, it } from "vitest";
import { adaptMessages, encodeActionRequest } from "../webharness/adapter.js";
import { LIMITS, type CrewEvent } from "../../shared/crew-events.js";
import type { Message } from "../../shared/contracts.js";


/**
 * Default options for these tests.
 *
 * `roomName` is required so ids are room-scoped. `canMutateProject` allows
 * everything by default HERE so the existing behavioural tests keep exercising
 * what they were written for; production defaults to denying, and the
 * authorisation tests below pass their own resolver.
 */
const opts = (extra: Record<string, unknown> = {}) => ({
  roomName: "AgentParty",
  canMutateProject: () => true,
  ...extra,
});

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

/** A payload only. Identity, ordering and time now come from the transport. */
const payload: CrewEvent = { type: "task.transitioned", taskId: "t1", to: "blocked", blocker: "waiting on auth" };

/** A well-formed request as an agent would send it. */
const envelope = { version: 1, payload };

const fenced = (body: unknown) => ["```crew-event", JSON.stringify(body), "```"].join("\n");

describe("adaptMessages", () => {
  it("extracts a validated, authorized envelope", () => {
    const result = adaptMessages([message(1, fenced(envelope))], opts());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload).toEqual(payload);
    // Authority fields come from transport, not from the body.
    expect(result.events[0]).toMatchObject({
      eventId: "wh:AgentParty:1:0",
      source: "codex",
      sourceCursor: 1,
      occurredAt: "2026-09-03T00:00:00Z",
    });
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

    const result = adaptMessages(prose, opts());

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
    ], opts());

    // Previously an accepted envelope removed the message, silently deleting
    // the human's words around it. State and transcript are separate concerns.
    expect(result.events).toHaveLength(1);
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0].content).toContain("Taking this now.");
  });

  it("keeps a message whose envelope was refused", () => {
    const result = adaptMessages([message(1, `Here is my update.\n${fenced({ version: 9 })}`)], opts());

    expect(result.transcript).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("preserves every message in order regardless of contents", () => {
    const result = adaptMessages([
      message(1, "prose"),
      message(2, fenced(envelope)),
      message(3, "```crew-event\n{bad json}\n```"),
      message(4, "diagram.png", { msgType: "attachment" }),
    ], opts());

    expect(result.transcript.map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("streaming messages", () => {
  it("ignores envelopes while the message is still being written", () => {
    // A streaming message may be truncated mid-object, or look complete now and
    // differ once finished. Applying it early shows state the author has not
    // committed to.
    const result = adaptMessages([message(1, fenced(envelope), { streaming: true })], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([]);
    // It still belongs in the transcript — the human can see it being typed.
    expect(result.transcript).toHaveLength(1);
  });

  it("applies the same envelope once the message is finalized", () => {
    const partial = message(1, fenced(envelope), { streaming: true });
    const final = message(1, fenced(envelope), { streaming: false });

    expect(adaptMessages([partial], opts()).events).toEqual([]);
    expect(adaptMessages([final], opts()).events).toHaveLength(1);
  });

  it("does not apply a partial envelope that happens to parse", () => {
    // A truncated block whose JSON is still valid is the dangerous case.
    const truncated = fenced({ version: 1, payload: { type: "task.transitioned", taskId: "t1", to: "done" } });
    const result = adaptMessages([message(1, truncated, { streaming: true })], opts());

    expect(result.events).toEqual([]);
  });
});

describe("echo handling is by event identity, not author", () => {
  it("accepts our own events when they are new", () => {
    // Suppressing everything from our own username would discard our own
    // legitimate events — the reason that approach was removed.
    const result = adaptMessages([message(1, fenced(envelope), { username: "claude-nikk2mbp" })], opts());

    expect(result.events).toHaveLength(1);
  });

  it("skips events already applied, whoever authored them", () => {
    // Ids are transport-derived: message 1, first block.
    const result = adaptMessages([message(1, fenced(envelope))], opts({ seenEventIds: new Set(["wh:AgentParty:1:0"]) }));

    expect(result.events).toEqual([]);
  });

  it("treats the same message replayed twice as one event", () => {
    // A poll window that overlaps a previous one re-delivers messages; the
    // transport-derived id makes that idempotent.
    const result = adaptMessages([message(1, fenced(envelope)), message(1, fenced(envelope))], opts());

    expect(result.events).toHaveLength(1);
  });

  it("treats two genuinely different messages as two events", () => {
    // Previously an identical body meant an identical eventId, so a real second
    // action was silently swallowed. Ids now come from transport, so distinct
    // messages stay distinct even when their content matches exactly.
    const result = adaptMessages([
      message(1, fenced(envelope), { username: "codex" }),
      message(2, fenced(envelope), { username: "someone-else" }),
    ], opts());

    expect(result.events.map((e) => e.eventId)).toEqual(["wh:AgentParty:1:0", "wh:AgentParty:2:0"]);
  });
});

describe("runtime validation of payload contents", () => {
  // The previous version checked only that payload.type was known and passed
  // the contents through unvalidated — a cast standing in for validation, at
  // the one boundary whose whole job is refusing untrusted input.

  it("rejects a known type carrying garbage", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, payload: { type: "task.upserted", task: { nonsense: true } } })),
    ], opts());

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
    const result = adaptMessages([message(1, fenced({ ...envelope, payload }))], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain(expected);
  });

  it("rejects an unparseable nested timestamp instead of defaulting it", () => {
    // Defaulting to the epoch would order the log wrongly while looking
    // correct, which is worse than dropping the event. The envelope's own
    // occurredAt now comes from transport; this covers timestamps inside a
    // payload, which are still author-supplied.
    const garbage = adaptMessages([message(1, fenced({
      version: 1,
      payload: { type: "message.received", message: { id: 1, roomName: "r", username: "u", content: "c", createdAt: "not a date" } },
    }))], opts());

    expect(garbage.events).toEqual([]);
    expect(garbage.rejected[0].reason).toContain("timestamp");
  });

  it.each([
    ["a cursor", { sourceCursor: 1 }, "sourceCursor"],
    ["an eventId", { eventId: "e1" }, "eventId"],
    ["a source", { source: "codex" }, "source"],
    ["a timestamp", { occurredAt: "2026-09-03T00:00:00Z" }, "occurredAt"],
  ])("refuses a body that tries to set %s", (_label, override, expected) => {
    // These are authority claims. They are refused rather than ignored, so a
    // forgery attempt is visible in the rejection log instead of silently
    // succeeding in a weaker form.
    const result = adaptMessages([message(1, fenced({ ...envelope, ...override }))], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain(expected);
  });

  it("fails closed on an unknown envelope version", () => {
    const result = adaptMessages([message(1, fenced({ ...envelope, version: 2 }))], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("version");
  });

  it("refuses an unknown event type", () => {
    const result = adaptMessages([
      message(1, fenced({ ...envelope, payload: { type: "task.deleted", taskId: "t1" } })),
    ], opts());

    expect(result.rejected[0].reason).toContain("unknown event type");
  });

  it("rebuilds the value so smuggled extra keys cannot survive", () => {
    const result = adaptMessages([
      message(1, fenced({ version: 1, payload: { ...payload, injected: "also" } })),
    ], opts());

    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result.events[0])).not.toContain("also");
  });
});

describe("prototype pollution and size bounds", () => {
  it.each(["__proto__", "constructor", "prototype"])("rejects an envelope with a %s key", (key) => {
    const result = adaptMessages([message(1, `\`\`\`crew-event\n{"version":1,"${key}":{}}\n\`\`\``)], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain(key);
  });

  it("rejects a polluting key nested inside a payload", () => {
    const result = adaptMessages([
      message(1, `\`\`\`crew-event\n{"version":1,"eventId":"e","source":"s","sourceCursor":1,"occurredAt":"2026-09-03T00:00:00Z","payload":{"type":"task.upserted","task":{"__proto__":{"polluted":true},"id":"t","title":"t","status":"backlog","points":1}}}\n\`\`\``),
    ], opts());

    expect(result.events).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects an oversized envelope before parsing it", () => {
    const huge = fenced({ ...envelope, payload: { ...envelope.payload, blocker: "x".repeat(LIMITS.maxEnvelopeBytes) } });
    const result = adaptMessages([message(1, huge)], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("bytes");
  });

  it("rejects a message carrying too many envelopes", () => {
    const many = Array.from({ length: LIMITS.maxEnvelopesPerMessage + 1 }, (_, i) =>
      fenced({ ...envelope, eventId: `e${i}` }),
    ).join("\n");
    const result = adaptMessages([message(1, many)], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("limit");
  });

  it("rejects an over-long string field", () => {
    const result = adaptMessages([
      message(1, fenced({
        version: 1,
        payload: { type: "task.transitioned", taskId: "x".repeat(LIMITS.maxStringLength + 1), to: "done" },
      })),
    ], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("characters");
  });

  it("rejects an over-long array", () => {
    const result = adaptMessages([
      message(1, fenced({
        ...envelope,
        payload: { type: "presence.snapshotted", usernames: Array.from({ length: LIMITS.maxArrayLength + 1 }, () => "u") },
      })),
    ], opts());

    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("entries");
  });
});

describe("wire format", () => {
  it("retains task ownership, acceptance, discussion, links, and images", () => {
    const richTask: CrewEvent = {
      type: "task.upserted",
      task: {
        id: "rules",
        projectId: "many-player-go",
        title: "Agree on rules",
        status: "assigned",
        points: 3,
        owners: ["baiwei", "codex"],
        acceptedBy: ["codex"],
        comments: [{ id: "c1", author: "nikk", body: "Keep the rules simple.", createdAt: "2026-09-04T00:00:00Z" }],
        links: [{ label: "Go rules", href: "https://example.test/rules" }],
        images: [{ label: "Board sketch", href: "https://example.test/board.png" }],
      },
    };
    const result = adaptMessages([message(1, encodeActionRequest(richTask))], opts());
    expect(result.events[0].payload).toEqual(richTask);
  });

  it("rejects acceptance attributed to somebody who is not an owner", () => {
    const result = adaptMessages([message(1, encodeActionRequest({
      type: "task.upserted",
      task: {
        id: "rules",
        projectId: "many-player-go",
        title: "Agree on rules",
        status: "assigned",
        points: 3,
        owners: ["baiwei"],
        acceptedBy: ["codex"],
      },
    }))], opts());
    expect(result.events).toEqual([]);
    expect(result.rejected[0].reason).toContain("not an owner");
  });

  it("round-trips through encodeActionRequest", () => {
    // If encoder and parser disagree, agents emit blocks nobody can read.
    const result = adaptMessages([message(1, encodeActionRequest(payload))], opts());

    expect(result.events[0].payload).toEqual(payload);
    expect(result.events[0].source).toBe("codex");
  });

  it("handles several blocks in one message, in order", () => {
    const second = { version: 1, payload: { type: "task.transitioned", taskId: "t1", to: "done" } };
    const result = adaptMessages([message(1, `${fenced(envelope)}\n${fenced(second)}`)], opts());

    expect(result.events.map((e) => e.eventId)).toEqual(["wh:AgentParty:1:0", "wh:AgentParty:1:1"]);
  });

  it("reports malformed JSON instead of throwing", () => {
    const result = adaptMessages([message(1, "```crew-event\n{not json}\n```")], opts());

    expect(result.rejected[0].reason).toContain("JSON");
  });
});
