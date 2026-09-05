export type TaskKind = "decision" | "build";

export type TaskStatus = "backlog" | "assigned" | "in_progress" | "blocked" | "review" | "done";

export type AgentProfile = {
  id: string;
  name: string;
  avatarSeed: string;
  model?: string;
  runtime?: string;
  coarseLocation?: string;
  online: boolean;
};

export type CrewTask = {
  id: string;
  projectId?: string;
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  points: number;
  blocker?: string;
  /**
   * Whether finishing this card means a DECISION was reached or a THING WAS
   * BUILT.
   *
   * The board previously showed nine tasks, eight of them "done", while nothing
   * ran. Every one was a decision, and "done" was read — reasonably — as "this
   * works". A human asked "how do I test this?" precisely because the board had
   * told him there was something to test.
   *
   * For a product whose rule is that the screen may only say what it can prove,
   * a done column that conflates decided with built is the wrong claim to leave
   * standing.
   *
   * OPTIONAL ON PURPOSE. Absent means nobody has said which, and that is
   * reported as unspecified rather than defaulted. Guessing "decision" for
   * existing cards would relabel other people's work retroactively on an
   * assumption, which is the same error in a smaller costume.
   */
  kind?: TaskKind;
  owners?: string[];
  acceptedBy?: string[];
  comments?: TaskComment[];
  links?: Array<{ label: string; href: string }>;
  images?: Array<{ label: string; href: string }>;
};

export type TaskComment = { id: string; author: string; body: string; createdAt: string };

export type CrewProject = {
  id: string;
  name: string;
  summary: string;
  goals: string[];
  steps: Array<{ id: string; title: string; status: "not_started" | "in_progress" | "done" }>;
};

export type CrewMessage = {
  id: number;
  roomName: string;
  username: string;
  content: string;
  createdAt: string;
};

export type CrewEvent =
  | { type: "agent.upserted"; agent: Omit<AgentProfile, "online"> }
  | { type: "presence.snapshotted"; usernames: string[] }
  | { type: "project.upserted"; project: CrewProject }
  | { type: "task.upserted"; task: CrewTask }
  | { type: "task.transitioned"; taskId: string; to: TaskStatus; blocker?: string }
  /**
   * One comment, appended.
   *
   * Adding a comment used to mean re-sending the WHOLE task with a longer
   * comments array. That has two defects, and both are real rather than
   * theoretical:
   *
   * 1. LOST UPDATES. Two people commenting on the same card concurrently each
   *    send the whole card from the state they last read, so the second write
   *    silently discards the first person's comment along with any other field
   *    they changed. It has not bitten this team only because we take turns.
   *
   * 2. SIZE. A durable event must fit in one 2000-character room message, and
   *    re-sending every prior comment each time means a card gets harder to
   *    add to the more discussion it has. The third real comment is typically
   *    where it stops being writable.
   *
   * Appending one comment fixes both: the payload is bounded by the comment
   * rather than by the card's history, and two appends commute so neither can
   * erase the other.
   */
  | { type: "task.commented"; taskId: string; comment: TaskComment }
  | { type: "message.received"; message: CrewMessage };

export type EventEnvelope = {
  version: 1;
  eventId: string;
  /**
   * The ordered stream this event belongs to — the room. Cursors are keyed by
   * stream and author together, because message ids are per-room sequences: the
   * same user at room-A message 100 and room-B message 1 is not going
   * backwards.
   *
   * NOTE: this type is duplicated in shared/crew-events.ts, which is the wire
   * contract. They must be kept in step — a mismatch compiles on one side and
   * fails on the other, which is how this field was missed here first.
   */
  stream: string;
  /** Authenticated author. Identity, not ordering. */
  source: string;
  sourceCursor: number;
  occurredAt: string;
  payload: CrewEvent;
};

export type CrewState = {
  agents: Record<string, AgentProfile>;
  projects: Record<string, CrewProject>;
  tasks: Record<string, CrewTask>;
  messages: CrewMessage[];
  cursors: Record<string, number>;
  seenEventIds: Record<string, true>;
  rejectedEvents: Array<{ eventId: string; reason: string }>;
};

export const initialCrewState: CrewState = {
  agents: {},
  projects: {},
  tasks: {},
  messages: [],
  cursors: {},
  seenEventIds: {},
  rejectedEvents: [],
};

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["assigned"],
  assigned: ["in_progress", "backlog"],
  in_progress: ["blocked", "review"],
  blocked: ["in_progress", "backlog"],
  review: ["in_progress", "blocked", "done"],
  done: ["review"],
};

/**
 * Ordering is per stream+author. The stream carries the id sequence; the author
 * is retained so one participant cannot rewind another's position within it.
 */
function cursorKey(event: EventEnvelope): string {
  return `${event.stream}\u0000${event.source}`;
}

function reject(state: CrewState, eventId: string, reason: string): CrewState {
  return {
    ...state,
    seenEventIds: { ...state.seenEventIds, [eventId]: true },
    rejectedEvents: [...state.rejectedEvents, { eventId, reason }].slice(-50),
  };
}

