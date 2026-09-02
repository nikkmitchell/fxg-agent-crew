import type { CrewEvent, EventEnvelope } from "../../src/event-core.js";
import type { Message } from "../../shared/contracts.js";

/**
 * Turn WebHarness room messages into CrewEvent envelopes.
 *
 * THE RULE THIS ENFORCES: a message drives application state only if it carries
 * an explicit, structured envelope. Everything else is chat — it renders in the
 * feed and changes nothing.
 *
 * We do not infer task state from prose. It is tempting: an agent writes "I am
 * blocked on auth" and it would be easy to regex that into a blocked task. That
 * is precisely the failure this product exists to avoid — a mission-control
 * screen showing confident claims the data does not support. A blocker the
 * system invented is worse than a blocker it missed, because a human acts on it.
 *
 * So the contract (proposed msg 260, accepted by baipad msg 251) is: agents emit
 * a fenced ```crew-event block containing the envelope JSON. Humans keep typing
 * normally and nothing breaks.
 */

/** Agents wrap envelopes in this fence so human prose can never be mistaken for one. */
const FENCE = /```crew-event\s*\n([\s\S]*?)```/g;

export type AdaptResult = {
  /** Envelopes safe to feed the reducer, in message order. */
  events: EventEnvelope[];
  /** Messages carrying no envelope. Feed content only — these drive no state. */
  chat: Message[];
  /**
   * Envelopes we refused, with why. Surfaced rather than swallowed: a silently
   * dropped event looks identical to one that never happened, and that is how
   * an event-sourced UI drifts from reality without anyone noticing.
   */
  rejected: Array<{ messageId: number; reason: string }>;
};

/** Event payload shapes the reducer understands. Anything else is refused. */
const KNOWN_TYPES = new Set<CrewEvent["type"]>([
  "agent.upserted",
  "presence.snapshotted",
  "task.upserted",
  "task.transitioned",
  "message.received",
]);

function validate(parsed: unknown, messageId: number): { ok: true; envelope: EventEnvelope } | { ok: false; reason: string } {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "envelope is not an object" };
  }
  const candidate = parsed as Partial<EventEnvelope>;

  // Fail closed on versions we do not understand, rather than applying the
  // fields we happen to recognise. A partially-understood event is a lie.
  if (candidate.version !== 1) {
    return { ok: false, reason: `unsupported envelope version: ${String(candidate.version)}` };
  }
  if (typeof candidate.eventId !== "string" || candidate.eventId === "") {
    return { ok: false, reason: "missing eventId" };
  }
  if (typeof candidate.source !== "string" || candidate.source === "") {
    return { ok: false, reason: "missing source" };
  }
  if (typeof candidate.sourceCursor !== "number" || !Number.isFinite(candidate.sourceCursor)) {
    return { ok: false, reason: "missing or non-numeric sourceCursor" };
  }
  const payload = candidate.payload as CrewEvent | undefined;
  if (!payload || typeof payload !== "object" || !KNOWN_TYPES.has(payload.type)) {
    return { ok: false, reason: `unknown event type: ${String(payload?.type)}` };
  }

  return {
    ok: true,
    envelope: {
      version: 1,
      eventId: candidate.eventId,
      source: candidate.source,
      sourceCursor: candidate.sourceCursor,
      occurredAt: candidate.occurredAt ?? new Date(0).toISOString(),
      payload,
    },
  };
}

export type AdaptOptions = {
  /**
   * Our own username. Messages we sent are skipped entirely so a poll cannot
   * feed our own writes back in as new events — the echo loop the transport
   * boundary was scoped to prevent.
   */
  selfUsername?: string;
};

export function adaptMessages(messages: Message[], { selfUsername }: AdaptOptions = {}): AdaptResult {
  const events: EventEnvelope[] = [];
  const chat: Message[] = [];
  const rejected: AdaptResult["rejected"] = [];

  for (const message of messages) {
    if (selfUsername && message.username === selfUsername) continue;

    // Non-text messages (attachments) are never envelope carriers.
    if (message.msgType && message.msgType !== "text") {
      chat.push(message);
      continue;
    }

    const blocks = [...message.content.matchAll(FENCE)];
    if (blocks.length === 0) {
      chat.push(message);
      continue;
    }

    let acceptedAny = false;
    for (const [, body] of blocks) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        rejected.push({ messageId: message.id, reason: "envelope is not valid JSON" });
        continue;
      }

      const result = validate(parsed, message.id);
      if (result.ok) {
        events.push(result.envelope);
        acceptedAny = true;
      } else {
        rejected.push({ messageId: message.id, reason: result.reason });
      }
    }

    // A message can carry an envelope AND prose around it. If every envelope in
    // it was refused, the message still belongs in the feed — otherwise a
    // malformed block would make a human's words vanish from the transcript.
    if (!acceptedAny) chat.push(message);
  }

  return { events, chat, rejected };
}

/** Build a fenced envelope for sending. Agents use this so the format has one definition. */
export function encodeEnvelope(envelope: EventEnvelope): string {
  return ["```crew-event", JSON.stringify(envelope, null, 2), "```"].join("\n");
}
