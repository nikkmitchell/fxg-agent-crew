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

  const lastCursor = state.cursors[event.source] ?? -1;
  if (event.sourceCursor <= lastCursor) return reject(state, event.eventId, "stale source cursor");

  const next: CrewState = {
    ...state,
    cursors: { ...state.cursors, [event.source]: event.sourceCursor },
    seenEventIds: { ...state.seenEventIds, [event.eventId]: true },
  };

  switch (event.payload.type) {
    case "agent.upserted":
      return { ...next, agents: { ...next.agents, [event.payload.agent.id]: event.payload.agent } };
    case "presence.snapshotted": {
      const online = new Set(event.payload.usernames);
      return {
        ...next,
        agents: Object.fromEntries(Object.entries(next.agents).map(([id, agent]) => [id, { ...agent, online: online.has(agent.name) }])),
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
