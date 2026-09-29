/**
 * THE SAHA.ING MULTIPLAYER KIT, FOR SPACES (Nikk, 2026-09-29: "when building a
 * space, if they add in the saha.ing multiplayer, then it's automatically able
 * to be multiplayer, and then they can also publish it as a public room that
 * is accessable from the saha.ing lobby").
 *
 * A space page adds one script, public/kit/saha.js, and everyone in it sees
 * everyone else: a figure per person with their name, moving where they look
 * from, plus a small shared state every visitor sees alike and short spoken
 * lines. This file is the wire between that script and the server
 * (server/spaces/live.ts): what may be sent, and how big.
 *
 * WHO YOU ARE comes from a TICKET, not a cookie. A space page is sandboxed
 * (server/spaces/routes.ts, SITE_SANDBOX) and has no saha.ing sign-in, on
 * purpose. When you enter a space FROM saha.ing (a lobby door, the Spaces
 * page), saha.ing gives the page a short-lived ticket for that one space in
 * the URL's #fragment, which never reaches a server log. The ticket lets the
 * page be you IN THAT SPACE and nowhere else. Opened any other way, the page
 * is a guest: it sees everyone and nobody sees it.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** What one person's page sends about themselves, several times a second. */
export type PoseMessage = { t: "pose"; p: Vec3; q: Quat; hl?: Vec3 | null; hr?: Vec3 | null };
/** Set a shared value; null removes it. */
export type SetMessage = { t: "set"; k: string; v: unknown };
/** A short line, shown to everyone as a bubble over the speaker. */
export type SayMessage = { t: "say"; text: string };
/** Voice: whether my microphone is on (so others know to call me). */
export type VoiceMessage = { t: "voice"; on: boolean };
/**
 * Setting up a call to one person (WebRTC offer/answer/candidate), passed on
 * as it is. The same shape saha.ing's own calls use (shared/space-wire.ts).
 */
export type KitSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
export type SignalMessage = { t: "signal"; to: string; s: KitSignal };
/**
 * A MOMENT, for everyone in the space right now and never kept: a note
 * struck, a door opened, a ball thrown. Instruments are made of these.
 */
export type EmitMessage = { t: "emit"; name: string; data: unknown };
export type ClientMessage = PoseMessage | SetMessage | SayMessage | VoiceMessage | SignalMessage | EmitMessage;

export type KitPerson = {
  id: string;
  name: string;
  /** Their saha.ing body (avatar-choice.ts), when they chose one. */
  body: string | null;
  /** Where that body's model is, relative to saha.ing, or null. */
  bodyUrl: string | null;
  color: string;
  p: Vec3 | null;
  q: Quat | null;
  hl: Vec3 | null;
  hr: Vec3 | null;
  /** Their microphone is on. */
  voice?: boolean;
};

export type ServerMessage =
  | { t: "hello"; you: KitPerson | null; guest: boolean; space: string; state: Record<string, unknown>; people: KitPerson[] }
  | { t: "people"; people: KitPerson[] }
  | { t: "set"; k: string; v: unknown; by: string }
  | { t: "say"; id: string; name: string; text: string; at: number }
  | { t: "refused"; why: string }
  | { t: "signal"; from: string; s: KitSignal }
  | { t: "event"; from: string; name: string; data: unknown };

export const KIT_LIMITS = {
  /** Poses beyond this rate are dropped, not queued. */
  posesPerSecond: 20,
  /** How often the server sends everyone's poses, when anything moved. */
  broadcastHz: 10,
  keys: 200,
  keyLength: 64,
  valueBytes: 4096,
  totalBytes: 256 * 1024,
  sayLength: 280,
  setsPerSecond: 10,
  /** Moments: a fast player strikes a lot of notes. */
  eventsPerSecond: 30,
  eventBytes: 1024,
  /** A ticket is good for this long after it is made. */
  ticketMs: 30 * 60_000,
  /** Nobody in a room can stand further than this from its middle. */
  reach: 500,
} as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vec = (value: unknown, length: number, limit: number): boolean =>
  Array.isArray(value) && value.length === length && value.every((part) => finite(part) && Math.abs(part) <= limit);

/** A message a page sent, checked; null when it is not one we take. */
export function readClientMessage(raw: unknown): ClientMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  if (message.t === "pose") {
    if (!vec(message.p, 3, KIT_LIMITS.reach) || !vec(message.q, 4, 1.0001)) return null;
    const hand = (value: unknown) => (vec(value, 3, KIT_LIMITS.reach) ? (value as Vec3) : null);
    return { t: "pose", p: message.p as Vec3, q: message.q as Quat, hl: hand(message.hl), hr: hand(message.hr) };
  }
  if (message.t === "set") {
    if (typeof message.k !== "string" || !stateKeyOk(message.k)) return null;
    if (message.v !== null && bytesOf(message.v) > KIT_LIMITS.valueBytes) return null;
    return { t: "set", k: message.k, v: message.v ?? null };
  }
  if (message.t === "voice") return { t: "voice", on: message.on === true };
  if (message.t === "emit") {
    if (typeof message.name !== "string" || !/^[A-Za-z0-9_.:-]{1,32}$/.test(message.name)) return null;
    if (bytesOf(message.data ?? null) > KIT_LIMITS.eventBytes) return null;
    return { t: "emit", name: message.name, data: message.data ?? null };
  }
  if (message.t === "signal") {
    const signal = message.s as Record<string, unknown> | undefined;
    if (typeof message.to !== "string" || message.to.length > 80 || !signal || typeof signal !== "object") return null;
    if ((signal.kind === "offer" || signal.kind === "answer") && typeof signal.sdp === "string" && signal.sdp.length <= 16_000) {
      return { t: "signal", to: message.to, s: { kind: signal.kind, sdp: signal.sdp } };
    }
    if (signal.kind === "candidate" && typeof signal.candidate === "string" && signal.candidate.length <= 2000) {
      return {
        t: "signal",
        to: message.to,
        s: {
          kind: "candidate",
          candidate: signal.candidate,
          sdpMid: typeof signal.sdpMid === "string" ? signal.sdpMid.slice(0, 64) : null,
          sdpMLineIndex: typeof signal.sdpMLineIndex === "number" ? signal.sdpMLineIndex : null,
        },
      };
    }
    return null;
  }
  if (message.t === "say") {
    if (typeof message.text !== "string") return null;
    const text = message.text.replace(/\s+/g, " ").trim().slice(0, KIT_LIMITS.sayLength);
    return text ? { t: "say", text } : null;
  }
  return null;
}

export function stateKeyOk(key: string): boolean {
  return key.length > 0 && key.length <= KIT_LIMITS.keyLength && /^[A-Za-z0-9_.:/-]+$/.test(key);
}

export function bytesOf(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** A colour per name, the same on every screen, so people can tell each other apart. */
export function colorFor(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360}, 65%, 58%)`;
}

/** Where a space page is entered from saha.ing: the ticket rides in the #fragment. */
export function spaceEntryPath(space: string, ticket: string): string {
  return `/s/${space}/#saha=${encodeURIComponent(ticket)}`;
}

/** Title shown on a public room's lobby door. */
export function doorTitle(title: string | null | undefined, space: string): string {
  const clean = (title ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
  return clean || space;
}
