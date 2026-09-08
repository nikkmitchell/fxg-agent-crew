import type { Message } from "../../shared/contracts.js";
import {
  LIMITS,
  authorize,
  authorizeEvent,
  denyAll,
  validateActionRequest,
  validateAuthority,
  validateTransportMessage,
  type CapabilityResolver,
  type EventEnvelope,
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

/**
 * Agents wrap requests in this fence so prose can never be mistaken for one.
 *
 * Anchored to the start of a line (CommonMark allows up to three spaces of
 * indent) because an unanchored fence executes from the middle of a sentence,
 * where a reader does not expect a command to live. Verified against the whole
 * durable log before tightening: 830 messages, 146 fences under both the old
 * and the new pattern, zero messages differing. A stricter rule applies on
 * every replay, so anything it newly refuses is silently erased from the board
 * — see ADR-001. Count first, tighten after.
 */
const FENCE = /^ {0,3}```crew-event[ \t]*\r?\n([\s\S]*?)^ {0,3}```/gm;

/**
 * The same thing, quoted. Shown, never run.
 *
 * The room is both where we explain this format to each other and the channel
 * that executes it. Until now those were the same fence, so posting an example
 * of how to claim a card CLAIMED THE CARD — attributed to the agent in the
 * example, authored by the person teaching them. That is a documentation
 * problem between colleagues and an injection primitive the moment someone
 * untrusted can post: "here is what NOT to send" is indistinguishable from
 * sending it.
 *
 * A distinct fence rather than an escape character or a no-op field inside the
 * payload. An escape is easy to forget and fails open — you find out it was
 * missing by watching the board change. A no-op flag means the executable
 * parser still reads attacker-controlled structure and one inverted boolean
 * runs it. This form never reaches the action parser at all, and the failure
 * mode of forgetting the suffix is that your example does not render as an
 * example, which is visible immediately and harms nothing.
 */
const QUOTED_FENCE = /^ {0,3}```crew-event-example[ \t]*\r?\n([\s\S]*?)^ {0,3}```/gm;

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
  /**
   * Blocks that were deliberately shown rather than run.
   *
   * Reported rather than skipped in silence, for the same reason refusals are:
   * an example that was recognised and ignored must not look identical to a
   * fence nobody parsed. Without this, a mistyped info string is
   * indistinguishable from a quotation, and the author's evidence that their
   * example was inert is "the board did not change", which is also what a
   * typo looks like.
   */
  quoted: Array<{ messageId: number; blockIndex: number; body: string }>;
};

export type AdaptOptions = {
  /** Ids already applied, so a replayed window does not re-apply them. */
  seenEventIds?: ReadonlySet<string>;
  /**
   * Authoritative room identity, used to scope event ids. Required: without it
   * two rooms can each produce a message 42 and their events collide.
   */
  roomName: string;
  /**
   * Who may perform project-level actions. Defaults to denying everything,
   * because room membership is not project authority — anyone can join a public
   * room. Task blocks from users without capability are refused and reported as
   * requests rather than applied.
   */
  canMutateProject?: CapabilityResolver;
};

export function adaptMessages(
  messages: Message[],
  { seenEventIds, roomName, canMutateProject = denyAll }: AdaptOptions,
): AdaptResult {
  const events: EventEnvelope[] = [];
  const transcript: Message[] = [];
  const rejected: AdaptResult["rejected"] = [];
  const quoted: AdaptResult["quoted"] = [];
  const seenInBatch = new Set<string>();

  for (const message of messages) {
    // The BFF establishes only that its payload is an array. Rebuild each full
    // element before returning it under the trusted Message type; otherwise a
    // prose-only message with malformed metadata bypasses every action check.
    const checked = validateTransportMessage(message);
    if (!checked.ok) {
      const rawId = (message as unknown as { id?: unknown })?.id;
      rejected.push({ messageId: Number.isSafeInteger(rawId) ? rawId as number : -1, reason: checked.reason });
      continue;
    }
    const readable = checked.value;
    transcript.push(readable);

    // A streaming message is still being written; its block may be truncated,
    // or complete-looking now and different once finished.
    if (readable.streaming) continue;
    if (readable.msgType !== "text") continue;

    // Collected BEFORE the executable pass and never handed to it. The quoted
    // body is carried as an opaque string: it is not parsed, not validated and
    // not authorized, because every one of those steps is a place where a
    // future edit could let it through.
    for (const [blockIndex, match] of [...readable.content.matchAll(QUOTED_FENCE)].entries()) {
      quoted.push({ messageId: readable.id, blockIndex, body: match[1] });
    }

    const blocks = [...readable.content.matchAll(FENCE)];
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

      // Authority comes from the transport — but transport metadata crossed a
      // network boundary too, and is typed rather than checked. Validate it
      // before deriving identity, order or time from it: if it is malformed we
      // have no authority at all and nothing may be built on it.
      const checkedAuthority = validateAuthority({
        roomName,
        messageId: message.id,
        username: message.username,
        createdAt: message.createdAt,
        blockIndex,
      });
      if (!checkedAuthority.ok) {
        rejected.push({ messageId: message.id, reason: checkedAuthority.reason });
        continue;
      }
      const authority = checkedAuthority.value;

      const permitted = authorizeEvent(request.value.payload, authority, canMutateProject);
      if (!permitted.ok) {
        rejected.push({ messageId: message.id, reason: permitted.reason });
        continue;
      }

      const envelope = authorize(
        request.value,
        authority,
      );
      if (seenEventIds?.has(envelope.eventId) || seenInBatch.has(envelope.eventId)) continue;

      seenInBatch.add(envelope.eventId);
      events.push(envelope);
    }
  }

  return { events, transcript, rejected, quoted };
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

/**
 * Build a fenced action request for SHOWING — teaching, review, an example in a
 * message. Byte-identical to `encodeActionRequest` apart from the info string,
 * so what a reader copies is exactly what they need to send once they drop the
 * `-example` suffix.
 *
 * Use this any time an event appears in prose. The old way of writing an
 * example was to write the real thing, which ran it.
 */
export function encodeQuotedExample(payload: EventEnvelope["payload"]): string {
  return ["```crew-event-example", JSON.stringify({ version: 1, payload }, null, 2), "```"].join("\n");
}
