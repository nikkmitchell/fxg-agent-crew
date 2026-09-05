import { checkProfile, type ActorProfile } from "../src/profiles.js";
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

export type TaskKind = "decision" | "build";

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

export type TaskComment = { id: string; author: string; body: string; createdAt: string };

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
  /**
   * 1 is most urgent, 5 least. Optional, and ABSENT MEANS UNSET — not lowest.
   *
   * The distinction matters because the point of this field is agents choosing
   * what to do next without being told. Defaulting unset cards to the bottom
   * would quietly bury every card nobody has triaged, which is exactly the work
   * most likely to need a human's attention.
   */
  priority?: number;
  owners?: string[];
  acceptedBy?: string[];
  comments?: TaskComment[];
  links?: Array<{ label: string; href: string }>;
  images?: Array<{ label: string; href: string }>;
};

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

/**
 * A self-reported profile. Note the ABSENCE of `online`: presence is observed by
 * polling the server, never asserted by the subject. Including the field here
 * at all would invite exactly the confusion it caused — an earlier version
 * rebuilt it as false, which stopped an agent claiming to be online and instead
 * made every profile update mark a genuinely-online agent as offline.
 */
export type SelfReportedProfile = Omit<AgentProfile, "online">;

export type CrewEvent =
  | { type: "agent.upserted"; agent: SelfReportedProfile }
  | { type: "presence.snapshotted"; usernames: string[] }
  | { type: "project.upserted"; project: CrewProject }
  | { type: "task.upserted"; task: CrewTask }
  | { type: "task.transitioned"; taskId: string; to: TaskStatus; blocker?: string }
  | { type: "task.commented"; taskId: string; comment: TaskComment }
  | { type: "profile.upserted"; profile: ActorProfile }
  | { type: "ownership.acted"; agentActorId: string; ownerActorId: string; action: "declare" | "confirm" | "revoke" }
  | { type: "message.received"; message: CrewMessage };

