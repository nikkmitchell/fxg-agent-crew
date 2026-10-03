import type * as THREE from "three";

/**
 * THE CONTRACT, saha/1 (docs/things/DESIGN.md): what an item, an environment
 * or a space is given, and what it may give back. A thing is one ES module
 * whose default export is defineItem / defineEnvironment / defineSpace from
 * "saha" (server/spaces/saha-sdk.ts). Its setup(ctx) builds plain three.js
 * under ctx.root, in its own metres (floor y = 0, +Z toward whoever placed
 * it), and reaches the world only through ctx.
 *
 * Phase 1 runs on the room's existing relay (moduleState / moduleEvent): the
 * ordered model (act, model, onModel) and streams arrive in phase 2, and ask
 * for them now says so on the thing's badge rather than failing silently.
 */

export type Vec3 = [number, number, number];
export type Hand = "left" | "right";
/** placed life size | all around you | a space as a miniature */
export type Mode = "item" | "full" | "model";
export type Off = () => void;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ThingKind = "item" | "environment" | "space";

export interface Pose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/** Somebody in the world, with poses in YOUR thing's local frame (null when not known). */
export interface Person {
  readonly id: string;
  readonly name: string;
  readonly me: boolean;
  readonly agent: boolean;
}

export type Who = "builders" | "everyone";
export type Prop =
  | { type: "number"; default: number; min?: number; max?: number; step?: number; label?: string; who?: Who }
  | { type: "boolean"; default: boolean; label?: string; who?: Who }
  | { type: "choice"; default: string; options: Record<string, string>; label?: string; who?: Who }
  | { type: "color" | "text"; default: string; label?: string; who?: Who };

export interface EnvSettings {
  /** null: the room's own (passthrough, or black). */
  background: THREE.ColorRepresentation | THREE.Texture | null;
  fog: { color: THREE.ColorRepresentation; near: number; far: number } | { color: THREE.ColorRepresentation; density: number } | null;
  /** Keep the room's light rig, or bring your own (env.light). */
  lights: "room" | "own";
  exposure: number;
  /** Camera far plane, metres (the room's own is 60). */
  far: number;
}

export interface Child {
  ref: string;
  at?: Vec3;
  /** Degrees about the vertical. */
  turn?: number;
  scale?: number;
  props?: Record<string, Json>;
  /** The scenes it is mounted in; every scene when absent. */
  in?: string[];
  /** It is the space's environment: its surroundings are the space's. */
  surround?: boolean;
}

export interface Handle {
  /** What a parent space may call: ctx.things.<key>.api. */
  api?: Record<string, (...args: never[]) => unknown>;
  /** Handed to the next version, after a push, as ctx.hot.data. */
  save?(): unknown;
  /** Only what you made outside ctx: everything registered through ctx is undone for you. */
  dispose?(): void;
}

export interface ThingDefinition {
  readonly kind: ThingKind;
  readonly name: string;
  /** Local bounds in metres: the carry handle, the plinth, and how small a model is made. */
  readonly size?: Vec3;
  readonly props?: Record<string, Prop>;
  /** Defaults for ctx.state. */
  readonly shared?: Record<string, Json>;
  readonly model?: unknown;
  readonly env?: Partial<EnvSettings>;
  readonly spawn?: { at: Vec3; yaw?: number };
  readonly things?: Record<string, Child>;
  readonly scenes?: { list: string[]; initial: string };
  setup?(ctx: Ctx): Handle | void | Promise<Handle | void>;
}

export interface PressEvent {
  object: THREE.Object3D;
  /** Local to the thing. */
  point: THREE.Vector3;
  pointer: "mouse" | "screen" | "ray" | "poke" | "grab" | "key";
  hand: Hand | null;
  by: Person | null;
}
export interface StrikeEvent extends PressEvent {
  /** 0..1, from speed in WORLD metres: a model plays like the real thing. */
  strength: number;
}
export interface Tip {
  id: string;
  hand: Hand;
  kind: "controller" | "finger";
  /** Local to the thing. */
  position: THREE.Vector3;
  previous: THREE.Vector3;
  /** Local metres a second. */
  velocity: THREE.Vector3;
}

