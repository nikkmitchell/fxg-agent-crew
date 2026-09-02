import type { Message } from "../../shared/contracts.js";
import { LIMITS, validateEnvelope, type EventEnvelope } from "../../shared/crew-events.js";

/**
 * Turn WebHarness room messages into validated CrewEvent envelopes.
 *
 * THE RULE: a message drives application state only if it carries an explicit,
 * fully-validated envelope. Everything else is chat — it renders in the feed and
 * changes nothing.
 *
 * We do not infer state from prose. It would be easy: an agent writes "I am
 * blocked on auth" and a regex turns that into a blocked task. That is the exact
 * failure this product exists to avoid — a mission-control screen making
 * confident claims the data does not support. A blocker the system invented is
 * worse than one it missed, because a human acts on it.
 *
 * Nothing here trusts a type annotation. Content arrives from a room anyone can
 * post to, so every field is inspected at runtime by shared/crew-events.ts and
 * the validated value is rebuilt rather than passed through.
 */

/** Agents wrap envelopes in this fence so human prose can never be mistaken for one. */
const FENCE = /```crew-event\s*\n([\s\S]*?)```/g;

export type AdaptResult = {
  /** Fully validated envelopes, safe to feed the reducer, in message order. */
  events: EventEnvelope[];
  /**
   * Every message, unchanged, in the order received — including ones that
   * carried envelopes.
   *
   * The transcript is a separate concern from state. A message must not vanish
   * from the conversation just because part of it was machine-readable, and a
   * malformed block must not delete the human words around it. Callers render
   * this and reduce `events`; the two are independent.
   */
  transcript: Message[];
  /**
   * Envelopes we refused, with why. Surfaced rather than swallowed: a silently
   * dropped event is indistinguishable from one that never happened, and that
   * is how an event-sourced UI drifts from reality with nobody noticing.
   */
  rejected: Array<{ messageId: number; reason: string }>;
};

export type AdaptOptions = {
  /**
   * Ids already applied. Echo prevention is by event identity, not by author:
   * suppressing everything from our own username would also discard our own
   * legitimate events, and would not help anyway, since a relayed duplicate
   * from another author must be caught regardless of who sent it.
   */
  seenEventIds?: ReadonlySet<string>;
};

export function adaptMessages(messages: Message[], { seenEventIds }: AdaptOptions = {}): AdaptResult {
  const events: EventEnvelope[] = [];
  const transcript: Message[] = [];
  const rejected: AdaptResult["rejected"] = [];
  const seenInBatch = new Set<string>();

  for (const message of messages) {
    // Every message reaches the transcript, whatever we make of its contents.
    transcript.push(message);

    // A streaming message is still being written. Its envelope may be truncated
    // mid-object, or complete-looking now and different once finished. Applying
    // it early would put state on screen that the author has not yet committed
    // to, so structured blocks are read only from the finalized message.
    if (message.streaming) continue;

    // Attachments and other non-text messages are never envelope carriers.
    if (message.msgType && message.msgType !== "text") continue;

    const blocks = [...message.content.matchAll(FENCE)];
    if (blocks.length === 0) continue;

    if (blocks.length > LIMITS.maxEnvelopesPerMessage) {
      rejected.push({
        messageId: message.id,
        reason: `message carries ${blocks.length} envelopes, limit is ${LIMITS.maxEnvelopesPerMessage}`,
      });
      continue;
    }

    for (const [, body] of blocks) {
      // Bound the input before parsing it, rather than trusting the upstream
      // 2000-character message cap — that is their invariant, not ours.
      const size = Buffer.byteLength(body, "utf8");
      if (size > LIMITS.maxEnvelopeBytes) {
        rejected.push({
          messageId: message.id,
          reason: `envelope is ${size} bytes, limit is ${LIMITS.maxEnvelopeBytes}`,
        });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        rejected.push({ messageId: message.id, reason: "envelope is not valid JSON" });
        continue;
      }

      const checked = validateEnvelope(parsed);
      if (!checked.ok) {
        rejected.push({ messageId: message.id, reason: checked.reason });
        continue;
      }

      const { eventId } = checked.value;
      if (seenEventIds?.has(eventId) || seenInBatch.has(eventId)) continue;

      seenInBatch.add(eventId);
      events.push(checked.value);
    }
  }

  return { events, transcript, rejected };
}

/** Build a fenced envelope for sending. One definition of the wire format. */
export function encodeEnvelope(envelope: EventEnvelope): string {
  return ["```crew-event", JSON.stringify(envelope, null, 2), "```"].join("\n");
}
