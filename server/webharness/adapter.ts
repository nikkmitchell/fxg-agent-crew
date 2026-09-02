import type { Message } from "../../shared/contracts.js";
import {
  LIMITS,
  authorize,
  authorizeEvent,
  validateActionRequest,
  type EventEnvelope,
  type TransportAuthority,
} from "../../shared/crew-events.js";

/**
 * Turn WebHarness room messages into authorized CrewEvent envelopes.
 *
 * TWO RULES, and the second was missing until review caught it.
 *
 * 1. A message drives state only if it carries an explicit fenced block. Prose
 *    never does. An agent writing "I am blocked on auth" is a sentence, not a
 *    state change; inferring one would put a claim on a mission-control screen
 *    that no event supports, and a blocker the system invented is worse than
 *    one it missed, because a human acts on it.
 *
 * 2. VALIDATED IS NOT AUTHORIZED. The previous version validated every field of
 *    an envelope and then trusted the result — even though eventId, source,
 *    sourceCursor and occurredAt were all authored inside a chat message that
 *    anyone can post to. The forgeries would have been perfectly well-formed:
 *    name another agent as `source`, rewrite someone else's profile, fabricate
 *    presence, attribute an utterance to a human, preempt a legitimate eventId
 *    so the real one deduplicates away, or set a cursor that reorders the log.
 *
 *    So a fenced block is now only a REQUESTED ACTION. Identity, ordering and
 *    time come from transport metadata that WebHarness authenticates, and each
 *    action is separately checked against what its sender is allowed to do.
 */

/** Agents wrap requests in this fence so prose can never be mistaken for one. */
const FENCE = /```crew-event\s*\n([\s\S]*?)```/g;

export type AdaptResult = {
  /** Authorized envelopes, safe to reduce. */
  events: EventEnvelope[];
  /**
   * Every message, unchanged and in order — including ones carrying actions.
   * The transcript is a separate concern from state: a message must not vanish
   * because part of it was machine-readable, and a rejected block must not
   * delete the human words around it.
   */
  transcript: Message[];
  /**
   * Refusals with reasons. Surfaced rather than swallowed — a silently dropped
   * event is indistinguishable from one that never happened, and a silently
   * dropped forgery hides an attack.
   */
  rejected: Array<{ messageId: number; reason: string }>;
};

export type AdaptOptions = {
  /** Ids already applied, so a replayed window does not re-apply them. */
  seenEventIds?: ReadonlySet<string>;
};

export function adaptMessages(messages: Message[], { seenEventIds }: AdaptOptions = {}): AdaptResult {
  const events: EventEnvelope[] = [];
  const transcript: Message[] = [];
  const rejected: AdaptResult["rejected"] = [];
  const seenInBatch = new Set<string>();

  for (const message of messages) {
    transcript.push(message);

    // A streaming message is still being written; its block may be truncated,
    // or complete-looking now and different once finished.
    if (message.streaming) continue;
    if (message.msgType && message.msgType !== "text") continue;

    const blocks = [...message.content.matchAll(FENCE)];
    if (blocks.length === 0) continue;

    if (blocks.length > LIMITS.maxEnvelopesPerMessage) {
      rejected.push({
        messageId: message.id,
        reason: `message carries ${blocks.length} blocks, limit is ${LIMITS.maxEnvelopesPerMessage}`,
      });
      continue;
    }

    for (const [blockIndex, match] of blocks.entries()) {
      const body = match[1];

      // Bound before parsing rather than trusting upstream's message cap, which
      // is their invariant and not ours.
      const size = Buffer.byteLength(body, "utf8");
      if (size > LIMITS.maxEnvelopeBytes) {
        rejected.push({ messageId: message.id, reason: `block is ${size} bytes, limit is ${LIMITS.maxEnvelopeBytes}` });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        rejected.push({ messageId: message.id, reason: "block is not valid JSON" });
        continue;
      }

      const request = validateActionRequest(parsed);
      if (!request.ok) {
        rejected.push({ messageId: message.id, reason: request.reason });
        continue;
      }

      // Authority comes from the transport, never from what was typed.
      const authority: TransportAuthority = {
        messageId: message.id,
        username: message.username,
        createdAt: message.createdAt,
        blockIndex,
      };

      const permitted = authorizeEvent(request.value.payload, authority);
      if (!permitted.ok) {
        rejected.push({ messageId: message.id, reason: permitted.reason });
        continue;
      }

      const envelope = authorize(request.value, authority);
      if (seenEventIds?.has(envelope.eventId) || seenInBatch.has(envelope.eventId)) continue;

      seenInBatch.add(envelope.eventId);
      events.push(envelope);
    }
  }

  return { events, transcript, rejected };
}

/**
 * Build a fenced action request for sending.
 *
 * Takes only the payload: an author cannot set identity, ordering or time, and
 * the encoder deliberately offers no way to try. One definition of the wire
 * format, so encoder and parser cannot drift.
 */
export function encodeActionRequest(payload: EventEnvelope["payload"]): string {
  return ["```crew-event", JSON.stringify({ version: 1, payload }, null, 2), "```"].join("\n");
}