export type EventEnvelope = {
  version: 1;
  eventId: string;
  /**
   * The ordered stream this event belongs to — the room.
   *
   * Cursors are per-STREAM, not per-author. The same user in two rooms produces
   * two independent id sequences, so keying order by username alone makes
   * room-B's message 1 look stale after room-A's message 100.
   */
  stream: string;
  /** Authenticated author. Identity, not ordering. */
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

// The options are typed explicitly rather than inferred from the defaults:
// LIMITS is `as const`, so an inferred `max` narrows to the literal 512 and
// every caller passing a different bound becomes a type error. The browser
// build never noticed because it does not compile this file the same way —
// it only surfaced when the server got a real production build.
function str(
  value: unknown,
  label: string,
  { max = LIMITS.maxStringLength, allowEmpty = false }: { max?: number; allowEmpty?: boolean } = {},
): Checked<string> {
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

function agentProfile(raw: unknown): Checked<SelfReportedProfile> {
  const object = plainObject(raw, "agent");
  if (!object.ok) return object;
  const o = object.value;

  const id = str(o.id, "agent.id");
  if (!id.ok) return id;
  const name = str(o.name, "agent.name");
  if (!name.ok) return name;
  const avatarSeed = str(o.avatarSeed, "agent.avatarSeed");
  if (!avatarSeed.ok) return avatarSeed;

  // Refused rather than ignored: a sender who included it should learn it
  // carries no weight, instead of believing it was accepted.
  if (o.online !== undefined) {
    return bad("agent.online may not be self-reported; presence comes from server polling");
  }

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
  const projectId = optional(o.projectId, () => str(o.projectId, "task.projectId"));
  if (!projectId.ok) return projectId;
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
  // Rejected rather than coerced: an unrecognised kind must not silently become
  // one of the two we know about, because the whole point of the field is that
  // the board stops implying something it was not told.
  // Bounded and integral. A free-form number would let one card claim priority
  // 0 or -1 and sit above everything forever, which is a ranking nobody agreed
  // to.
  const priority = optional(o.priority, () =>
    typeof o.priority === "number" && Number.isInteger(o.priority) && o.priority >= 1 && o.priority <= 5
      ? ({ ok: true, value: o.priority } as Checked<number>)
      : bad("task.priority must be an integer from 1 (most urgent) to 5"),
  );
  if (!priority.ok) return priority;
  const kind = optional(o.kind, () =>
    o.kind === "decision" || o.kind === "build"
      ? ({ ok: true, value: o.kind } as Checked<"decision" | "build">)
      : bad('task.kind must be "decision" or "build"'),
  );
  if (!kind.ok) return kind;

  const stringList = (rawList: unknown, label: string): Checked<string[] | undefined> => {
    if (rawList === undefined || rawList === null) return { ok: true, value: undefined };
    if (!Array.isArray(rawList)) return bad(`${label} is not an array`);
    if (rawList.length > LIMITS.maxArrayLength) return bad(`${label} exceeds ${LIMITS.maxArrayLength} entries`);
    const values: string[] = [];
    for (const [index, value] of rawList.entries()) {
      const checked = str(value, `${label}[${index}]`);
      if (!checked.ok) return checked;
      if (!values.includes(checked.value)) values.push(checked.value);
    }
    return { ok: true, value: values };
  };
  const owners = stringList(o.owners, "task.owners");
  if (!owners.ok) return owners;
  const acceptedBy = stringList(o.acceptedBy, "task.acceptedBy");
  if (!acceptedBy.ok) return acceptedBy;
  if (acceptedBy.value?.some((username) => !owners.value?.includes(username))) {
    return bad("task.acceptedBy contains a user who is not an owner");
  }

  const links = (rawList: unknown, label: string): Checked<Array<{ label: string; href: string }> | undefined> => {
    if (rawList === undefined || rawList === null) return { ok: true, value: undefined };
    if (!Array.isArray(rawList)) return bad(`${label} is not an array`);
    if (rawList.length > LIMITS.maxArrayLength) return bad(`${label} exceeds ${LIMITS.maxArrayLength} entries`);
    const values: Array<{ label: string; href: string }> = [];
    for (const [index, rawLink] of rawList.entries()) {
      const link = plainObject(rawLink, `${label}[${index}]`);
      if (!link.ok) return link;
      const linkLabel = str(link.value.label, `${label}[${index}].label`);
      if (!linkLabel.ok) return linkLabel;
      const href = str(link.value.href, `${label}[${index}].href`, { max: 2_000 });
      if (!href.ok) return href;
      if (!/^https?:\/\//.test(href.value)) return bad(`${label}[${index}].href must use http or https`);
      values.push({ label: linkLabel.value, href: href.value });
    }
    return { ok: true, value: values };
  };
  const taskLinks = links(o.links, "task.links");
  if (!taskLinks.ok) return taskLinks;
  const images = links(o.images, "task.images");
  if (!images.ok) return images;

  let comments: CrewTask["comments"];
  if (o.comments !== undefined && o.comments !== null) {
    if (!Array.isArray(o.comments)) return bad("task.comments is not an array");
    if (o.comments.length > LIMITS.maxArrayLength) return bad(`task.comments exceeds ${LIMITS.maxArrayLength} entries`);
    comments = [];
    for (const [index, rawComment] of o.comments.entries()) {
      const comment = plainObject(rawComment, `task.comments[${index}]`);
      if (!comment.ok) return comment;
      const commentId = str(comment.value.id, `task.comments[${index}].id`);
      if (!commentId.ok) return commentId;
      const author = str(comment.value.author, `task.comments[${index}].author`);
      if (!author.ok) return author;
      const body = str(comment.value.body, `task.comments[${index}].body`, { max: 2_000 });
      if (!body.ok) return body;
      const createdAt = timestamp(comment.value.createdAt, `task.comments[${index}].createdAt`);
      if (!createdAt.ok) return createdAt;
      comments.push({ id: commentId.value, author: author.value, body: body.value, createdAt: createdAt.value });
    }
  }

  // The reducer refuses a blocked task with no reason; refusing it here too
  // means the rejection is reported at the boundary where it can be explained.
  if (status.value === "blocked" && blocker.value === undefined) {
    return bad("task.blocker is required when status is blocked");
  }

  return {
    ok: true,
    value: {
      id: id.value,
      ...(projectId.value !== undefined ? { projectId: projectId.value } : {}),
      title: title.value,
      status: status.value,
      points: points.value,
      ...(assigneeId.value !== undefined ? { assigneeId: assigneeId.value } : {}),
      ...(blocker.value !== undefined ? { blocker: blocker.value } : {}),
      ...(kind.value !== undefined ? { kind: kind.value } : {}),
      ...(priority.value !== undefined ? { priority: priority.value } : {}),
      ...(owners.value !== undefined ? { owners: owners.value } : {}),
      ...(acceptedBy.value !== undefined ? { acceptedBy: acceptedBy.value } : {}),
      ...(comments !== undefined ? { comments } : {}),
      ...(taskLinks.value !== undefined ? { links: taskLinks.value } : {}),
      ...(images.value !== undefined ? { images: images.value } : {}),
    },
  };
}

/**
 * One comment. Shared by the whole-card path and the append path so the two
 * cannot drift apart in what they accept - a field allowed by one and rejected
 * by the other is the kind of gap that only appears in production.
 */
function checkedComment(raw: unknown, label: string): Checked<TaskComment> {
  const comment = plainObject(raw, label);
  if (!comment.ok) return comment;
  const id = str(comment.value.id, `${label}.id`);
  if (!id.ok) return id;
  const author = str(comment.value.author, `${label}.author`);
  if (!author.ok) return author;
  const body = str(comment.value.body, `${label}.body`, { max: 2_000 });
  if (!body.ok) return body;
  const createdAt = timestamp(comment.value.createdAt, `${label}.createdAt`);
  if (!createdAt.ok) return createdAt;
  return { ok: true, value: { id: id.value, author: author.value, body: body.value, createdAt: createdAt.value } };
}

function crewProject(raw: unknown): Checked<CrewProject> {
  const object = plainObject(raw, "project");
  if (!object.ok) return object;
  const o = object.value;

  const id = str(o.id, "project.id");
  if (!id.ok) return id;
  const name = str(o.name, "project.name");
  if (!name.ok) return name;
  const summary = str(o.summary, "project.summary", { max: 2_000 });
  if (!summary.ok) return summary;
  if (!Array.isArray(o.goals) || o.goals.length < 1 || o.goals.length > 10) {
    return bad("project.goals must contain 1 to 10 entries");
  }
  const goals: string[] = [];
  for (const [index, entry] of o.goals.entries()) {
    const checked = str(entry, `project.goals[${index}]`);
    if (!checked.ok) return checked;
    goals.push(checked.value);
  }
  if (!Array.isArray(o.steps) || o.steps.length < 1 || o.steps.length > 10) {
    return bad("project.steps must contain 1 to 10 entries");
  }
  const steps: CrewProject["steps"] = [];
  for (const [index, rawStep] of o.steps.entries()) {
    const step = plainObject(rawStep, `project.steps[${index}]`);
    if (!step.ok) return step;
    const stepId = str(step.value.id, `project.steps[${index}].id`);
    if (!stepId.ok) return stepId;
    const stepTitle = str(step.value.title, `project.steps[${index}].title`);
    if (!stepTitle.ok) return stepTitle;
    const status = str(step.value.status, `project.steps[${index}].status`, { max: 32 });
    if (!status.ok) return status;
    if (!(["not_started", "in_progress", "done"] as const).includes(status.value as CrewProject["steps"][number]["status"])) {
      return bad(`project.steps[${index}].status is not known`);
    }
    steps.push({ id: stepId.value, title: stepTitle.value, status: status.value as CrewProject["steps"][number]["status"] });
  }
  return { ok: true, value: { id: id.value, name: name.value, summary: summary.value, goals, steps } };
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
    case "project.upserted": {
      const project = crewProject(o.project);
      return project.ok ? { ok: true, value: { type: "project.upserted", project: project.value } } : project;
    }
    case "task.upserted": {
      const task = crewTask(o.task);
      return task.ok ? { ok: true, value: { type: "task.upserted", task: task.value } } : task;
    }
    case "profile.upserted": {
      // Delegated to the profile model, which is where the forbidden-field rule
      // lives. Duplicating that list here would create a second answer to "what
      // may never be stored", and the two would drift.
      const profile = checkProfile(o.profile);
      if (!profile.ok) return bad(profile.reason);
      return { ok: true, value: { type: "profile.upserted", profile: profile.value } };
    }
    case "ownership.acted": {
      const agentActorId = str(o.agentActorId, "payload.agentActorId");
      if (!agentActorId.ok) return agentActorId;
      const ownerActorId = str(o.ownerActorId, "payload.ownerActorId");
      if (!ownerActorId.ok) return ownerActorId;
      if (o.action !== "declare" && o.action !== "confirm" && o.action !== "revoke") {
        return bad('payload.action must be "declare", "confirm" or "revoke"');
      }
      // A resulting STATE is never accepted from the wire. State is derived by
      // the reducer from the action plus the authenticated author; allowing it
      // here would let a claimant post "verified" and skip the agent's consent,
      // which is the entire point of the handshake.
      if ("state" in o) return bad("payload.state is derived, not declared");
      return {
        ok: true,
        value: {
          type: "ownership.acted",
          agentActorId: agentActorId.value,
          ownerActorId: ownerActorId.value,
          action: o.action,
        },
      };
    }
    case "task.commented": {
      const taskId = str(o.taskId, "payload.taskId");
      if (!taskId.ok) return taskId;
      const comment = checkedComment(o.comment, "payload.comment");
      if (!comment.ok) return comment;
      return { ok: true, value: { type: "task.commented", taskId: taskId.value, comment: comment.value } };
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

/**
 * Authority derived from transport metadata. Never from message content.
 *
 * `roomName` is part of identity, not decoration: without it two rooms can
 * produce the same message id and therefore the same event id, so aggregating
 * rooms would silently collide.
 */
export type TransportAuthority = {
  /** Authoritative room identity, so ids and cursors are room-scoped. */
  roomName: string;
  /** Message id from WebHarness. Monotonic per room, server-assigned. */
  messageId: number;
  /** Authenticated sender. The one identity claim we can actually trust. */
  username: string;
  /** Server-assigned timestamp. */
  createdAt: string;
  /** Which fenced block within the message, so ids stay unique per block. */
  blockIndex: number;
};

/**
 * Validate transport metadata before trusting it as identity, order or time.
 *
 * These fields arrive over the network and are typed rather than checked. A
 * TypeScript annotation on data that crossed a boundary is a claim about what
 * we hope was sent — the same lesson that produced this whole authority layer,
 * applied to the layer's own root of trust. If the transport metadata is
 * malformed we have no authority at all, so nothing may be derived from it.
 */
/**
 * The transport fields the adapter READS before it can decide anything —
 * content and streaming — validated before they are touched.
 *
 * `content.matchAll(...)` on a null or object content throws, and a non-boolean
 * `streaming` silently skips the guard that keeps half-written messages out of
 * state. Both are network-supplied and typed rather than checked, which is the
 * same root-of-trust gap this module already closed for identity and order —
 * left open one field over.
 */
import type { Message } from "./contracts.js";

export type ReadableMessage = { content: string; streaming: boolean; msgType?: string };

/** Validate and rebuild an entire message received across the network. */
export function validateTransportMessage(raw: unknown): Checked<Message> {
  const object = plainObject(raw, "message");
  if (!object.ok) return object;
  const o = object.value;

  const id = nonNegativeInt(o.id, "message.id", Number.MAX_SAFE_INTEGER);
  if (!id.ok) return id;
  const username = str(o.username, "message.username", { max: 128 });
  if (!username.ok) return username;
  const content = str(o.content, "message.content", { max: 100_000, allowEmpty: true });
  if (!content.ok) return content;
  const msgType = str(o.msgType, "message.msgType", { max: 64 });
  if (!msgType.ok) return msgType;
  const createdAt = timestamp(o.createdAt, "message.createdAt");
  if (!createdAt.ok) return createdAt;
  const updatedAt = timestamp(o.updatedAt, "message.updatedAt");
  if (!updatedAt.ok) return updatedAt;
  if (typeof o.streaming !== "boolean") return bad("message.streaming is not a boolean");

  return {
    ok: true,
    value: {
      id: id.value,
      username: username.value,
      content: content.value,
      msgType: msgType.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
      streaming: o.streaming,
    },
  };
}

export function validateReadableMessage(raw: unknown): Checked<ReadableMessage> {
  const object = plainObject(raw, "message");
  if (!object.ok) return object;
  const o = object.value;

  const content = str(o.content, "message.content", { max: 100_000, allowEmpty: true });
  if (!content.ok) return content;

  // Absent is treated as not-streaming; present-but-wrong is refused rather
  // than coerced, since coercion is how a half-written message gets applied.
  if (o.streaming !== undefined && typeof o.streaming !== "boolean") {
    return bad("message.streaming is not a boolean");
  }
  if (o.msgType !== undefined && typeof o.msgType !== "string") {
    return bad("message.msgType is not a string");
  }

  return {
    ok: true,
    value: {
      content: content.value,
      streaming: o.streaming === true,
      ...(typeof o.msgType === "string" ? { msgType: o.msgType } : {}),
    },
  };
}

export function validateAuthority(raw: unknown): Checked<TransportAuthority> {
  const object = plainObject(raw, "authority");
  if (!object.ok) return object;
  const o = object.value;

  const roomName = str(o.roomName, "authority.roomName", { max: 200 });
  if (!roomName.ok) return roomName;
  const messageId = nonNegativeInt(o.messageId, "authority.messageId", Number.MAX_SAFE_INTEGER);
  if (!messageId.ok) return messageId;
  const username = str(o.username, "authority.username", { max: 128 });
  if (!username.ok) return username;
  const createdAt = timestamp(o.createdAt, "authority.createdAt");
  if (!createdAt.ok) return createdAt;
  const blockIndex = nonNegativeInt(o.blockIndex, "authority.blockIndex", LIMITS.maxEnvelopesPerMessage);
  if (!blockIndex.ok) return blockIndex;

  return {
    ok: true,
    value: {
      roomName: roomName.value,
      messageId: messageId.value,
      username: username.value,
      createdAt: createdAt.value,
      blockIndex: blockIndex.value,
    },
  };
}

/**
 * Who may perform project-level actions.
 *
 * Room membership is NOT project authority. Anyone can join a public room —
 * and a room can be public while appearing password-protected, which was
 * observed on a local instance — so "is in the room" grants nothing.
 *
 * No capability system exists yet. Until one does, the resolver defaults to
 * denying task mutation, and such blocks remain REQUESTS for an operator rather
 * than events the reducer will apply. Failing closed here costs a feature;
 * failing open would let any participant rewrite the board.
 */
export type CapabilityResolver = (username: string, room: string) => boolean;

export const denyAll: CapabilityResolver = () => false;

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
    // Room-scoped: two rooms can each have a message 42.
    eventId: `wh:${authority.roomName}:${authority.messageId}:${authority.blockIndex}`,
    stream: authority.roomName,
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
export function authorizeEvent(
  payload: CrewEvent,
  authority: TransportAuthority,
  canMutateProject: CapabilityResolver = denyAll,
): Checked<true> {
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
      // `online` is an OBSERVATION, made by polling the server — not something
      // an agent may assert about itself. Authorising a self-profile update
      // does not make a self-reported presence claim authoritative, and the
      // caller strips the field rather than trusting it.
      return { ok: true, value: true };

    case "project.upserted":
    case "task.upserted":
    case "task.transitioned":
    case "task.commented":
      // Membership is not project authority: anyone can join a public room.
      // Without an explicit capability this is a request, not an event.
      if (!canMutateProject(authority.username, authority.roomName)) {
        return bad(
          `${authority.username} has no project capability to change project data in ${authority.roomName}; ` +
            `treat this as a request pending operator approval`,
        );
      }
      return { ok: true, value: true };

    case "profile.upserted":
    case "ownership.acted":
      // Deliberately NOT gated on project capability.
      //
      // Describing yourself, or asking whether an agent is yours, is not
      // changing project data — requiring project authority to publish a
      // profile would make identity a privilege of membership. The protection
      // that matters here is different and lives in the reducer: the acting
      // identity comes from the authenticated author, so a claimant still
      // cannot confirm their own claim however this is authorised.
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
  const stream = str(o.stream, "stream", { max: 200 });
  if (!stream.ok) return stream;
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
      // Ordering is per stream; see EventEnvelope. Validating an envelope that
      // arrived without one would leave the reducer keying cursors on
      // undefined, so it is required here rather than defaulted.
      stream: stream.value,
      source: source.value,
      sourceCursor: sourceCursor.value,
      occurredAt: occurredAt.value,
      payload: payload.value,
    },
  };
}
