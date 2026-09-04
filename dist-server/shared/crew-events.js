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
const TASK_STATUSES = [
    "backlog", "assigned", "in_progress", "blocked", "review", "done",
];
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
};
const bad = (reason) => ({ ok: false, reason });
/** Keys that would let a crafted payload reach Object.prototype. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/**
 * A plain object with no prototype-polluting keys. `JSON.parse` will not set
 * __proto__ as a normal property, but a nested object carrying these keys can
 * still reach code that later spreads or merges it, so they are refused here
 * rather than trusted to be harmless downstream.
 */
function plainObject(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return bad(`${label} is not an object`);
    }
    for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key))
            return bad(`${label} contains forbidden key: ${key}`);
    }
    return { ok: true, value: value };
}
// The options are typed explicitly rather than inferred from the defaults:
// LIMITS is `as const`, so an inferred `max` narrows to the literal 512 and
// every caller passing a different bound becomes a type error. The browser
// build never noticed because it does not compile this file the same way —
// it only surfaced when the server got a real production build.
function str(value, label, { max = LIMITS.maxStringLength, allowEmpty = false } = {}) {
    if (typeof value !== "string")
        return bad(`${label} is not a string`);
    if (!allowEmpty && value === "")
        return bad(`${label} is empty`);
    if (value.length > max)
        return bad(`${label} exceeds ${max} characters`);
    return { ok: true, value };
}
function nonNegativeInt(value, label, max) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return bad(`${label} is not a finite number`);
    if (!Number.isInteger(value))
        return bad(`${label} is not an integer`);
    if (value < 0)
        return bad(`${label} is negative`);
    if (value > max)
        return bad(`${label} exceeds ${max}`);
    return { ok: true, value };
}
function bool(value, label) {
    if (typeof value !== "boolean")
        return bad(`${label} is not a boolean`);
    return { ok: true, value };
}
/**
 * An ISO-8601 timestamp that actually parses. Deliberately no default: an event
 * whose time we do not know must be refused, not silently stamped with the
 * epoch. A wrong timestamp orders the log wrongly, which is worse than a
 * missing event because it looks correct.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;
function timestamp(value, label) {
    const checked = str(value, label, { max: 64 });
    if (!checked.ok)
        return checked;
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
function optional(value, check) {
    if (value === undefined || value === null)
        return { ok: true, value: undefined };
    return check();
}
function taskStatus(value, label) {
    const checked = str(value, label, { max: 32 });
    if (!checked.ok)
        return checked;
    if (!TASK_STATUSES.includes(checked.value)) {
        return bad(`${label} is not a known status: ${checked.value}`);
    }
    return { ok: true, value: checked.value };
}
/* ---------------------------------------------------------------- payloads -- */
function agentProfile(raw) {
    const object = plainObject(raw, "agent");
    if (!object.ok)
        return object;
    const o = object.value;
    const id = str(o.id, "agent.id");
    if (!id.ok)
        return id;
    const name = str(o.name, "agent.name");
    if (!name.ok)
        return name;
    const avatarSeed = str(o.avatarSeed, "agent.avatarSeed");
    if (!avatarSeed.ok)
        return avatarSeed;
    // Refused rather than ignored: a sender who included it should learn it
    // carries no weight, instead of believing it was accepted.
    if (o.online !== undefined) {
        return bad("agent.online may not be self-reported; presence comes from server polling");
    }
    const model = optional(o.model, () => str(o.model, "agent.model"));
    if (!model.ok)
        return model;
    const runtime = optional(o.runtime, () => str(o.runtime, "agent.runtime"));
    if (!runtime.ok)
        return runtime;
    const coarseLocation = optional(o.coarseLocation, () => str(o.coarseLocation, "agent.coarseLocation"));
    if (!coarseLocation.ok)
        return coarseLocation;
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
function crewTask(raw) {
    const object = plainObject(raw, "task");
    if (!object.ok)
        return object;
    const o = object.value;
    const id = str(o.id, "task.id");
    if (!id.ok)
        return id;
    const title = str(o.title, "task.title");
    if (!title.ok)
        return title;
    const status = taskStatus(o.status, "task.status");
    if (!status.ok)
        return status;
    const points = nonNegativeInt(o.points, "task.points", LIMITS.maxPoints);
    if (!points.ok)
        return points;
    const assigneeId = optional(o.assigneeId, () => str(o.assigneeId, "task.assigneeId"));
    if (!assigneeId.ok)
        return assigneeId;
    const blocker = optional(o.blocker, () => str(o.blocker, "task.blocker"));
    if (!blocker.ok)
        return blocker;
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
function crewMessage(raw) {
    const object = plainObject(raw, "message");
    if (!object.ok)
        return object;
    const o = object.value;
    const id = nonNegativeInt(o.id, "message.id", Number.MAX_SAFE_INTEGER);
    if (!id.ok)
        return id;
    const roomName = str(o.roomName, "message.roomName");
    if (!roomName.ok)
        return roomName;
    const username = str(o.username, "message.username");
    if (!username.ok)
        return username;
    const content = str(o.content, "message.content", { max: 4_096, allowEmpty: true });
    if (!content.ok)
        return content;
    const createdAt = timestamp(o.createdAt, "message.createdAt");
    if (!createdAt.ok)
        return createdAt;
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
function crewEvent(raw) {
    const object = plainObject(raw, "payload");
    if (!object.ok)
        return object;
    const o = object.value;
    const type = str(o.type, "payload.type", { max: 64 });
    if (!type.ok)
        return type;
    switch (type.value) {
        case "agent.upserted": {
            const agent = agentProfile(o.agent);
            return agent.ok ? { ok: true, value: { type: "agent.upserted", agent: agent.value } } : agent;
        }
        case "presence.snapshotted": {
            if (!Array.isArray(o.usernames))
                return bad("payload.usernames is not an array");
            if (o.usernames.length > LIMITS.maxArrayLength) {
                return bad(`payload.usernames exceeds ${LIMITS.maxArrayLength} entries`);
            }
            const usernames = [];
            for (const [index, entry] of o.usernames.entries()) {
                const checked = str(entry, `payload.usernames[${index}]`);
                if (!checked.ok)
                    return checked;
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
            if (!taskId.ok)
                return taskId;
            const to = taskStatus(o.to, "payload.to");
            if (!to.ok)
                return to;
            const blocker = optional(o.blocker, () => str(o.blocker, "payload.blocker"));
            if (!blocker.ok)
                return blocker;
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
/** Validate and rebuild an entire message received across the network. */
export function validateTransportMessage(raw) {
    const object = plainObject(raw, "message");
    if (!object.ok)
        return object;
    const o = object.value;
    const id = nonNegativeInt(o.id, "message.id", Number.MAX_SAFE_INTEGER);
    if (!id.ok)
        return id;
    const username = str(o.username, "message.username", { max: 128 });
    if (!username.ok)
        return username;
    const content = str(o.content, "message.content", { max: 100_000, allowEmpty: true });
    if (!content.ok)
        return content;
    const msgType = str(o.msgType, "message.msgType", { max: 64 });
    if (!msgType.ok)
        return msgType;
    const createdAt = timestamp(o.createdAt, "message.createdAt");
    if (!createdAt.ok)
        return createdAt;
    const updatedAt = timestamp(o.updatedAt, "message.updatedAt");
    if (!updatedAt.ok)
        return updatedAt;
    if (typeof o.streaming !== "boolean")
        return bad("message.streaming is not a boolean");
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
export function validateReadableMessage(raw) {
    const object = plainObject(raw, "message");
    if (!object.ok)
        return object;
    const o = object.value;
    const content = str(o.content, "message.content", { max: 100_000, allowEmpty: true });
    if (!content.ok)
        return content;
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
export function validateAuthority(raw) {
    const object = plainObject(raw, "authority");
    if (!object.ok)
        return object;
    const o = object.value;
    const roomName = str(o.roomName, "authority.roomName", { max: 200 });
    if (!roomName.ok)
        return roomName;
    const messageId = nonNegativeInt(o.messageId, "authority.messageId", Number.MAX_SAFE_INTEGER);
    if (!messageId.ok)
        return messageId;
    const username = str(o.username, "authority.username", { max: 128 });
    if (!username.ok)
        return username;
    const createdAt = timestamp(o.createdAt, "authority.createdAt");
    if (!createdAt.ok)
        return createdAt;
    const blockIndex = nonNegativeInt(o.blockIndex, "authority.blockIndex", LIMITS.maxEnvelopesPerMessage);
    if (!blockIndex.ok)
        return blockIndex;
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
export const denyAll = () => false;
export function validateActionRequest(raw) {
    const object = plainObject(raw, "envelope");
    if (!object.ok)
        return object;
    const o = object.value;
    // Fail closed on versions we do not understand.
    if (o.version !== 1)
        return bad(`unsupported envelope version: ${String(o.version)}`);
    // Reject rather than ignore attempts to assert authority in the body. Silently
    // dropping them would let a forger believe it worked, and would hide the
    // attempt from the rejection log.
    for (const field of ["eventId", "source", "sourceCursor", "occurredAt"]) {
        if (o[field] !== undefined) {
            return bad(`${field} may not be set by the message body; authority comes from transport`);
        }
    }
    const payload = crewEvent(o.payload);
    if (!payload.ok)
        return payload;
    return { ok: true, value: { payload: payload.value } };
}
/**
 * Build an envelope from a validated request plus transport-derived authority.
 *
 * eventId is derived from messageId and blockIndex, so it cannot collide with
 * or preempt another author's event. sourceCursor is the server-assigned
 * message id, so ordering cannot be manipulated from content.
 */
export function authorize(request, authority) {
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
export function authorizeEvent(payload, authority, canMutateProject = denyAll) {
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
        case "task.upserted":
        case "task.transitioned":
            // Membership is not project authority: anyone can join a public room.
            // Without an explicit capability this is a request, not an event.
            if (!canMutateProject(authority.username, authority.roomName)) {
                return bad(`${authority.username} has no project capability to change tasks in ${authority.roomName}; ` +
                    `treat this as a request pending operator approval`);
            }
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
export function validateEnvelope(raw) {
    const object = plainObject(raw, "envelope");
    if (!object.ok)
        return object;
    const o = object.value;
    // Fail closed on versions we do not understand rather than applying the
    // fields we happen to recognise. A partially-understood event is a lie.
    if (o.version !== 1)
        return bad(`unsupported envelope version: ${String(o.version)}`);
    const eventId = str(o.eventId, "eventId", { max: 128 });
    if (!eventId.ok)
        return eventId;
    const stream = str(o.stream, "stream", { max: 200 });
    if (!stream.ok)
        return stream;
    const source = str(o.source, "source", { max: 128 });
    if (!source.ok)
        return source;
    const sourceCursor = nonNegativeInt(o.sourceCursor, "sourceCursor", LIMITS.maxCursor);
    if (!sourceCursor.ok)
        return sourceCursor;
    const occurredAt = timestamp(o.occurredAt, "occurredAt");
    if (!occurredAt.ok)
        return occurredAt;
    const payload = crewEvent(o.payload);
    if (!payload.ok)
        return payload;
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
//# sourceMappingURL=crew-events.js.map