export interface Input {
  /** A click, a screen tap, a trigger or pinch along a ray, and (unless poke: false) a fingertip poke. */
  press(target: THREE.Object3D, fn: (e: PressEvent) => void, options?: { poke?: boolean }): Off;
  /** A hand, controller or held stick coming onto it; a click or ray counts as 0.7. */
  strike(target: THREE.Object3D, fn: (e: StrikeEvent) => void): Off;
  /** Only while this thing has your focus (pressed or struck in the last 30 s, or all around you). */
  keys(keys: string, fn: (key: string, down: boolean) => void): Off;
  /** One per hand, in local coordinates: a controller's grip or a tracked index fingertip. Empty in a model. */
  readonly tips: readonly Tip[];
}

export interface Ctx {
  readonly id: string;
  readonly kind: ThingKind;
  readonly mode: Mode;
  /** World metres per local metre (about 0.05 in a model). */
  readonly scale: number;
  readonly root: THREE.Group;
  readonly props: Readonly<Record<string, Json>>;
  readonly host: { readonly name: "room" | "site" | "test"; readonly final: boolean };
  readonly prefs: { readonly reducedMotion: boolean };
  readonly hot: { readonly data: unknown };
  /** dt is capped at 0.1 s. */
  frame(fn: (dt: number, t: number) => void): Off;

  /** SHARED VALUES: last write wins per key; kept; given to late arrivals. */
  readonly state: {
    get<T extends Json = Json>(key: string): T | undefined;
    set(key: string, value: Json | undefined): void;
    /** Runs NOW with the current value, then on every change from anyone. */
    watch(keys: string | string[], fn: (value: never, by: Person | null) => void): Off;
  };
  readonly net: {
    /** To every copy of THIS thing: yours first and at once; never kept. */
    moment(name: string, data?: Json): void;
    onMoment(name: string, fn: (data: never, info: { from: Person | null; mine: boolean; at: number }) => void): Off;
  };
  /** Phase 2 (the ordered log): ask now, and the badge says so. */
  act(action: string, payload?: Json): Promise<{ ok: true } | { ok: false; why: string }>;

  /** now(): server milliseconds, the same on every device. */
  readonly time: { now(): number; readonly elapsed: number };
  readonly people: { readonly me: Person | null; all(): readonly Person[] };
  /** You, in this thing's frame; distance is horizontal to its origin. */
  readonly viewer: Pose & { readonly distance: number };
  toLocal(world: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3;

  readonly input: Input;
  readonly haptics: { pulse(hand: Hand, strength: number, ms: number): void };
  readonly audio: {
    /** The page's one real context. close() on it does nothing. */
    readonly context: AudioContext;
    /** This thing's bus: the room's volume, quieter in a model, faded across reloads. */
    readonly out: GainNode;
    /** A source placed at `where` (an object, or a local point), kept there by the host. */
    at(where: THREE.Object3D | Vec3, options?: { refDistance?: number; rolloff?: number }): GainNode;
    /** Safe across hot reloads: each version's processors get their own names. */
    workletNode(url: string | URL, processor: string, options?: AudioWorkletNodeOptions): Promise<AudioWorkletNode>;
    buffer(url: string | URL): Promise<AudioBuffer>;
    readonly unlocked: boolean;
    /** After the first gesture or entering VR. Never await it in setup. */
    whenUnlocked(fn: () => void): Off;
  };
  readonly assets: {
    /** Beside this module, in the same pinned deploy. */
    url(path: string): string;
    texture(path: string, options?: { srgb?: boolean }): Promise<THREE.Texture>;
    gltf(path: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>;
    json<T = Json>(path: string): Promise<T>;
    bytes(path: string): Promise<ArrayBuffer>;
    canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
  };
  /** Writes count only while you are all around the room (env.writable). */
  readonly env: {
    set(settings: Partial<EnvSettings>): void;
    light(light: THREE.Light): Off;
    readonly writable: boolean;
  };
  /** Spaces: one handle per declared child, mounted or not. */
  readonly things: Record<string, ChildHandle>;
  readonly scene: string | null;
  caption(text: string | null): void;
  log(...args: unknown[]): void;
  /** Shown on the thing's badge, under its name. */
  problem(text: string): void;
}

export interface ChildHandle {
  readonly mounted: boolean;
  readonly root: THREE.Object3D | null;
  readonly api: Record<string, (...args: never[]) => unknown>;
  readonly state: Ctx["state"];
  /** These subscriptions are the space's: they survive the part's remounts and reloads, and end when the space goes. */
  onMoment: Ctx["net"]["onMoment"];
}