export function reduceCrewEvent(state: CrewState, event: EventEnvelope): CrewState {
  if (event.version !== 1) return reject(state, event.eventId, "unsupported event version");
  if (state.seenEventIds[event.eventId]) return state;

  // Strictly-less rather than less-or-equal. Cursors are transport-derived
  // (a WebHarness message id), so several events can legitimately share one:
  // two fenced blocks in a single message carry the same cursor. Rejecting on
  // equality silently dropped every action after the first in such a message —
  // confirmed end-to-end against a running local instance, not only in tests.
  //
  // Uniqueness is already guaranteed by eventId, and replay protection comes
  // from seenEventIds above. The cursor only needs to be non-decreasing, to
  // reject genuinely stale deliveries from an older poll window.
  //
  // Keyed by STREAM, not author. Message ids are per-room sequences, so the
  // same user posting in room A at 100 and room B at 1 is not going backwards —
  // keying by username alone made every event in the quieter room look stale.
  const streamKey = cursorKey(event);
  const lastCursor = state.cursors[streamKey] ?? -1;
  if (event.sourceCursor < lastCursor) return reject(state, event.eventId, "stale source cursor");

  const next: CrewState = {
    ...state,
    cursors: { ...state.cursors, [streamKey]: event.sourceCursor },
    // seenEventIds is deliberately unbounded for now. A previous attempt to cap
    // it made replay non-idempotent above the threshold — evicted ids came back
    // as stale-cursor rejections, which mutate state — and the test claiming
    // otherwise was vacuous, exercising 20 events against a 5000-event cap so
    // the pruning never ran. Bounding it correctly needs the room-scoped
    // ordering key from the adapter work; until then an unbounded set is the
    // honest choice, because a slow leak is better than silently breaking the
    // one property this reducer exists to guarantee.
    seenEventIds: { ...state.seenEventIds, [event.eventId]: true },
  };

  switch (event.payload.type) {
    case "agent.upserted": {
      // A profile update must PRESERVE observed presence, not reset it. The
      // event carries no `online` field, and an existing observation survives
      // the merge — otherwise every profile edit would silently mark a working
      // agent as offline until the next presence snapshot.
      const existing = next.agents[event.payload.agent.id];
      return {
        ...next,
        agents: {
          ...next.agents,
          [event.payload.agent.id]: { ...event.payload.agent, online: existing?.online ?? false },
        },
      };
    }
    case "presence.snapshotted": {
      const online = new Set(event.payload.usernames);
      return {
        ...next,
        // Match on ID, not name. `usernames` carries authenticated transport
        // usernames and agents are keyed by that same id; `name` is a mutable
        // self-chosen display name ("Inkstone" for baipad-gpt001). Matching on
        // name marked every agent offline permanently, and did so SILENTLY —
        // no rejection, no error, just a crew strip quietly claiming nobody is
        // working. On a product whose first promise is showing who is active,
        // that is the worst shape of failure: confidently wrong, no signal.
        agents: Object.fromEntries(Object.entries(next.agents).map(([id, agent]) => [id, { ...agent, online: online.has(id) }])),
      };
    }
    case "project.upserted":
      return { ...next, projects: { ...next.projects, [event.payload.project.id]: event.payload.project } };
    case "task.upserted":
      if (event.payload.task.projectId && !next.projects[event.payload.task.projectId]) {
        return reject(next, event.eventId, "project not found");
      }
      return { ...next, tasks: { ...next.tasks, [event.payload.task.id]: event.payload.task } };
    case "task.commented": {
      const task = next.tasks[event.payload.taskId];
      if (!task) return reject(next, event.eventId, "task not found");
      const existing = task.comments ?? [];
      // Bound before the callback: narrowing of event.payload is lost inside a
      // closure, so reading it there fails to compile.
      const incoming = event.payload.comment;
      // Idempotent by comment id. A retried append — after a timeout where the
      // write actually landed — must not produce the comment twice.
      if (existing.some((comment) => comment.id === incoming.id)) return next;
      return {
        ...next,
        tasks: {
          ...next.tasks,
          [event.payload.taskId]: { ...task, comments: [...existing, incoming] },
        },
      };
    }
    case "task.transitioned": {
      const task = next.tasks[event.payload.taskId];
      if (!task) return reject(next, event.eventId, "task not found");
      if (!allowedTransitions[task.status].includes(event.payload.to)) {
        return reject(next, event.eventId, `invalid transition: ${task.status} -> ${event.payload.to}`);
      }
      if (event.payload.to === "blocked" && !event.payload.blocker?.trim()) {
        return reject(next, event.eventId, "blocked tasks require a reason");
      }
      return {
        ...next,
        tasks: {
          ...next.tasks,
          [task.id]: {
            ...task,
            status: event.payload.to,
            blocker: event.payload.to === "blocked" ? event.payload.blocker?.trim() : undefined,
          },
        },
      };
    }
    case "message.received": {
      const message = event.payload.message;
      return {
        ...next,
        messages: [...next.messages.filter((item) => item.id !== message.id), message]
          .sort((a, b) => a.id - b.id)
          .slice(-500),
      };
    }
  }
}
