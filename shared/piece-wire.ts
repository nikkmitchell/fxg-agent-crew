/**
 * LIVE PIECES: A SPACE'S CODE, RUNNING IN ANY ROOM, IN VR (Nightjar,
 * 2026-09-30; Nikk: "build once, use anywhere").
 *
 * A piece is a JavaScript module in a space's repo:
 *
 *   export default function (saha) {
 *     const drum = saha.add({ shape: "cylinder", size: [0.18, 0.12], color: "#a0522d", at: [0, 0.06, 0], pressable: true });
 *     drum.on("press", () => saha.emit("hit", { hz: 110 }));
 *     saha.on("event", (name, data) => { if (name === "hit") saha.sound({ tone: data.hz, ms: 500 }); });
 *   }
 *
 * WHY IT RUNS WHERE IT RUNS. Only one page can own a headset's VR session,
 * so for a piece to be in the saha.ing room (or any space) it must be drawn by
 * THAT page. But it is somebody else's code, and must never run as that page.
 * So it runs in a worker made from a data: URL, which the browser gives an
 * opaque origin of its own (tried in Chromium: it cannot read saha.ing), and it
 * only DESCRIBES what to draw. The page hosting it checks every message here,
 * draws it, and tells it when somebody presses one of its parts. The same file
 * runs in the saha.ing room and in any space's page, unchanged.
 *
 * Everything a piece sends is read by readPieceOp below and nothing else:
 * numbers are clamped, strings cut, colours checked, counts limited. A piece
 * that sends something wrong loses that message, not the room.
 */

export type Vec3 = [number, number, number];

export const PIECE_API = 1;

export const PIECE_LIMITS = {
  /** Parts one piece may have at once. */
  nodes: 256,
  /** Models one piece may load at once. */
  models: 8,
  /** How far from its spot a part may stand, in metres, on every axis. */
  reach: 5,
  /** The largest size or scale of any part. */
  size: 5,
  /** Characters in a text part, a state key, an event name. */
  text: 200,
  key: 64,
  /** JSON bytes of one shared value or one moment's data. */
  valueBytes: 2048,
  /** Messages a piece may send per second (a burst up to this, refilled each second). */
  perSecond: 240,
  /** Sounds per second. */
  soundsPerSecond: 20,
  /** Longest tone, loudest gain. */
  toneMs: 4000,
  gain: 0.5,
  /** Longest a tween may take. */
  tweenMs: 10_000,
  /** A piece that answers no ping for this long is stopped. */
  silentMs: 5000,
} as const;

export const PIECE_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "ring"] as const;
export type PieceShape = (typeof PIECE_SHAPES)[number];

/** What a part is and how it looks. Every field is optional on a change. */
export type NodeSpec = {
  shape?: PieceShape;
  /** Per shape: box [w, h, d]; sphere [r]; cylinder [r, h] or [rTop, rBottom, h]; cone [r, h]; torus [r, tube]; plane [w, h]; ring [inner, outer]. */
  size?: number[];
  /** A .glb/.gltf of the piece's own space, as a path next to the piece's file. */
  model?: string;
  text?: string;
  /** Height of a line of text, in metres. */
  textSize?: number;
  color?: string;
  emissive?: string;
  opacity?: number;
  at?: Vec3;
  /** Rotation in radians about x, y and z. */
  turn?: Vec3;
  scale?: number | Vec3;
  visible?: boolean;
  /** Turns about its own y axis at this many radians a second (the host does it; no messages). */
  spin?: number;
  /** Receives "press" when somebody clicks it, points at it and pulls the trigger, or pinches it. */
  pressable?: boolean;
  /** Another part of this piece to stand on (its id). */
  parent?: number;
};

export type PieceSound = { tone?: number; ms?: number; wave?: "sine" | "square" | "triangle" | "sawtooth"; url?: string; gain?: number };
export type PieceTween = { at?: Vec3; turn?: Vec3; scale?: number | Vec3; color?: string; opacity?: number };

