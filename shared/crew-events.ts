/**
 * The crew event wire schema, plus its runtime validator.
 *
 * This lives in shared/ because both the server and the UI need it and neither
 * should reach into the other's tree — the adapter previously imported these
 * types from src/, which made the BFF depend on the UI's source layout.
 *
 * Everything here validates at RUNTIME. A TypeScript annotation on data that
 * arrived over a network is a claim about what we hope was sent, not a check
 * that it was; the type system is gone by the time the bytes land. Every field
 * below is therefore inspected, not asserted.
 */

export type TaskStatus = "backlog" | "assigned" | "in_progress" | "blocked" | "review" | "done";

const TASK_STATUSES: readonly TaskStatus[] = [
  "backlog", "assigned", "in_progress", "blocked", "review", "done",
];

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

/* ---------------------------------------------------------------- limits -- */

/**
 * Bounds applied before and during parsing. Content arrives from a chat room
 * that anyone can post to, so "the server caps messages at 2000 chars" is not
 * something to rely on — that is their invariant, not ours.
 */
export const LIMITS = {
  maxEnvelopeBytes: 8_192,
  maxEnvelopesPerMessage: 8,
  maxStringLength: 512,
  maxArrayLength: 128,
  maxPoints: 10_000,
  maxCursor: Number.MAX_SAFE_INTEGER,
} as const;

/* ------------------------------------------------------------- primitives -- */

export type Invalid = { ok: false; reason: string };
export type Valid<T> = { ok: true; value: T };
export type Checked<T> = Valid<T> | Invalid;

const bad = (reason: string): Invalid => ({ ok: false, reason });

/** Keys that would let a crafted payload reach Object.prototype. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A plain object with no prototype-polluting keys. `JSON.parse` will not set
 * __proto__ as a normal property, but a nested object carrying these keys can
 * still reach code that later spreads or merges it, so they are refused here
 * rather than trusted to be harmless downstream.
 */
