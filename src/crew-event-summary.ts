/**
 * Turn a fenced crew-event message into a sentence a person can read.
 *
 * Agents record board changes by posting the event JSON into the chat room —
 * that was the durable log before ADR-002 moved the board into SQLite, and
 * those fences are still the record of what happened then. But a human
 * reading the room sees walls of JSON between the actual conversation, and the
 * one thing they wanted from it ("what just changed?") is the hardest thing to
 * extract.
 *
 * This does NOT hide anything. It renders a summary and leaves the original
 * available, because the raw event is the record and a summary is an
 * interpretation. If the summary is ever wrong, the thing it summarised must
 * still be there to check it against.
 */

export type CrewEventSummary = {
  /** One line, in plain language. */
  headline: string;
  /** The original fenced payload, kept verbatim. */
  raw: string;
  /**
   * True when the author was SHOWING the event rather than performing it.
   *
   * A reader cannot otherwise tell a demonstration from a real change: both are
   * the same JSON in the same room. Before the adapter could distinguish them,
   * an example of "how to claim a card" claimed the card — so the room needs to
   * mark the difference in the place a person actually looks, not only in the
   * parser.
   */
  quoted: boolean;
  /**
   * What the event was about, when it is about one card.
   *
   * Exposed so the transcript can group a run of events by the card they touch.
   * Closing a single card costs four messages — backlog to done is not a legal
   * transition — so a board reconciliation arrives as dozens of one-line
   * transitions, and a person scrolling for judgement wades through all of it.
   */
  subject?: string;
  /** Discriminator, for grouping and for wording a collapsed summary. */
  eventType?: string;
  /** Where a transition ended up, for the same reason. */
  to?: string;
};

const FENCE = /^```crew-event\s*\n([\s\S]*?)\n?```\s*$/;
const QUOTED_FENCE = /^```crew-event-example\s*\n([\s\S]*?)\n?```\s*$/;

const statusWords: Record<string, string> = {
  backlog: "back to the backlog",
  assigned: "to assigned",
  in_progress: "to in progress",
  blocked: "to blocked",
  review: "to review",
  done: "to done",
};

/**
 * Returns null when the message is ordinary conversation, so the caller renders
 * it untouched. Anything unparseable is also null: a message that merely looks
 * like an event must not be summarised on a guess.
 */
export function summariseCrewEvent(content: string): CrewEventSummary | null {
  const trimmed = content.trim();
  const quotedMatch = QUOTED_FENCE.exec(trimmed);
  const match = quotedMatch ?? FENCE.exec(trimmed);
  if (!match) return null;
  const quoted = quotedMatch !== null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const payload = (parsed as { payload?: Record<string, unknown> })?.payload;
  if (!payload || typeof payload.type !== "string") return null;

  const headline = describe(payload);
  // An unrecognised event type is reported as such rather than dropped or
  // guessed at — a new event kind should be visible as "something happened
  // that this reader does not understand", not silently invisible.
  const plain = headline ?? `recorded a ${payload.type} event`;
  // Past tense for what happened, conditional for what did not. "Example: would
  // move…" cannot be misread as a record of a change, which "moved…" can.
  const subject = typeof payload.taskId === "string"
    ? payload.taskId
    : typeof (payload.task as { id?: unknown } | undefined)?.id === "string"
      ? ((payload.task as { id: string }).id)
      : typeof (payload.project as { id?: unknown } | undefined)?.id === "string"
        ? ((payload.project as { id: string }).id)
        : undefined;
  const details = {
    raw: trimmed,
    quoted,
    ...(subject ? { subject } : {}),
    eventType: payload.type,
    ...(typeof payload.to === "string" ? { to: payload.to } : {}),
  };

  return quoted
    ? { headline: `Example, not run — this would have ${asWouldHave(plain)}`, ...details }
    : { headline: plain, ...details };
}

function describe(payload: Record<string, unknown>): string | null {
  switch (payload.type) {
    case "project.upserted": {
      const project = payload.project as { name?: string } | undefined;
      return project?.name ? `created or updated the project “${project.name}”` : null;
    }
    case "task.upserted": {
      const task = payload.task as { title?: string; status?: string; owners?: string[] } | undefined;
      if (!task?.title) return null;
      const owners = task.owners?.length ? ` — ${task.owners.join(", ")}` : "";
      return `updated the task “${task.title}”${owners}`;
    }
    case "task.transitioned": {
      const to = typeof payload.to === "string" ? payload.to : "";
      const id = typeof payload.taskId === "string" ? payload.taskId : "a task";
      return `moved ${id} ${statusWords[to] ?? `to ${to}`}`;
    }
    case "task.commented": {
      const comment = payload.comment as { body?: string } | undefined;
      const id = typeof payload.taskId === "string" ? payload.taskId : "a task";
      const body = comment?.body?.trim() ?? "";
      const excerpt = body.length > 90 ? `${body.slice(0, 90).trimEnd()}…` : body;
      return excerpt ? `commented on ${id}: “${excerpt}”` : `commented on ${id}`;
    }
    default:
      return null;
  }
}

/**
 * Rewrite a past-tense headline so it reads as something that did NOT happen.
 *
 * Only the verb changes; everything the reader needs to identify the card is
 * left alone. Falling back to the original sentence unchanged is deliberate —
 * a summary that cannot be rephrased is still better shown than dropped, and
 * the "Example, not run" prefix carries the meaning either way.
 */
function asWouldHave(sentence: string): string {
  // Every verb `describe` can actually produce, listed rather than derived. A
  // rule that strips "-ed" would be shorter and would produce "commentt" and
  // "recor"; five entries that are right beat one rule that is nearly right.
  const verbs: Record<string, string> = {
    moved: "move",
    created: "create",
    recorded: "record",
    updated: "update",
    commented: "comment",
  };
  for (const [past, base] of Object.entries(verbs)) {
    if (sentence.startsWith(`${past} `)) return `${base} ${sentence.slice(past.length + 1)}`;
  }
  return sentence;
}