/** From the piece to the page hosting it. */
export type PieceOp =
  | { t: "add"; id: number; spec: NodeSpec }
  | { t: "set"; id: number; spec: NodeSpec }
  | { t: "remove"; id: number }
  | { t: "tween"; id: number; to: PieceTween; ms: number }
  | { t: "sound"; sound: PieceSound }
  | { t: "state"; k: string; v: unknown }
  | { t: "emit"; name: string; data: unknown }
  | { t: "log"; text: string }
  | { t: "ready" }
  | { t: "failed"; text: string }
  | { t: "pong"; n: number };

export type PiecePerson = { id: string; name: string };

/** From the page hosting it to the piece. */
export type HostMessage =
  | { t: "start"; api: number; url: string; env: "room" | "space"; space: string; you: PiecePerson | null; state: Record<string, unknown> }
  | { t: "press"; id: number; by: PiecePerson | null; hand: "left" | "right" | "pointer"; point: Vec3 }
  | { t: "state"; k: string; v: unknown; by: string | null }
  | { t: "event"; name: string; data: unknown; from: string | null }
  | { t: "ping"; n: number };

const finite = (value: unknown, low: number, high: number): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : null;

function vec(value: unknown, low: number, high: number): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out = value.map((n) => finite(n, low, high));
  return out.every((n) => n !== null) ? (out as Vec3) : null;
}

const COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const colour = (value: unknown): string | null => (typeof value === "string" && COLOUR.test(value) ? value.toLowerCase() : null);

const text = (value: unknown, max: number): string | null => (typeof value === "string" ? value.slice(0, max) : null);

/**
 * A path of the piece's own space, beside the piece's file: letters, digits and
 * - _ . /, no "..", no leading slash, no address of anywhere else. What a piece
 * loads is its own space's, so a piece cannot make everyone who looks at it
 * fetch from some other server.
 */
export function ownPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  if (!/^[A-Za-z0-9_\-./]+$/.test(value) || value.startsWith("/") || value.split("/").some((part) => part === ".." || part === "")) return null;
  return value.replace(/^(\.\/)+/, "");
}

function json(value: unknown): unknown | undefined {
  try {
    const encoded = JSON.stringify(value ?? null);
    return encoded.length <= PIECE_LIMITS.valueBytes ? JSON.parse(encoded) : undefined;
  } catch {
    return undefined;
  }
}

/** A part's description, with everything out of bounds dropped or clamped. */
export function readSpec(raw: unknown): NodeSpec {
  const given = (raw ?? {}) as Record<string, unknown>;
  const spec: NodeSpec = {};
  if ((PIECE_SHAPES as readonly unknown[]).includes(given.shape)) spec.shape = given.shape as PieceShape;
  if (Array.isArray(given.size)) {
    const size = given.size.slice(0, 3).map((n) => finite(n, 0.001, PIECE_LIMITS.size));
    if (size.length && size.every((n) => n !== null)) spec.size = size as number[];
  }
  const model = ownPath(given.model);
  if (model && /\.(glb|gltf)$/i.test(model)) spec.model = model;
  const words = text(given.text, PIECE_LIMITS.text);
  if (words !== null) spec.text = words;
  const textSize = finite(given.textSize, 0.005, 1);
  if (textSize !== null) spec.textSize = textSize;
  const tint = colour(given.color);
  if (tint) spec.color = tint;
  const glow = colour(given.emissive);
  if (glow) spec.emissive = glow;
  const opacity = finite(given.opacity, 0, 1);
  if (opacity !== null) spec.opacity = opacity;
  const at = vec(given.at, -PIECE_LIMITS.reach, PIECE_LIMITS.reach);
  if (at) spec.at = at;
  const turn = vec(given.turn, -100, 100);
  if (turn) spec.turn = turn;
  const scale = typeof given.scale === "number" ? finite(given.scale, 0.001, PIECE_LIMITS.size) : vec(given.scale, 0.001, PIECE_LIMITS.size);
  if (scale !== null) spec.scale = scale;
  if (typeof given.visible === "boolean") spec.visible = given.visible;
  const spin = finite(given.spin, -20, 20);
  if (spin !== null) spec.spin = spin;
  if (typeof given.pressable === "boolean") spec.pressable = given.pressable;
  if (typeof given.parent === "number" && Number.isSafeInteger(given.parent) && given.parent >= 0) spec.parent = given.parent;
  return spec;
}

