/**
 * A chat message from WebHarness, checked field by field before anything reads it.
 *
 * This is all that remains of shared/crew-events.ts, the wire schema of the board
 * that lived in the chat as `crew-event` blocks until ADR-002 moved it into
 * saha.ing's own database (2026-09-10). The board's events, their reducer and the
 * adapter that folded the room into a board went (2026-10-20); messages still
 * arrive over the network, so they are still validated rather than trusted.
 */
import type { Message } from "./contracts.js";

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
  { max = 512, allowEmpty = false }: { max?: number; allowEmpty?: boolean } = {},
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
