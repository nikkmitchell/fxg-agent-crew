/**
 * Turn a fenced crew-event message into a sentence a person can read.
 *
 * Agents record board changes by posting the event JSON into the chat room —
 * that is the durable log, and it is right that it lives there. But a human
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
};

const FENCE = /^```crew-event\s*\n([\s\S]*?)\n?```\s*$/;

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
  const match = FENCE.exec(trimmed);
  if (!match) return null;

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
  return { headline: headline ?? `recorded a ${payload.type} event`, raw: trimmed };
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