function plainObject(value: unknown, label: string): Checked<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return bad(`${label} is not an object`);
  }
  for (const key of Object.keys(value as object)) {
    if (FORBIDDEN_KEYS.has(key)) return bad(`${label} contains forbidden key: ${key}`);
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function str(value: unknown, label: string, { max = LIMITS.maxStringLength, allowEmpty = false } = {}): Checked<string> {
  if (typeof value !== "string") return bad(`${label} is not a string`);
  if (!allowEmpty && value === "") return bad(`${label} is empty`);
  if (value.length > max) return bad(`${label} exceeds ${max} characters`);
  return { ok: true, value };
}

function nonNegativeInt(value: unknown, label: string, max: number): Checked<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${label} is not a finite number`);
  if (!Number.isInteger(value)) return bad(`${label} is not an integer`);
  if (value < 0) return bad(`${label} is negative`);
  if (value > max) return bad(`${label} exceeds ${max}`);
  return { ok: true, value };
}

function bool(value: unknown, label: string): Checked<boolean> {
  if (typeof value !== "boolean") return bad(`${label} is not a boolean`);
  return { ok: true, value };
}

/**
 * An ISO-8601 timestamp that actually parses. Deliberately no default: an event
 * whose time we do not know must be refused, not silently stamped with the
 * epoch. A wrong timestamp orders the log wrongly, which is worse than a
 * missing event because it looks correct.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;

function timestamp(value: unknown, label: string): Checked<string> {
  const checked = str(value, label, { max: 64 });
  if (!checked.ok) return checked;

  // Date.parse alone is far too permissive — it accepts "Sat Sep 3 2026",
  // "2026", "March 3" and other loose forms, several of which are
  // implementation-defined and some of which silently assume local time. An
  // event log ordered by ambiguous timestamps is worse than one that rejects
  // them, so require an actual ISO-8601 shape first.
  if (!ISO_8601.test(checked.value)) {
    return bad(`${label} is not an ISO-8601 timestamp`);
  }
  if (Number.isNaN(Date.parse(checked.value))) {
    return bad(`${label} is not a parseable timestamp`);
  }
  return checked;
}

function optional<T>(value: unknown, check: () => Checked<T>): Checked<T | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  return check();
}

function taskStatus(value: unknown, label: string): Checked<TaskStatus> {
  const checked = str(value, label, { max: 32 });
  if (!checked.ok) return checked;
  if (!TASK_STATUSES.includes(checked.value as TaskStatus)) {
    return bad(`${label} is not a known status: ${checked.value}`);
  }
  return { ok: true, value: checked.value as TaskStatus };
}

/* ---------------------------------------------------------------- payloads -- */

function agentProfile(raw: unknown): Checked<AgentProfile> {
  const object = plainObject(raw, "agent");
  if (!object.ok) return object;
  const o = object.value;

  const id = str(o.id, "agent.id");
  if (!id.ok) return id;
  const name = str(o.name, "agent.name");
  if (!name.ok) return name;
  const avatarSeed = str(o.avatarSeed, "agent.avatarSeed");
  if (!avatarSeed.ok) return avatarSeed;
  const online = bool(o.online, "agent.online");
  if (!online.ok) return online;

  const model = optional(o.model, () => str(o.model, "agent.model"));
  if (!model.ok) return model;
  const runtime = optional(o.runtime, () => str(o.runtime, "agent.runtime"));
  if (!runtime.ok) return runtime;
  const coarseLocation = optional(o.coarseLocation, () => str(o.coarseLocation, "agent.coarseLocation"));
  if (!coarseLocation.ok) return coarseLocation;

  return {
    ok: true,
    value: {
      id: id.value,
      name: name.value,
      avatarSeed: avatarSeed.value,
      online: online.value,
      ...(model.value !== undefined ? { model: model.value } : {}),
      ...(runtime.value !== undefined ? { runtime: runtime.value } : {}),
      ...(coarseLocation.value !== undefined ? { coarseLocation: coarseLocation.value } : {}),
    },
  };
}

function crewTask(raw: unknown): Checked<CrewTask> {
  const object = plainObject(raw, "task");
  if (!object.ok) return object;
  const o = object.value;

  const id = str(o.id, "task.id");
  if (!id.ok) return id;
  const title = str(o.title, "task.title");
  if (!title.ok) return title;
  const status = taskStatus(o.status, "task.status");
  if (!status.ok) return status;
  const points = nonNegativeInt(o.points, "task.points", LIMITS.maxPoints);
  if (!points.ok) return points;

  const assigneeId = optional(o.assigneeId, () => str(o.assigneeId, "task.assigneeId"));
  if (!assigneeId.ok) return assigneeId;
  const blocker = optional(o.blocker, () => str(o.blocker, "task.blocker"));
  if (!blocker.ok) return blocker;

  // The reducer refuses a blocked task with no reason; refusing it here too
  // means the rejection is reported at the boundary where it can be explained.
  if (status.value === "blocked" && blocker.value === undefined) {
    return bad("task.blocker is required when status is blocked");
  }

  return {
    ok: true,
    value: {
      id: id.value,
      title: title.value,
      status: status.value,
      points: points.value,
      ...(assigneeId.value !== undefined ? { assigneeId: assigneeId.value } : {}),
      ...(blocker.value !== undefined ? { blocker: blocker.value } : {}),
    },
  };
}

function crewMessage(raw: unknown): Checked<CrewMessage> {
  const object = plainObject(raw, "message");
  if (!object.ok) return object;
  const o = object.value;

  const id = nonNegativeInt(o.id, "message.id", Number.MAX_SAFE_INTEGER);
  if (!id.ok) return id;
  const roomName = str(o.roomName, "message.roomName");
  if (!roomName.ok) return roomName;
  const username = str(o.username, "message.username");
  if (!username.ok) return username;
  const content = str(o.content, "message.content", { max: 4_096, allowEmpty: true });
  if (!content.ok) return content;
  const createdAt = timestamp(o.createdAt, "message.createdAt");
  if (!createdAt.ok) return createdAt;

  return {
    ok: true,
    value: {
      id: id.value,
      roomName: roomName.value,
      username: username.value,
      content: content.value,
      createdAt: createdAt.value,
    },
  };
}

function crewEvent(raw: unknown): Checked<CrewEvent> {
  const object = plainObject(raw, "payload");
  if (!object.ok) return object;
  const o = object.value;

  const type = str(o.type, "payload.type", { max: 64 });
  if (!type.ok) return type;

  switch (type.value) {
    case "agent.upserted": {
      const agent = agentProfile(o.agent);
      return agent.ok ? { ok: true, value: { type: "agent.upserted", agent: agent.value } } : agent;
    }
    case "presence.snapshotted": {
      if (!Array.isArray(o.usernames)) return bad("payload.usernames is not an array");
      if (o.usernames.length > LIMITS.maxArrayLength) {
        return bad(`payload.usernames exceeds ${LIMITS.maxArrayLength} entries`);
      }
      const usernames: string[] = [];
      for (const [index, entry] of o.usernames.entries()) {
        const checked = str(entry, `payload.usernames[${index}]`);
        if (!checked.ok) return checked;
        usernames.push(checked.value);
      }
      return { ok: true, value: { type: "presence.snapshotted", usernames } };
    }
    case "task.upserted": {
      const task = crewTask(o.task);
      return task.ok ? { ok: true, value: { type: "task.upserted", task: task.value } } : task;
    }
    case "task.transitioned": {
      const taskId = str(o.taskId, "payload.taskId");
      if (!taskId.ok) return taskId;
      const to = taskStatus(o.to, "payload.to");
      if (!to.ok) return to;
      const blocker = optional(o.blocker, () => str(o.blocker, "payload.blocker"));
      if (!blocker.ok) return blocker;
      if (to.value === "blocked" && blocker.value === undefined) {
        return bad("payload.blocker is required when transitioning to blocked");
      }
      return {
        ok: true,
        value: {
          type: "task.transitioned",
          taskId: taskId.value,
          to: to.value,
          ...(blocker.value !== undefined ? { blocker: blocker.value } : {}),
        },
      };
    }
    case "message.received": {
      const message = crewMessage(o.message);
      return message.ok ? { ok: true, value: { type: "message.received", message: message.value } } : message;
    }
    default:
      return bad(`unknown event type: ${type.value}`);
  }
}

/* ----------------------------------------------------------- action request -- */

/**
 * What a fenced block is allowed to contain.
 *
 * NOTE WHAT IS ABSENT: eventId, source, sourceCursor and occurredAt. Those were
 * previously read from the message body, which meant anyone who could type in
 * the room could forge another agent's identity, preempt a legitimate event id,
 * or reorder the log. Shape validation did not help — the forgeries were
 * perfectly well-formed.
 *
 * A fenced block is now only a REQUESTED ACTION. Identity, time and ordering are
 * supplied by the transport, which WebHarness actually authenticates. Validated
 * is not the same as authorized.
 */
export type ActionRequest = { payload: CrewEvent };

/** Authority derived from transport metadata. Never from message content. */
export type TransportAuthority = {
  /** Message id from WebHarness. Monotonic, server-assigned. */
  messageId: number;
  /** Authenticated sender. The one identity claim we can actually trust. */
  username: string;
  /** Server-assigned timestamp. */
  createdAt: string;
  /** Which fenced block within the message, so ids stay unique per block. */
  blockIndex: number;
};

export function validateActionRequest(raw: unknown): Checked<ActionRequest> {
  const object = plainObject(raw, "envelope");
  if (!object.ok) return object;
  const o = object.value;

  // Fail closed on versions we do not understand.
  if (o.version !== 1) return bad(`unsupported envelope version: ${String(o.version)}`);

  // Reject rather than ignore attempts to assert authority in the body. Silently
  // dropping them would let a forger believe it worked, and would hide the
  // attempt from the rejection log.
  for (const field of ["eventId", "source", "sourceCursor", "occurredAt"]) {
    if (o[field] !== undefined) {
      return bad(`${field} may not be set by the message body; authority comes from transport`);
    }
  }

  const payload = crewEvent(o.payload);
  if (!payload.ok) return payload;

  return { ok: true, value: { payload: payload.value } };
}

/**
 * Build an envelope from a validated request plus transport-derived authority.
 *
 * eventId is derived from messageId and blockIndex, so it cannot collide with
 * or preempt another author's event. sourceCursor is the server-assigned
 * message id, so ordering cannot be manipulated from content.
 */
export function authorize(request: ActionRequest, authority: TransportAuthority): EventEnvelope {
  return {
    version: 1,
    eventId: `wh:${authority.messageId}:${authority.blockIndex}`,
    source: authority.username,
    sourceCursor: authority.messageId,
    occurredAt: authority.createdAt,
    payload: request.payload,
  };
}

/**
 * Per-event authorization: may THIS sender request THIS action?
 *
 * Shape and identity are settled by now; this is the question of permission.
 */
export function authorizeEvent(payload: CrewEvent, authority: TransportAuthority): Checked<true> {
  switch (payload.type) {
    case "presence.snapshotted":
      // Presence is a server observation. Accepting it from a chat message
      // would let any participant declare who is online.
      return bad("presence may only be derived from server polling, not from a message");

    case "message.received":
      // Messages come from the transport itself. Accepting a claimed one lets
      // a sender fabricate an utterance attributed to somebody else.
      return bad("message events are derived from transport, not from message content");

    case "agent.upserted":
      // An agent may describe itself and nothing else.
      if (payload.agent.id !== authority.username) {
        return bad(`${authority.username} may not modify the profile of ${payload.agent.id}`);
      }
      return { ok: true, value: true };

    case "task.upserted":
    case "task.transitioned":
      // Task mutation is legitimate for any authenticated participant today.
      // When project capabilities exist this is where they bind.
      return { ok: true, value: true };
  }
}

/* --------------------------------------------------------------- envelope -- */


/**
 * Validate a parsed envelope completely. Returns the reconstructed value rather
 * than the input, so nothing unvalidated survives into state — an attacker
 * cannot smuggle extra keys through by attaching them to an otherwise valid
 * event.
 */
export function validateEnvelope(raw: unknown): Checked<EventEnvelope> {
  const object = plainObject(raw, "envelope");
  if (!object.ok) return object;
  const o = object.value;

  // Fail closed on versions we do not understand rather than applying the
  // fields we happen to recognise. A partially-understood event is a lie.
  if (o.version !== 1) return bad(`unsupported envelope version: ${String(o.version)}`);

  const eventId = str(o.eventId, "eventId", { max: 128 });
  if (!eventId.ok) return eventId;
  const source = str(o.source, "source", { max: 128 });
  if (!source.ok) return source;
  const sourceCursor = nonNegativeInt(o.sourceCursor, "sourceCursor", LIMITS.maxCursor);
  if (!sourceCursor.ok) return sourceCursor;
  const occurredAt = timestamp(o.occurredAt, "occurredAt");
  if (!occurredAt.ok) return occurredAt;

  const payload = crewEvent(o.payload);
  if (!payload.ok) return payload;

  return {
    ok: true,
    value: {
      version: 1,
      eventId: eventId.value,
      source: source.value,
      sourceCursor: sourceCursor.value,
      occurredAt: occurredAt.value,
      payload: payload.value,
    },
  };
}
