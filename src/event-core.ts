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
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  points: number;
  blocker?: string;
};

export type CrewMessage = {
  id: number;
  roomName: string;
  username: string;
  content: string;
  createdAt: string;
};

export type CrewEvent =
  | { type: "agent.upserted"; agent: AgentProfile }
  | { type: "presence.snapshotted"; usernames: string[] }
  | { type: "task.upserted"; task: CrewTask }
  | { type: "task.transitioned"; taskId: string; to: TaskStatus; blocker?: string }
  | { type: "message.received"; message: CrewMessage };

export type EventEnvelope = {
  version: 1;
  eventId: string;
  source: string;
  sourceCursor: number;
  occurredAt: string;
  payload: CrewEvent;
};

export type CrewState = {
  agents: Record<string, AgentProfile>;
  tasks: Record<string, CrewTask>;
  messages: CrewMessage[];
  cursors: Record<string, number>;
  seenEventIds: Record<string, true>;
  rejectedEvents: Array<{ eventId: string; reason: string }>;
};

export const initialCrewState: CrewState = {
  agents: {},
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
 * Cap on retained event ids.
 *
 * seenEventIds previously grew without bound — 1000 events meant 1000 keys
 * retained forever, which for a long-lived dashboard polling a busy room is a
 * slow leak.
 *
 * It cannot simply be truncated, because dropping an id makes replay
 * non-idempotent again: a re-delivered event whose id was evicted would apply a
 * second time, which is exactly the property the replay tests pin. So eviction
 * is bounded by the cursor instead — an id is only dropped once its source
 * cursor has advanced past it, since WebHarness will not re-deliver a message
 * older than a cursor we have already passed. Anything still reachable by a
 * reconnect is kept.
 */
const MAX_SEEN_EVENT_IDS = 5000;

/**
 * Evict only ids that can no longer legitimately reappear.
 *
 * eventIds are wh:<messageId>:<blockIndex>, so the messageId embedded in the id
 * is comparable with the source cursor. Ids that do not parse are never evicted
 * — an unrecognised format means we cannot prove it is safe to forget.
 */
function pruneSeenEventIds(seen: Record<string, true>, cursors: Record<string, number>): Record<string, true> {
  const entries = Object.keys(seen);
  if (entries.length <= MAX_SEEN_EVENT_IDS) return seen;

  const lowestCursor = Math.min(...Object.values(cursors), Infinity);
  const kept: Record<string, true> = {};
  for (const id of entries) {
    const match = /^wh:(\d+):\d+$/.exec(id);
    // Keep anything we cannot prove is unreachable, including foreign formats.
    if (!match || Number(match[1]) >= lowestCursor) kept[id] = true;
  }
  return kept;
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
  // confirmed end-to-end against a live server, not only in tests.
  //
  // Uniqueness is already guaranteed by eventId, which is
  // wh:<messageId>:<blockIndex>, and replay protection comes from seenEventIds
  // above. The cursor only needs to be non-decreasing, to reject genuinely
  // stale deliveries from an older poll window.
  const lastCursor = state.cursors[event.source] ?? -1;
  if (event.sourceCursor < lastCursor) return reject(state, event.eventId, "stale source cursor");

  const cursors = { ...state.cursors, [event.source]: event.sourceCursor };
  const next: CrewState = {
    ...state,
    cursors,
    seenEventIds: pruneSeenEventIds({ ...state.seenEventIds, [event.eventId]: true }, cursors),
  };

  switch (event.payload.type) {
    case "agent.upserted":
      return { ...next, agents: { ...next.agents, [event.payload.agent.id]: event.payload.agent } };
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
    case "task.upserted":
      return { ...next, tasks: { ...next.tasks, [event.payload.task.id]: event.payload.task } };
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