function readTween(raw: unknown): PieceTween {
  const given = (raw ?? {}) as Record<string, unknown>;
  const spec = readSpec({ at: given.at, turn: given.turn, scale: given.scale, color: given.color, opacity: given.opacity });
  const to: PieceTween = {};
  if (spec.at) to.at = spec.at;
  if (spec.turn) to.turn = spec.turn;
  if (spec.scale !== undefined) to.scale = spec.scale;
  if (spec.color) to.color = spec.color;
  if (spec.opacity !== undefined) to.opacity = spec.opacity;
  return to;
}

/** An id names one part exactly: never clamped into some other part's. */
const id = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const KEY = /^[A-Za-z0-9_.:-]+$/;
const key = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= PIECE_LIMITS.key && KEY.test(value) ? value : null;

/** One message from a piece, checked; null for anything that is not a message a piece may send. */
export function readPieceOp(raw: unknown): PieceOp | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  switch (message.t) {
    case "add":
    case "set": {
      const part = id(message.id);
      return part === null ? null : { t: message.t, id: part, spec: readSpec(message.spec) };
    }
    case "remove": {
      const part = id(message.id);
      return part === null ? null : { t: "remove", id: part };
    }
    case "tween": {
      const part = id(message.id);
      const ms = finite(message.ms, 0, PIECE_LIMITS.tweenMs);
      return part === null || ms === null ? null : { t: "tween", id: part, to: readTween(message.to), ms };
    }
    case "sound": {
      const given = (message.sound ?? {}) as Record<string, unknown>;
      const sound: PieceSound = {};
      const tone = finite(given.tone, 20, 8000);
      if (tone !== null) {
        sound.tone = tone;
        sound.ms = finite(given.ms, 10, PIECE_LIMITS.toneMs) ?? 300;
        sound.wave = (["sine", "square", "triangle", "sawtooth"] as const).find((wave) => wave === given.wave) ?? "sine";
      }
      const url = ownPath(given.url);
      if (url && /\.(mp3|ogg|wav|m4a)$/i.test(url)) sound.url = url;
      if (sound.tone === undefined && sound.url === undefined) return null;
      sound.gain = finite(given.gain, 0, PIECE_LIMITS.gain) ?? 0.25;
      return { t: "sound", sound };
    }
    case "state": {
      const k = key(message.k);
      const v = json(message.v);
      return k === null || v === undefined ? null : { t: "state", k, v };
    }
    case "emit": {
      const name = key(message.name);
      const data = json(message.data);
      return name === null || data === undefined ? null : { t: "emit", name, data };
    }
    case "log":
    case "failed": {
      const words = text(message.text, 500);
      return words === null ? null : { t: message.t, text: words };
    }
    case "ready":
      return { t: "ready" };
    case "pong": {
      const n = id(message.n);
      return n === null ? null : { t: "pong", n };
    }
    default:
      return null;
  }
}

/**
 * How many messages a piece may still send: a bucket of PIECE_LIMITS.perSecond,
 * refilled over each second. Over it, messages are dropped (and said once).
 */
export class PieceBudget {
  private tokens: number;
  private last: number;
  constructor(private readonly perSecond: number, private readonly now: () => number = Date.now) {
    this.tokens = perSecond;
    this.last = now();
  }
  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.perSecond, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** The address a piece's own path stands for: beside the piece's file, in its space, and never anywhere else. */
export function resolveOwn(pieceUrl: string, path: string): string | null {
  const own = ownPath(path);
  if (!own) return null;
  const piece = new URL(pieceUrl);
  const resolved = new URL(own, piece);
  // The piece's space: /s/<space>/ (and /@<branch>/ within it).
  const root = /^\/s\/[^/]+\/(?:@[^/]+\/)?/.exec(piece.pathname)?.[0];
  if (resolved.origin !== piece.origin || !root || !resolved.pathname.startsWith(root)) return null;
  // The piece's own ?v=<deploy>, so a push reloads its models and sounds too.
  resolved.search = piece.search;
  return resolved.href;
}
