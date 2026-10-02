

# name

Saha Things (contract saha/1): defineItem, defineEnvironment and defineSpace, running on one world log


# one_paragraph

Saha Things takes the engine-first design as its base, adds the strongest ideas from the other two proposals, and fixes what the judges found. The base supplies the core. A running saha.ing room, a standalone site visit and a finished room are each a World: a tree of instances driven by one frame loop the host owns. Shared data travels on three channels: kept values and ordered actions, moments that are never stored, and streams where the latest value wins. Spaces compose by reference: dispatch and emit work at the model level, and api and onMoment at the view level. The same module file runs in four hosts. Every item, environment and space is one ES module whose default export is defineItem, defineEnvironment or defineSpace, imported from "saha". Its setup(ctx) builds plain three.js under ctx.root in local metres and reaches the world only through ctx. From the web-native proposal come three things: a push starts the new version beside the old one, and a broken push keeps the old one running; hands are read from the XRFrame; and services are shaped as ports. From the author-first proposal come: watch, which runs at once and then on every change; moments that play locally first; declared props and buttons in place of hand-built menus; explanatory errors; and a Node test host. The fixes:
- Phase 1 rides the moduleState/moduleEvent relay that already exists. The ordered log arrives in phase 2.
- Reducers apply only once the server confirms them, so the hardest code (speculation and rebase) is not needed.
- A $leave entry waits out a 45-second grace period, because headset sockets reconnect about every 30 seconds.
- Each kind of pointer has exactly one dispatch path. No mesh has its raycast disabled. Pokes can be turned off per target, so the drums no longer fire twice.
- New input: drag, buttons, player.teleport and people.attach. New services: media and canvas.
- Audio uses the page's real AudioContext with a guard against close(). Worklet processor names are hashed, so hot reload never collides.
- Standalone sites, which run in a CSP sandbox with no cookies, resolve refs by ticket.
- Vite builds in app mode with JS entries, not library mode.
- The sandbox path is stated honestly as same-realm compartments. The worker approach was tried in 42441f0 and removed in b1467a7.
The server never runs authors' code. It keeps git, deploys and the pinned /s/<repo>/~<deploy>/ URLs, and its new job is to put actions in order.


# contract

TERMS
- repo: a git space at saha.ing/git/<repo>.git, deployed at /s/<repo>/ (for example meditation.ar or xr.instruments). Below, "space" always means the third kind of thing, never a repo.
- thing: an item, an environment or a space. It is one ES module in a repo, listed in that repo's manifest.
- instance: one copy of a thing in a world. Its id is the same on every copy: "<roomItemId>", or "<parentId>/<key>" for a space's child.
- world: a running tree of instances with one shared timeline. There are three kinds:
  - a saha.ing room: room:<roomKey>;
  - a visit to a standalone site: site:<repo>@<branch>;
  - a finished room: a room whose base is a pinned space.
- ref: how one thing names another.
  - "rain": an id in the same repo and the same deploy.
  - "xr.instruments/drums": that repo's followed branch.
  - "xr.instruments/drums@things": a named branch.
  - "xr.instruments/drums~<deployId>": pinned. Finalizing a room writes these.
  - "saha:go": an official thing.
- host: what draws a world. There are three: the R3F room, the standalone kit page, and the Node test host.

RULES (these make a thing portable now and sandboxable later)
R1. One ES module per thing. Its default export is defineItem(...), defineEnvironment(...) or defineSpace(...) from "saha". The only bare imports are "three", "three/addons/..." and "saha". Relative files are allowed. The vite build bundles any npm packages.
R2. Nothing happens at the top level of the module: no listeners, no AudioContext, no timers, no fetch, no DOM. A cache of pure data is allowed. Every push loads a new module record from a new pinned URL, so a top-level side effect leaks on every reload. Definitions must also be importable in Node.
R3. Draw only under ctx.root. Never touch any of these: window or document listeners, navigator.xr, the renderer, the camera, the room's scene, root.parent, setAnimationLoop, or scene.background. Use ctx for all of them.
R4. Every position the host gives you is in root-local metres: the floor is y=0, and +Z points toward the person who placed the thing. This is Sill's convention in drums-math.js.
R5. Anything shared or sent must be JSON. Reducers are pure: they use m.now, m.random and m.by, never Date.now or Math.random.
R6. Whatever you register through ctx, the host undoes on dispose. Anything else you made goes in the dispose() you return.
R7. Never close the AudioContext and never connect to context.destination. Play into ctx.audio.out or ctx.audio.at(...).

THE FOUR CHANNELS
| channel | API | kept? | ordering | use it for |
|---|---|---|---|---|
| shared values | ctx.state.set/get/watch | kept, given to late arrivals | last write wins, per key | settings in use, a lamp that is lit, a playhead, a simple space's scene |
| ordered actions | model + ctx.act | kept, given to late arrivals | one order per world, decided by reducers | holding things, turns, scores, scripts that must happen exactly once |
| moments | ctx.net.moment/onMoment | never kept | as sent | drum hits, meteors, flashes |
| streams | ctx.net.stream/streams | latest value only | latest wins, per sender | a carried glass, a rake tip, a pointer |

WHO DOES WHAT (the whole multiplayer model, in four rules)
1. Input handlers run only on the device of the person doing the input.
2. A moment runs on every copy: yours first and at once (info.mine is true), everyone else's when it arrives.
3. A shared decision is made once, by whoever caused it. Call ctx.state.set or ctx.act from an input handler, or from a moment handler only when info.mine is true. Never call them from code that runs on every copy.
4. Anything that depends only on time uses ctx.time.now(), which is server time, and needs no messages: sand in a glass, the instant shown by a night sky, a video's playhead, a rain fade.

THE TYPES (saha.d.ts, served at /kit/saha.d.ts; the runtime is the import-map entry "saha", served as /kit/saha-sdk.js)
```ts
import type * as THREE from "three";
export type Vec3 = [number, number, number];
export type Hand = "left" | "right";
export type Mode = "item" | "full" | "model";      // placed life size | all around you | a space as a miniature
export type Off = () => void;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Pose { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion }
export interface Person {                          // poses in YOUR thing's local frame
  readonly id: string; readonly name: string; readonly color: string;
  readonly me: boolean; readonly guest: boolean; readonly agent: boolean; readonly talking: boolean;
  readonly head: Pose | null; readonly hands: { readonly left: Pose | null; readonly right: Pose | null };
}

/* ---------- definitions ---------- */
type Who = "builders" | "everyone";                // builders' controls are hidden in a finished room
export type Prop =
  | { type: "number"; default: number; min?: number; max?: number; step?: number; label?: string; who?: Who }
  | { type: "boolean"; default: boolean; label?: string; who?: Who }
  | { type: "choice"; default: string; options: Record<string, string>; label?: string; who?: Who }
  | { type: "color" | "text"; default: string; label?: string; who?: Who };

export interface ModelCtx {                        // inside a reducer: identical on every device for the same entry
  readonly now: number;                            // the entry's server time, ms
  readonly seq: number;
  readonly by: { id: string; name: string } | null;  // stamped by the server from the session; null for timers
  readonly people: readonly string[];              // seated ids, from $join/$leave entries
  random(): number;                                // seeded by (world, seq, instance, call)
  emit(event: string, data?: Json): void;          // once to this thing's views, and to its parent's model `on`
  dispatch(child: string, action: string, payload?: Json): void;   // spaces: a child's reducer, in this same step
  after(ms: number, action: string, payload?: Json): void;         // a timer kept in the state (no traffic)
}
/** Mutate `state`. Return false or a sentence to refuse it; the sender's act() resolves with the sentence. */
export type Reducer<S> = (state: S, payload: any, m: ModelCtx) => void | false | string;
export interface Model<S, P> {
  version?: number;
  initial(props: P): S;
  actions: Record<string, Reducer<S>>;
  on?: Record<string, Reducer<S>>;                 // "$join" | "$leave" (payload: person id) | "$props" | "<childKey>:<event>"
  migrate?(old: unknown, fromVersion: number, props: P): S;
}
interface Thing<S, P> {
  name: string;
  size?: Vec3;                                     // local bounds: carry handle, plinth, culling, the miniature's box
  props?: { [K in keyof P]: Prop };                // per-instance settings: same for everyone, kept, drawn in the gear menu
  shared?: Record<string, Json>;                   // defaults for ctx.state
  model?: Model<S, P>;
  buttons?: Record<string, { label: string; who?: Who; press(ctx: Ctx<S, P>): void }>;
  views?: Record<string, { at: Vec3; look: Vec3 }>;   // named viewpoints: "Go to" in the gear menu, ?view= on a site
  ports?: { actions?: string[]; events?: string[]; moments?: string[]; streams?: string[]; api?: string[] };
  relevance?: { radius?: number; whenFar?: "run" | "hide" | "sleep"; audible?: boolean };
  budget?: { draws?: number; triangles?: number; ms?: number };
  setup(ctx: Ctx<S, P>): Handle | void | Promise<Handle | void>;
}
export interface Handle {
  api?: Record<string, (...args: any[]) => any>;   // what a parent space may call (ctx.things.<key>.api)
  save?(): unknown;                                // handed to the next version as ctx.hot.data
  dispose?(): void;                                // only what you made outside ctx
}
export interface EnvSettings {
  background: THREE.ColorRepresentation | THREE.Texture | null;   // null: the real room (passthrough) or black
  fog: { color: THREE.ColorRepresentation; near: number; far: number } | { color: THREE.ColorRepresentation; density: number } | null;
  lights: "room" | "own";                          // keep the room's light rig, or bring your own (env.light)
  exposure: number;
  far: number;                                     // camera far (the room's is 60 m)
  passthrough: "hidden" | "visible";
  ground: number | null;                           // floor height for teleport and walking
  transitionMs: number;
}
export interface Child { ref: string; at?: Vec3; turn?: number /* degrees */; scale?: number;
  props?: Record<string, Json>; in?: string[] /* scenes it is mounted in */; surround?: boolean /* it is the environment */; movable?: boolean }
export declare function defineItem<S = {}, P = {}>(def: Thing<S, P>): Thing<S, P>;
export declare function defineEnvironment<S = {}, P = {}>(def: Thing<S, P> & { env: Partial<EnvSettings>; spawn?: { at: Vec3; yaw?: number } }): Thing<S, P>;
export declare function defineSpace<S = {}, P = {}>(def: Omit<Thing<S, P>, "setup"> & { setup?: Thing<S, P>["setup"];
  things: Record<string, Child>; scenes?: { list: string[]; initial: string };
  env?: Partial<EnvSettings>; spawn?: { at: Vec3; yaw?: number } }): Thing<S, P>;

/* ---------- what setup gets ---------- */
export interface Ctx<S = any, P = any> {
  readonly id: string; readonly kind: "item" | "environment" | "space";
  readonly mode: Mode; readonly scale: number;     // world metres per local metre (0.05 in a miniature)
  readonly root: THREE.Group;                      // your place: the host positions, carries, scales and culls it
  readonly props: Readonly<P>;
  readonly host: { readonly name: "room" | "site" | "test"; readonly final: boolean; readonly canAct: boolean };
  readonly prefs: { readonly reducedMotion: boolean; readonly quality: "quest" | "desktop"; readonly pixelRatio: number };
  readonly hot: { readonly data: unknown };
  frame(fn: (dt: number, t: number) => void): Off;              // dt is capped at 0.1 s
  on(event: "props" | "sleep" | "wake", fn: () => void): Off;   // a mode change re-runs setup instead

  state: {                                         // SHARED VALUES: last write wins per key; kept; 4 KB per value at most
    get<T extends Json = Json>(key: string): T | undefined;
    set(key: string, value: Json | undefined): void;            // applies here at once, then everywhere
    watch(keys: string | string[], fn: (value: any, by: Person | null) => void): Off;   // runs NOW, then on each change
  };
  readonly model: Readonly<S>;                     // ORDERED: the confirmed model state
  act(action: string, payload?: Json): Promise<{ ok: true } | { ok: false; why: string }>;
  onModel(fn: () => void): Off;                    // runs NOW, then after each change
  onEvent(name: string, fn: (data: any, info: { by: Person | null; at: number; mine: boolean }) => void): Off;  // model events, once each; never replayed

  readonly net: {
    moment(name: string, data?: Json): void;       // every copy of THIS instance: yours first and at once; never kept
    onMoment(name: string, fn: (data: any, info: { from: Person | null; mine: boolean; at: number }) => void): Off;
    stream(name: string, value: Json): void;       // latest per sender; up to 15 Hz and 256 B; gone when the sender leaves
    streams(name: string): ReadonlyMap<string, { value: any; at: number }>;
  };
  readonly time: { now(): number; readonly elapsed: number };   // now(): server ms, the same on every device
  readonly people: {
    readonly me: Person | null; all(): readonly Person[]; get(id: string): Person | null;
    on(event: "join" | "leave", fn: (p: Person) => void): Off;
    attach(id: string, at: "head" | "left" | "right" | "body", object: THREE.Object3D): Off;   // surrounding thing only (team marks, a held tool)
  };
  readonly viewer: Pose & { readonly distance: number };   // you, local; in a miniature, the "you are here" pin; distance is horizontal to the origin
  toLocal(world: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3;

  readonly input: Input;
  readonly haptics: { pulse(hand: Hand, strength: number, ms: number): void };
  readonly audio: {
    readonly context: AudioContext;                 // the page's one real context; close() on it is a harmless no-op
    readonly out: GainNode;                         // this thing's bus: room volume and mute, quieter in a miniature, crossfaded across reloads
    at(where: THREE.Object3D | Vec3, options?: { refDistance?: number; rolloff?: number }): GainNode;   // an HRTF panner the host keeps at `where`; one per source
    workletNode(url: string | URL, processor: string, options?: AudioWorkletNodeOptions): Promise<AudioWorkletNode>;  // safe across hot reloads
    buffer(url: string | URL): Promise<AudioBuffer>;
    readonly unlocked: boolean;
    whenUnlocked(fn: () => void): Off;              // after the first gesture or entering VR; never await it in setup
  };
  readonly media: { video(url: string, options?: { loop?: boolean; follow?: string }): Promise<Video> };   // follow: a shared value { playing, at, offset } kept in step
  readonly assets: {
    url(path: string): string;                      // beside this module, in the same pinned deploy
    texture(path: string, options?: { srgb?: boolean }): Promise<THREE.Texture>;
    gltf(path: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>;
    json<T = Json>(path: string): Promise<T>; bytes(path: string): Promise<ArrayBuffer>;
    canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;   // drawn textures (never document.createElement)
  };
  readonly env: {                                   // writes count only while you fill the surroundings
    set(settings: Partial<EnvSettings>): void; light(light: THREE.Light): Off;
    readonly active: Readonly<EnvSettings>; readonly writable: boolean; readonly passthroughAvailable: boolean;
  };
  readonly player: { readonly writable: boolean; teleport(at: Vec3, yaw?: number): void };   // surrounding thing only
  readonly things: Record<string, ChildHandle>;    // spaces: one handle per declared child, mounted or not
  readonly scene: string | null;
  caption(text: string | null, options?: { for?: number }): void;
  log(...args: unknown[]): void;
  problem(text: string): void;                      // shown on the thing's badge, under its name
}
export interface ChildHandle {
  readonly mounted: boolean; readonly root: THREE.Object3D | null; readonly model: any;
  readonly api: Record<string, (...args: any[]) => any>;
  readonly state: Ctx["state"];
  act(action: string, payload?: Json): Promise<{ ok: true } | { ok: false; why: string }>;
  onEvent: Ctx["onEvent"]; onMoment: Ctx["net"]["onMoment"];   // these subscriptions survive remounts and reloads
}
export interface Input {
  press(target: THREE.Object3D, fn: (e: PressEvent) => void, options?: { poke?: boolean }): Off;
      // a click, a screen tap, a trigger or pinch along a ray, and (unless poke: false) a fingertip poke
  hover(target: THREE.Object3D, fn: (over: boolean, e: PressEvent) => void): Off;
  drag(target: THREE.Object3D, h: { start?(e: PressEvent): boolean | void; move?(e: PressEvent): void; end?(e: PressEvent): void }): Off;
      // a held press moving ACROSS the surface; e.point (local) every frame: rakes, sliders, painting, scrubbing
  grab(target: THREE.Object3D, options: GrabOptions): Off;   // pick it up: squeeze or pinch near it, a grip, or a mouse drag (the wheel pushes and pulls)
  strike(target: THREE.Object3D, fn: (e: StrikeEvent) => void): Off;   // a hand, controller or held stick coming onto it; a click counts as 0.7
  keys(keys: string, fn: (key: string, down: boolean) => void): Off;   // only while this thing has focus
  buttons(fn: (hand: Hand, button: "trigger" | "squeeze" | "a" | "b" | "stick", down: boolean) => void): Off;   // the hand holding your grabbed thing, or the surrounding thing
  readonly hands: { readonly left: HandState | null; readonly right: HandState | null };
  readonly tips: readonly Tip[];                    // one per hand: a controller's grip, or a tracked hand's index fingertip; empty in a miniature
}
export interface Tip { id: string; hand: Hand; kind: "controller" | "finger"; position: THREE.Vector3; previous: THREE.Vector3; velocity: THREE.Vector3 }
export interface HandState { source: "hand" | "controller"; grip: Pose; tip: Pose; aim: Pose; pinch: number; squeeze: number; stick: [number, number]; joint(name: XRHandJoint): Pose | null }
export interface PressEvent { object: THREE.Object3D; point: THREE.Vector3; pointer: "mouse" | "screen" | "ray" | "poke" | "grab"; hand: Hand | null; by: Person | null }
export interface StrikeEvent extends PressEvent { strength: number }   // 0..1, from speed in world metres
export interface GrabOptions { name?: string; home?: boolean /* glide back on release; otherwise the rest pose is kept */;
  start?(e: GrabEvent): boolean | void | Promise<boolean>;   /* false, now or later: the host lets go */
  move?(e: GrabEvent): void; end?(e: GrabEvent): void }
export interface GrabEvent { position: THREE.Vector3; quaternion: THREE.Quaternion; hand: Hand | null }   // local
export interface Video { texture: THREE.VideoTexture; play(at?: number): void; pause(): void; seek(seconds: number): void;
  readonly time: number; readonly duration: number; sound(where?: THREE.Object3D): void }
```
The calls most things need are root.add, frame, state.set and state.watch, net.moment and net.onMoment, act and onModel, input.press, input.tips or input.strike, audio.at, and assets.url.

EXAMPLE 1. AN ITEM: SILL'S HAND DRUMS, PORTED (plain JS, no build)
```js
// xr.instruments  things/drums.js   (pieces/drums-math.js and its node test are unchanged)
import * as THREE from "three";
import { defineItem } from "saha";
import { DRUMS, membrane, rearmed, struck } from "../pieces/drums-math.js";

export default defineItem({
  name: "Hand drums",
  size: [1.9, 1.0, 0.7],
  props: { tuning: { type: "number", default: 0, min: -6, max: 6, step: 1, label: "Tuning (semitones)", who: "everyone" } },
  ports: { moments: ["hit"], api: ["hit"] },
  relevance: { radius: 8, whenFar: "hide", audible: true },
  budget: { draws: 16, triangles: 15000 },

  setup(ctx) {
    const { root, input, audio, haptics, net } = ctx;
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.75 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.35 });
    const heads = DRUMS.map((drum, d) => {
      const [x, y, z] = drum.at;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(drum.radius, drum.radius * 0.92, 0.16, 40, 1, true), wood);
      shell.position.set(x, y - 0.08, z);
      const skin = new THREE.Mesh(new THREE.CircleGeometry(drum.radius * 0.97, 40),
        new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.6, emissive: 0xffb060, emissiveIntensity: 0 }));
      skin.rotation.x = -Math.PI / 2;
      skin.position.set(x, y, z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(drum.radius, 0.008, 8, 40), steel);
      rim.rotation.x = Math.PI / 2;
      rim.position.copy(skin.position);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, y - 0.16), steel);
      leg.position.set(x, (y - 0.16) / 2, z);
      root.add(shell, skin, rim, leg);
      // A click, a screen tap, a trigger or pinch along a ray. Not a fingertip poke: hands strike (below), so no double hit.
      input.press(skin, () => net.moment("hit", { d, v: 0.8 }), { poke: false });
      return { drum, skin, glow: 0, voice: audio.at(skin, { refDistance: 1.5 }) };   // one panner per drum, made once
    });
    input.keys("1234", (key, down) => { if (down) net.moment("hit", { d: "1234".indexOf(key), v: 0.8 }); });

    // Every hit: yours first and at once, everyone else's as it arrives. Moments belong to this instance only.
    net.onMoment("hit", ({ d, v }) => {
      const head = heads[d | 0];
      if (!head) return;
      const velocity = Math.max(0.12, Math.min(1, Number(v) || 0.7));
      thump(audio.context, head.voice, membrane(head.drum, velocity), 2 ** (ctx.props.tuning / 12), head.drum.hz);
      head.glow = velocity;
    });

    // Strikes: a fingertip or controller coming DOWN through a skin, in the drums' own frame (Sill's maths).
    const armed = new Map();                                   // tip id -> armed flag per drum
    ctx.frame((dt) => {
      for (const head of heads) if (head.glow > 0) {
        head.glow = Math.max(0, head.glow - dt * 4);
        head.skin.material.emissiveIntensity = head.glow * 0.9;
      }
      for (const tip of input.tips) {                          // empty on a computer and in a miniature
        const ready = armed.get(tip.id) ?? DRUMS.map(() => true);
        armed.set(tip.id, ready);
        DRUMS.forEach((drum, d) => {
          const v = struck(drum, tip.previous, tip.position, dt, ready[d]);
          if (v > 0) {
            ready[d] = false;
            net.moment("hit", { d, v: Math.round(v * 100) / 100 });
            haptics.pulse(tip.hand, 0.15 + v * 0.6, 35 + v * 45);
          } else if (!ready[d] && rearmed(drum, tip.position)) ready[d] = true;
        });
      }
    });

    return { api: { hit: (d, v = 0.8) => net.moment("hit", { d, v }) } };   // a space may play them
  },
});

/** Sill's thump(), minus its own panner and listener code: it plays into `out`, which the host keeps at the skin. */
let noise = null;                                              // pure data: allowed at module level
function thump(context, out, tone, pitch, hz) {
  const at = context.currentTime;
  const voice = (type, from, to, level, decay) => {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from * pitch, at);
    osc.frequency.exponentialRampToValueAtTime(to * pitch, at + tone.drop);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(out);
    osc.start(at); osc.stop(at + decay + 0.05);
  };
  voice("sine", tone.from, tone.to, tone.gain * 0.72, tone.decay);
  voice("triangle", tone.from * 1.59, tone.to * 1.59, tone.gain * 0.16, tone.decay * 0.4);
  if (tone.snap > 0.01) {
    if (!noise || noise.sampleRate !== context.sampleRate) {
      noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.12), context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource(); source.buffer = noise;
    const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = 1400 + hz * 4;
    const gain = context.createGain();
    gain.gain.setValueAtTime(tone.snap, at); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    source.connect(filter).connect(gain).connect(out); source.start(at); source.stop(at + 0.12);
  }
}
```

EXAMPLE 2. AN ITEM WITH ORDERED STATE: MICA'S HOURGLASS
Today the hourglass has three problems:
- room.set is last-writer-wins, so two hands grabbing at once both believe they hold the glass.
- It needs a 15-second renewing lease (HOLD_LEASE_MS in hourglass-core.js) because a page that has gone away cannot let go.
- It reads Date.now on each device, so devices with skewed clocks disagree.
The model below replaces all three.
```js
// meditation.ar  instruments/things/hourglass.js
import { defineItem } from "saha";
import { createHourglassForm } from "../pieces/hourglass-form.js";   // takes { canvas, pixelRatio } instead of the renderer (two lines)
import { isInverted } from "../pieces/hourglass-core.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** Sand on top at `now` (server ms). Frozen while somebody holds the glass. */
export const sandTop = (s, now) => (s.heldBy ? s.top : clamp01(s.top - Math.max(0, now - s.at) / (s.runSeconds * 1000)));

export default defineItem({
  name: "Hourglass",
  size: [0.5, 1.45, 0.5],
  props: { minutes: { type: "number", default: 3, min: 0.25, max: 60, step: 0.25, label: "Minutes for a full glass", who: "everyone" } },
  ports: { actions: ["turn"], events: ["turned"], streams: ["pose"] },
  model: {
    version: 1,
    initial: (p) => ({ seconds: p.minutes * 60, runSeconds: p.minutes * 60, top: 0, at: 0, heldBy: null }),
    actions: {
      grab(s, _, m) {                              // two hands at once: the first in order wins, on every device alike
        if (!m.by) return false;
        if (s.heldBy && s.heldBy !== m.by.id) return "Someone else is holding the glass.";
        s.top = sandTop(s, m.now); s.at = m.now; s.heldBy = m.by.id;
      },
      release(s, { inverted }, m) {
        if (s.heldBy !== m.by?.id) return false;
        s.top = inverted ? 1 - s.top : s.top; s.at = m.now; s.heldBy = null;
        if (inverted) { s.runSeconds = s.seconds; m.emit("turned"); }
      },
      turn(s, _, m) {                              // the gear button, or a space's script
        if (s.heldBy) return "Someone is holding the glass.";
        s.top = 1 - sandTop(s, m.now); s.at = m.now; s.runSeconds = s.seconds; m.emit("turned");
      },
    },
    on: {
      $props(s, p) { s.seconds = p.minutes * 60; },                     // a new length applies from the next turn
      $leave(s, personId) { if (s.heldBy === personId) s.heldBy = null; },   // written after the grace period: no lease
    },
  },
  buttons: { turn: { label: "Turn it over", who: "everyone", press: (ctx) => ctx.act("turn") } },

  setup(ctx) {
    const form = createHourglassForm({ canvas: ctx.assets.canvas, pixelRatio: ctx.prefs.pixelRatio });
    ctx.root.add(form.root);
    let mine = false;
    ctx.input.grab(form.body, {
      name: "glass",
      home: true,                                                     // it glides back to its stand
      start: async () => (mine = (await ctx.act("grab")).ok),         // refused: the host lets go
      move: (e) => ctx.net.stream("pose", { p: e.position.toArray(), q: e.quaternion.toArray() }),
      end: (e) => { mine = false; void ctx.act("release", { inverted: isInverted(e.quaternion) }); },
    });
    ctx.onEvent("turned", (_, info) => ctx.caption(`${info.by?.name ?? "Someone"} turned the glass`, { for: 3 }));
    ctx.frame((dt, t) => {
      const s = ctx.model;
      if (s.heldBy && !mine) {                                        // someone else's hand: follow their stream
        const pose = ctx.net.streams("pose").get(s.heldBy)?.value;
        if (pose) { form.body.position.fromArray(pose.p); form.body.quaternion.fromArray(pose.q); }
      }
      form.update(sandTop(s, ctx.time.now()), t, !s.heldBy);
    });
  },
});
```
This removes about 150 of hourglass.js's 225 lines:
- the `<dialog>` and canvas settings panel, replaced by the minutes prop, edited in the gear menu;
- the hand-written pinch, controller and desktop grab code, replaced by input.grab;
- the lease, replaced by the model and $leave;
- the "hourglass-carry" moments, replaced by the pose stream.

EXAMPLE 3. AN ENVIRONMENT: MICA'S RAIN (TypeScript, built with vite)
```ts
// meditation.ar  src/things/rain.ts  ->  dist/things/rain.js   (vite.things.config.ts below)
import * as THREE from "three";
import { defineEnvironment } from "saha";
import { RainRetreatView } from "../space/rain-retreat-view";   // +2 lines: takes { sound } options for its RainAudio
import { createRainApproach } from "../space/rain-stone";
import { retreatLevel } from "../../shared/rain-retreat";
import workletUrl from "../space/rain-audio-worklet.ts?worker&url";

type Fade = { from: number; to: number; at: number; over: number };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** How much rain shows at `now`: a function of server time, so every device agrees with no messages. */
export const amount = (f: Fade, now: number) => f.from + (f.to - f.from) * (f.over > 0 ? clamp01((now - f.at) / f.over) : 1);

export default defineEnvironment<Fade, {}>({
  name: "Rain retreat",
  size: [10, 3, 10],
  // Unlit shaders, its own night colour, no passthrough. Mica's preview camera went to 150 m.
  env: { background: "#0b1520", fog: null, lights: "own", far: 150, passthrough: "hidden", transitionMs: 2500 },
  spawn: { at: [0, 0, 5.5], yaw: 0 },
  views: {                                             // these were ?review=rain|seat|stone
    rain: { at: [0, 1.6, 2.3], look: [0, 1.2, 0] },
    seat: { at: [0, 1.1, 0], look: [0.6, 0.7, -0.6] },
    stone: { at: [0.95, 0.88, 1.35], look: [0.1, 0.11, -0.04] },
  },
  ports: { actions: ["fade"], api: ["flash"] },
  budget: { draws: 12, triangles: 160000 },
  model: {
    initial: () => ({ from: 1, to: 1, at: 0, over: 0 }),
    actions: {
      fade(s, p: { to: number; over?: number }, m) {
        if (!Number.isFinite(p?.to)) return "fade needs a number `to`, from 0 to 1.";
        s.from = amount(s, m.now); s.to = clamp01(p.to); s.at = m.now; s.over = Math.max(0, p.over ?? 4000);
      },
    },
  },
  setup(ctx) {
    const retreat = new RainRetreatView({ x: 0, z: 0 }, {
      sound: {   // RainAudio's new options: the page's context and this thing's bus, never a context of its own
        context: ctx.audio.context,
        destination: ctx.audio.out,
        makeNode: (name: string, options: AudioWorkletNodeOptions) => ctx.audio.workletNode(workletUrl, name, options),
      },
    });
    const approach = createRainApproach();
    approach.material.uniforms.uFade.value = 1;
    ctx.root.add(retreat.group, approach);
    ctx.audio.whenUnlocked(() => void retreat.enableSound());   // no button; the gear menu has mute
    ctx.on("sleep", () => retreat.mute());                       // replaces RainAudio's document.visibilitychange listener
    ctx.on("wake", () => void retreat.enableSound());

    const night = new THREE.Color("#0b1520"), bright = new THREE.Color("#9fb4c8"), shown = new THREE.Color();
    let flash = 0;
    ctx.frame((dt) => {
      const near = ctx.mode === "model" ? 1 : retreatLevel(ctx.viewer.distance);   // a miniature shows all its rain
      retreat.update(near * amount(ctx.model, ctx.time.now()), dt, ctx.prefs.reducedMotion);
      if (flash > 0) {
        flash = Math.max(0, flash - dt * 2.5);
        ctx.env.set({ background: shown.copy(night).lerp(bright, flash * 0.35) });   // counts only while the rain surrounds you
      }
    });
    return {
      api: { flash: (v: number) => { flash = Math.max(flash, v); } },
      dispose: () => retreat.dispose(),            // its worklet node and quiet timer; the host frees the rest of root
    };
  },
});
```

EXAMPLE 4. A SPACE THAT COMPOSES AN ENVIRONMENT AND ITEMS WITH A SCRIPT
A tiny item whose press is a model event, so a space can react to it in order:
```js
// meditation.ar  things/begin-stone.js
import * as THREE from "three";
import { defineItem } from "saha";

export default defineItem({
  name: "Begin stone",
  size: [0.4, 0.2, 0.4],
  ports: { actions: ["press"], events: ["pressed"] },
  model: { initial: () => ({ presses: 0 }), actions: { press(s, _, m) { s.presses += 1; m.emit("pressed"); } } },
  setup(ctx) {
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9, emissive: 0x88aaff, emissiveIntensity: 0 }));
    stone.scale.y = 0.45; stone.position.y = 0.07;
    ctx.root.add(stone);
    ctx.input.press(stone, () => ctx.act("press"));   // input runs only on the presser's device: one action per press
    let glow = 0;
    ctx.onEvent("pressed", () => (glow = 1));          // once per press, on every device
    ctx.frame((dt) => { glow = Math.max(0, glow - dt); stone.material.emissiveIntensity = glow; });
  },
});
```
The space:
```js
// meditation.ar  things/rain-concert.js   (plain JS)
import { defineSpace } from "saha";
const CONCERT_MS = 5 * 60_000;

export default defineSpace({
  name: "Rain concert",
  size: [10, 3, 10],
  spawn: { at: [0, 0, 4], yaw: 180 },
  scenes: { list: ["arrival", "concert", "stillness"], initial: "arrival" },   // the scene is model.scene
  things: {
    rain:      { ref: "rain", surround: true },                                   // this repo, this deploy
    stone:     { ref: "begin-stone", at: [0, 0, 1.2], in: ["arrival"] },
    drums:     { ref: "xr.instruments/drums", at: [0, 0, -1.3], in: ["concert"], props: { tuning: -2 } },   // Sill's repo, followed live
    hourglass: { ref: "hourglass", at: [-1.2, 0, -0.9], turn: 30, in: ["concert", "stillness"], props: { minutes: 3 } },
  },
  model: {
    initial: () => ({ scene: "arrival", startedAt: 0, by: null }),
    actions: {
      settle(s, _, m) {                            // the timer fires at the same instant on every device
        if (s.scene !== "concert") return false;
        s.scene = "stillness";
        m.dispatch("rain", "fade", { to: 0.25, over: 20_000 });
        m.dispatch("hourglass", "turn");           // everyone's glass starts together
      },
      restart(s, _, m) { s.scene = "arrival"; m.dispatch("rain", "fade", { to: 1, over: 3000 }); },
    },
    on: {
      // The stone's model event, handled in the same ordered step as the press. Two presses in one second give one start.
      "stone:pressed"(s, _, m) {
        if (s.scene !== "arrival") return;
        s.scene = "concert"; s.startedAt = m.now; s.by = m.by?.id ?? null;
        m.dispatch("rain", "fade", { to: 0.6, over: 3000 });
        m.after(CONCERT_MS, "settle");
      },
      // The last person really left (after the 45 s grace, not a headset reconnect): start over.
      $leave(s, _id, m) { if (m.people.length === 0) { s.scene = "arrival"; m.dispatch("rain", "fade", { to: 1, over: 0 }); } },
    },
  },
  buttons: { restart: { label: "Start again", who: "everyone", press: (ctx) => ctx.act("restart") } },
  setup(ctx) {
    // Local wiring, no traffic. Every copy hears every hit (its own first), so every sky flashes.
    ctx.things.drums.onMoment("hit", ({ v }) => ctx.things.rain.api.flash?.(v * 0.6));
    // A shared decision from a moment: reported once, by whoever caused it.
    //   ctx.things.bowl.onMoment("ring", (_, info) => { if (info.mine) ctx.act("ring"); });
    let shown = null;
    ctx.onModel(() => {
      if (ctx.model.scene === shown) return;
      shown = ctx.model.scene;
      if (shown === "stillness") ctx.caption("Let the rain carry the rest.", { for: 6 });
    });
  },
});
```
How the engine runs it:
- A space's setup runs after the children of the current scene have mounted.
- Children mount and unmount by `in`.
- Every declared module is imported when the space starts, and each child is compiled out of sight before it is shown.
- Child ids are rain-concert's id plus /rain, /stone, /drums and /hourglass. Each child's state is its own, and the ids are stable across copies, reloads and scene changes.

EXAMPLE 5. SKETCH: THE GO TABLE AS AN OFFICIAL THING
```ts
// saha.official  things/go/index.ts   (also bundled into the room as "saha:go")
import { defineItem } from "saha";
import { placeGoStone } from "../../shared/go-rules";            // the room's own pure rules, unchanged
import { countGo } from "../../shared/go-score";
import { startClock, settleTurn } from "../../shared/go-clock";
import { GO_COLOURS, type GoStone, type GoCapture } from "../../shared/room-items";
import { buildGoTable } from "./table";        // board, bowls and stones in plain three.js (from RoomItems.tsx's GoTable, go-textures.ts, go-rock-geometry.ts)

type Go = { size: number; colours: string[]; turn: number; stones: GoStone[]; captures: GoCapture[];
  ko: { x: number; y: number } | null; passes: number; ended: boolean; seats: (string | null)[]; clock: any };

export default defineItem<Go, { size: string; players: number; clock: number }>({
  name: "Go table",
  size: [1.3, 0.8, 1.3],
  props: {
    size: { type: "choice", default: "9", options: { "9": "9 x 9", "13": "13 x 13", "19": "19 x 19" }, label: "Board", who: "everyone" },
    players: { type: "number", default: 2, min: 2, max: 8, step: 1, label: "Players", who: "everyone" },
    clock: { type: "number", default: 0, min: 0, max: 6, step: 1, label: "Clock preset", who: "everyone" },
  },
  ports: { actions: ["sit", "place", "pass", "clear"], events: ["placed", "ended"] },
  model: {
    version: 1,
    initial: (p) => ({ size: Number(p.size), colours: GO_COLOURS.slice(0, p.players), turn: 0, stones: [], captures: [],
      ko: null, passes: 0, ended: false, seats: Array(p.players).fill(null), clock: null }),
    actions: {
      sit(s, { colour }, m) { if (!m.by || s.seats[colour]) return "That seat is taken."; s.seats[colour] = m.by.id; },
      place(s, { x, y }, m) {
        if (s.ended) return "The game is over.";
        if (s.seats[s.turn] && s.seats[s.turn] !== m.by?.id) return "It is not your turn.";
        const move = placeGoStone(s.stones, s.size, { x, y, colour: s.turn }, s.ko);
        if ("error" in move) return move.error;
        s.captures.push(...move.captured.map((stone) => ({ ...stone, by: s.turn })));
        s.stones = move.stones; s.ko = move.ko; s.passes = 0;
        if (s.clock) s.clock = settleTurn(s.clock, s.turn, m.now);
        s.turn = (s.turn + 1) % s.colours.length;
        m.emit("placed", { x, y });
      },
      pass(s, _, m) {
        s.passes += 1; s.turn = (s.turn + 1) % s.colours.length;
        if (s.passes >= s.colours.length) { s.ended = true; m.emit("ended", countGo(s.stones, s.size, s.colours.length)); }
      },
      clear(s, _, m) { Object.assign(s, { stones: [], captures: [], ko: null, passes: 0, ended: false, turn: 0 }); },
    },
    on: {
      $props(s, p) { if (!s.stones.length) { s.size = Number(p.size); s.colours = GO_COLOURS.slice(0, p.players); s.seats = Array(p.players).fill(null); } },
      $leave(s, id) { s.seats = s.seats.map((seat) => (seat === id ? null : seat)); },
    },
  },
  setup(ctx) {
    const table = buildGoTable(ctx.root, ctx.assets);
    ctx.input.press(table.board, (e) => { const p = table.pointAt(e.point); if (p) void ctx.act("place", p); });   // a poke, a ray or a click
    ctx.onModel(() => table.show(ctx.model));               // runs now, then after every confirmed move
    ctx.onEvent("placed", () => table.clack(ctx.audio));
    // The lifted stone in a hand (go-hand-input.ts) becomes input.grab on the bowls. Carrying the table is the host's handle.
  },
});
```
Agents play by POSTing to /bff/worlds/:id/act. activity.ts walks them to the board when it sees "placed" entries.

THE MANIFEST: saha.json (at the top of what is published; saha-pieces.json keeps working)
```json
{
  "saha": 1,
  "three": "0.186",
  "things": [
    { "id": "rain", "kind": "environment", "name": "Rain retreat", "entry": "things/rain.js" },
    { "id": "begin-stone", "kind": "item", "name": "Begin stone", "entry": "things/begin-stone.js" },
    { "id": "hourglass", "kind": "item", "name": "Hourglass", "entry": "instruments/things/hourglass.js" },
    { "id": "rain-concert", "kind": "space", "name": "Rain concert", "entry": "things/rain-concert.js", "uses": ["xr.instruments/drums"] }
  ],
  "site": "rain-concert"
}
```
- ids follow the existing ENTRY rule: /^[a-z0-9][a-z0-9_-]{0,31}$/ (shared/room-items.ts).
- "uses" drives preloading, the Library card, and the lockfile written when a room is finalized.
- "site" makes /s/<repo>/ run that space as a website when the deploy has no index.html.
- The @saha/vite plugin (phase 3) fills in name, size, props, ports and budget by importing the built entries in Node, which works because of R2. Plain-JS repos write saha.json by hand.
- Until then, phase 1 uses saha-pieces.json's existing "item", "environment" and "space" entries, which readPieces already accepts.
- The engine decides the contract at import time. A default export branded with Symbol.for("saha.thing") is a thing. Anything else runs as a legacy factory through run-module.ts's adapter (with "export": "createDrums"), marked "legacy: not portable, not sandboxable". Note that Sill's saha-pieces.json lists drums as "code", which is not a module kind; the port adds an "item" entry.

THE BUILD FOR TYPESCRIPT AND VITE (vite.things.config.ts; app mode with JS entries, not library mode)
```ts
import { defineConfig } from "vite";
export default defineConfig({
  base: "./", publicDir: false,
  build: {
    outDir: "dist/things", emptyOutDir: true, target: "es2022", minify: false, sourcemap: true,
    rollupOptions: {
      input: { rain: "src/things/rain.ts", sky: "src/things/sky.ts" },
      preserveEntrySignatures: "exports-only",          // keep `export default`
      external: (id) => id === "three" || id.startsWith("three/addons/") || id === "saha",
      output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
});
```
- Library mode would inline assets as data: URLs, which is wrong for hyg-bright.bin.
- In this config, `?url`, `?worker&url` and `new URL(..., import.meta.url)` assets become files beside the entry, so they resolve inside the pinned deploy.
- The externals match Mica's vite.retreat.config.ts.
- Types: vendor /kit/saha.d.ts as `declare module "saha"`. JS authors get the same types through jsconfig checkJs.
- Commit dist/. Her repo publishes dist/ when it has an index.html, which build-previews.mjs writes.

ERRORS THAT EXPLAIN THEMSELVES. Each names the thing, the file and line, and the fix.
- "xr.instruments/things/drums.js: the default export is not a thing. End the file with export default defineItem({ name, setup(ctx) { ... } }). It exports createDrums: to run that older factory as it is, list it with "export": "createDrums"."
- "Hand drums: input.press needs a three.js object and got undefined (things/drums.js:41)."
- "Hand drums: state.set("ctx", ...): an AudioContext is not JSON. Shared values are numbers, strings, booleans, null, arrays and plain objects."
- "Hand drums is an item, so env.set does nothing. Skies, fog and lights belong to whatever surrounds you: an environment, or a space at full size."
- "Rain concert: a reducer called Date.now(). Use m.now; reducers must give every device the same answer."
- "Rain concert: "xr.instruments/drumz": xr.instruments has no thing called drumz on main. It offers: drums, marimba."
- "Hand drums (7f3a2c1 by sill) did not start: SyntaxError at things/drums.js:44:12 (found at deploy). Still showing 5b1e0aa."
- "Rain retreat: a frame callback threw 20 times in a row and is paused: RangeError ... (things/rain.js:88). The rest of the room carries on."

TESTS WITHOUT A HEADSET (phase 3: "saha/test", served as /kit/saha-test.js)
```js
import { simulate } from "saha/test";
import concert from "../things/rain-concert.js";
test("two presses in one second start the concert once", async () => {
  const w = await simulate(concert, { people: 2 });
  w.press("stone", { by: 0 }); w.press("stone", { by: 1, after: 300 });
  w.settle();
  expect(w.model().scene).toBe("concert");
  expect(w.events("stone", "pressed")).toHaveLength(2);
  w.advance(5 * 60_000);
  expect(w.model().scene).toBe("stillness");
  expect(w.problems).toEqual([]);
});
```


# runtime_services

One engine lives in src/engine/. It is plain TypeScript with no React, and it is bundled both into the room app and into /kit/saha.js. Each service has a room adapter (src/space/engine/) and a standalone adapter (src/kit/run-space.ts). Every service is a narrow Host interface of JSON operations and events, so a later sandbox can sit between the engine and the host without changing the contract.

1. THE WORLD, THE FRAME AND THE LIFECYCLE
- A World owns:
  - a root Object3D;
  - the tree of instances;
  - one transport;
  - the services.
- The host calls world.frame(dt, xrFrame) once per rendered frame. These phases run in order:
  1. Apply the entries that arrived, and fire due timers.
  2. Compute tips lazily from the XRFrame.
  3. Run frame callbacks in tree order, a space before its children. Each callback runs inside try/catch with dt capped at 0.1.
  4. Move the audio panners whose objects moved.
  5. Flush streams, at most 15 Hz.
  6. The host renders.
- Pointer events are dispatched as they arrive, inside the browser event, so user activation and audio unlock still work.
- The life of an instance:
  1. Resolve the ref to a pinned URL from the listing (/bff/spaces/:repo/modules).
  2. import() the module and check its brand.
  3. Restore the model from the snapshot, or run initial(props).
  4. Run setup(ctx) on a DETACHED root. It may be async. A shimmer stands at the footprint `size`, and after 10 s the badge says "still starting".
  5. Run renderer.compileAsync(root, camera, scene), so pulling a thing in while in VR causes no shader hitch.
  6. Attach the root in one frame.
- Dispose:
  1. Abort every registration made through ctx: input, frame, watch, onMoment, people, env, panners, assets and captions.
  2. Call the handle's dispose().
  3. Free the root subtree with freeObject (from run-module.ts).
  4. Disconnect the audio bus.
  5. Restore the environment.
- Isolation:
  - A setup that throws shows a badge. If an older version exists, it keeps running.
  - A frame callback that throws 20 times in a row is paused (UPDATE_FAILURES from run-module.ts). The room carries on.
  - Each handler is caught on its own.
  - A reducer that throws is a refusal, the same on every device.
- Room:
  - Phase 1: each ModuleThing drives its instance from useFrame(state, delta, frame).
  - Phase 2: one <EngineLayer> drives the world from useFrame at priority 0.
  - Under frameloop="demand" (reduced motion, Scene.tsx:833), the engine invalidates on every entry, moment and input, and for 1 s after each. Things must not rely on continuous frames when ctx.prefs.reducedMotion is true.
- Standalone: runSpace owns renderer.setAnimationLoop. It calls the kit's update, then world.frame, then renders. This replaces joinSaha's renderer.render wrap in src/kit/index.ts.

2. SHARED VALUES AND ORDERED ACTIONS (the world log)
- Phase 1 transport is what already exists:
  - ctx.state.set goes out as moduleState, and moments as moduleEvent, relayed with the server-stamped sender at socket.ts:607-621.
  - Values are kept in ModuleStates (module-state.ts) and read at start from GET /bff/space/items/:id/state.
  - The only change: the id check at space-wire.ts:546 also accepts child ids "<itemId>/<key>".
  - set applies here at once. watch runs immediately with the current value, then on each change.
- Phase 2 adds one ordered log per world on the server (server/world/). Every w.set and w.act gets:
  - a seq;
  - an `at` in server milliseconds;
  - a `by` taken from the socket's session. It is never a client field, as socket.ts already stamps senders.
  The entry is appended and broadcast to everyone, sender included, and clients apply entries in seq order:
  - $set: last write wins, simply because of the order. The server also materializes values itself, because they are plain data, so late joiners get values from the server and never from a client snapshot. Showing your own write before it is confirmed is trivial: an overlay per key until your cid comes back.
  - act: every client runs the same reducers in the same order and reaches the same state. Actions are applied only after confirmation: your act() resolves when your own entry returns and has been applied, about one round trip (30-120 ms). Immediacy comes from the input itself (the glass is already in your hand); truth comes from the model. Optimistic apply with rebase is a later opt-in per action, not a requirement. This removes the hardest code of the winning proposal.
  - Composition inside one step:
    - m.emit delivers to views once, as entries are applied (never during catch-up), and to the parent's on["<key>:<event>"].
    - m.dispatch runs a child's reducer.
    - Children never know their parent.
  - The deterministic context:
    - m.now is the entry's `at`.
    - m.random is seeded by (world, seq, instance, call).
    - m.by is the stamped sender.
    - m.people comes from the seats.
    - In dev builds, Date.now, performance.now and Math.random throw while a reducer runs, and states are deep-frozen between steps.
  - Seats: a $join entry is written on a person's first socket in the world. A $leave entry is written only after 45 s with no socket of theirs, because the headset socket reconnects about every 30 s (the note in shared/room-items.ts). An explicit leave writes $leave at once: pagehide, the Leave button, or leaveEverywhere. Seats are replaced per page id, as in server/spaces/live.ts, so a reconnect is never a leave and a join.
  - Timers (phase 3): m.after stores {due, action} in the instance's state, so snapshots carry them. Clients report their earliest due time; the server writes a tick entry at that time; and before applying any entry, every client fires the timers due by then, in order, with m.now set to the due time. There is no periodic traffic.
  - Code entries: when spaceDeployed fires (server/index.ts:743), the server appends {k:"code", repo, branch, deploy} to every world holding instances that follow that branch. Each client switches reducers at that seq, running migrate() if the version rose. Later entries wait up to 10 s for the new code to load; a client that still cannot load it resyncs.
  - Reconnects: w.join {since} returns only the missed tail.
  - Persistence: SQLite (server/db), in three tables:
    - world_entries(world, seq, at, by, kind, instance, name, payload_json);
    - world_values(world, instance, key, value_json, by, at);
    - world_models(world, instance, seq, state_json, hash, by).
  - Model snapshots, every 256 actions on an instance:
    - The server asks the sender of the 256th action for its state at that seq.
    - Every other client sends only a hash for the same seq, as a canary. A mismatch means that client resyncs, and the server logs it as a determinism bug.
    - The log before the snapshot is trimmed.
    - This is no less trustworthy than today's moduleState, where any client may write anything.
- Limits:
  - values: 4 KB each, 200 keys and 256 KB per instance (MODULE_STATE_LIMITS);
  - actions: 4 KB; model state: 256 KB per instance.
  - Each socket gets 120 entries a second and 64 KB a second. Clients batch everything into at most one frame per rendered frame; today's limit is 40 separate messages a second (socket.ts:612).
  - A client-side scheduler sends actions first, then values, then moments, then streams, with a share per thing, so one chatty thing cannot starve another.
- Agents: POST /bff/worlds/:id/act acts as the agent's session. GET /bff/worlds/:id returns values, model snapshots and the tail, which an agent can replay in Node with saha/test.
- Standalone: the same WorldService runs behind the space hub (server/spaces/live.ts) as site:<repo>@<branch>. Guests receive everything but host.canAct is false: set() changes only their own copy and a caption says so, as the hub already enforces.

3. MOMENTS AND STREAMS (never logged)
- net.moment:
  - runs the local handlers first (mine: true), then sends;
  - is scoped to the instance id. Sill's marimba today listens for any "marimba" event with no instance id, so two marimbas would play each other's notes.
  - is limited to 1 KB and 30 a second per thing per person;
  - is never kept and never replayed.
- A parent hears its children's moments through ctx.things.<key>.onMoment, its own browser's included.
- net.stream:
  - keeps only the latest value per sender, at most 15 Hz and 256 B;
  - is interpolated on read (vectors and quaternions over 100 ms);
  - is dropped when the sender leaves.
- Room: moduleEvent in phase 1; w.moment and w.stream from phase 2.
- Standalone: the hub's emit, with an instance field, until w.* is routed there in phase 3.

4. TIME
- ctx.time.now() is server milliseconds. The offset comes from the stamps on w.hello and w.pong, filtered by lowest round trip, smoothed, and never moving backwards.
- Anything defined as a function of time looks identical on every device without a single message.
- Mica's sky clock and hourglass read Date.now per device today, so a headset with a skewed clock shows a different night or a different glass.
- In phase 1, Date.now is corrected by the `now` in the room snapshot.

5. INPUT, IN LOCAL COORDINATES, ON EVERY DEVICE
Semantics are as in the types. There is exactly one dispatch path per pointer kind, so nothing fires twice:
- XR in the room:
  - @react-three/xr 6's ray, grab and touch pointers (xr-store.ts:157-160) come from @pmndrs/pointer-events 6.6.30. That library dispatches to plain three.js listeners: event.js getObjectListeners reads object._listeners, and intersections/utils.js hasObjectListeners counts them.
  - The engine adds listeners to registered targets only. Under the default "listener" pointerEvents, objects without listeners are never intersected. So pointing past a 160k-triangle grove costs nothing, no mesh has its raycast disabled, and authors' own Raycasters (Mica's sand garden, the hourglass panel) keep working.
- Desktop in the room, until phase 4:
  - R3F's DOM events only reach objects with JSX handlers, so plain listeners never hear the mouse. The engine's DesktopPointer therefore listens in the capture phase on the canvas's container.
  - It raycasts the registered targets, plus R3F's own interactive objects (useThree internal.interaction) as occluders.
  - When a thing's target is nearest, it calls claimPointer (pointer-claim.ts) and stops the event, so neither a panel behind it nor drag-to-look reacts.
  - Phase 4 moves the room Canvas to pmndrs events (events={noEvents} plus <PointerEvents/>), and DesktopPointer and the legacy usePressRouter retire. The contract does not change.
- Pokes against strikes:
  - press ignores touch-pointer pokes when the target says {poke:false}.
  - strike owns physical contact. It raycasts each tip's path since the last frame against the target and checks the approach speed along the face normal. Strength comes from speed in world metres using Sill's velocityFor curve, so a miniature plays like the real thing. It re-arms after 3 cm, a click or ray counts as 0.7, and duplicates within 250 ms are dropped.
- Tips and hands:
  - They are read from the XRFrame with frame.getPose(gripSpace or joint space, originReferenceSpace), exactly as Immersive.tsx:516-526 reads hands. The pose goes through the XROrigin's matrixWorld and then the inverse of the instance root's matrixWorld.
  - Things never hang three's controllers on the origin, which retires usePressRouter's re-parenting in ModuleItems.tsx.
  - There is one tip per hand: a controller's grip, or a tracked hand's index fingertip. Velocity is a 3-frame average.
- grab:
  - It starts from the pmndrs grab pointer (squeeze or pinch near the object), a ray hold, or a mouse drag that uses shared/grab-move.ts as use-carry.ts does.
  - It claims a hold in holds.ts named item:<rootId>:<childKey>.<name>. The THING regex at holds.ts:37 does not allow "/".
  - It streams the pose at 15 Hz, then either glides home or keeps the rest pose.
  - If start() returns false, or later resolves false, the host lets go.
- drag: the hit point on the target's surface is re-cast every frame, against that target only.
- keys: a thing receives keys only while it has focus (you pressed, grabbed or struck it in the last 30 s, or it surrounds you) and no text field or panel has focus. WASD, the arrows, Space and Escape belong to the room. Sill's drums listen on window for 1-4 today.
- buttons: raw trigger, squeeze, A, B and stick, for the hand holding a grabbed thing or for the surrounding thing (paintball). The room turns off teleport for that hand while they are claimed.
- In a miniature, tips are empty and presses still work.
- Standalone:
  - The same @pmndrs/pointer-events, used vanilla: createRayPointer, createTouchPointer and createGrabPointer for each XRInputSource, driven from the XRFrame, plus forwardHtmlEvents for the mouse.
  - Not @pmndrs/xr's store: it imports three/src paths that the kit's import map does not serve, and it would fight joinSaha's use of WebXRManager.
  - Tips are read the same way, against renderer.xr.getReferenceSpace() and the kit's player rig.

6. HAPTICS
- pulse(hand, strength, ms) finds the XRInputSource by handedness. It prefers gamepad.hapticActuators[0].pulse and falls back to vibrationActuator.playEffect("dual-rumble"), which is Sill's path.
- It does nothing for tracked hands, a mouse or visionOS, and allows at most one pulse per 20 ms per hand.
- Both hosts use the same code.

7. AUDIO
- One AudioContext per page:
  - Room: THREE.AudioContext.getContext(). That is the page-wide context the room's AudioListener uses, which RoomVoices.tsx:76 registers and room-audio.ts unlocks (resumeRoomAudio, unlockRoomAudioFromXR). The room's listener already follows the head (RoomVoices.tsx camera.add(listener)), so the engine never writes the listener in the room.
  - Standalone: the kit adds a THREE.AudioListener to the camera and resumes the context on the first pointerdown or keydown and on sessionstart.
- It is the REAL context, not a Proxy: a Proxy fails brand checks such as new AudioWorkletNode(ctx).
- The engine gives that one instance its own close() that resolves without closing. A thing that calls close(), as Mica's RainAudio.release() does today, can therefore never silence the room's calls. That was the Nikk 5404 bug recorded in RoomVoices.
- out: one GainNode per thing, into a things master, into the destination. The host applies the gear menu's volume and mute, scales it by 0.3 in a miniature, crossfades it over 200 ms across hot swaps, and disconnects it on dispose.
- at(where): a GainNode into an HRTF PannerNode. The panner is moved only on frames where its object moved.
- workletNode(url, processor, options):
  1. Fetch the worklet once per content hash.
  2. Prepend `const registerProcessor = (n, c) => globalThis.registerProcessor(n + "~<hash>", c);`.
  3. Add it from a blob: URL. The room page sends no CSP, so this is allowed.
  4. Construct the node under the hashed name.
  The result:
  - The same content is reused.
  - New content after a push gets a new name, instead of throwing NotSupportedError for re-registering "rain-texture".
  - Two repos with the same processor name cannot collide.
- buffer(url) decodes once per URL. whenUnlocked(fn) runs fn once the context is running and is never awaited inside setup, so a page with no gesture never hangs a thing.

8. MEDIA
- video(url) makes a hidden HTMLVideoElement (playsInline, crossOrigin anonymous), a VideoTexture, and a MediaElementAudioSourceNode routed into out, or into at(screen) when called through sound().
- With follow, it keeps a shared value {playing, at, offset} in step using ctx.time.now(). Drift over 0.3 s is corrected with a seek; smaller drift by nudging playbackRate.
- A movie theatre is an environment, plus a screen item, plus this service. Both hosts are the same.

9. ASSETS
- url(path) resolves against the module's pinned deploy URL /s/<repo>/~<deploy>/..., which is served immutable (routes.ts:385-393). A push therefore swaps code and assets together, and new URL(..., import.meta.url) and vite's ?url and ?worker&url work unchanged.
- texture, gltf, json, bytes and buffer load once per URL per page and are reference-counted per instance. glTF scenes are cloned for each instance.
- The KTX2, Draco and meshopt decoders load once, from /kit/three/addons/.
- canvas(w, h) returns an HTMLCanvasElement now and an OffscreenCanvas under a future sandbox. Mica's bowl-finish.js:88 and the hourglass panels draw this way.

10. ENVIRONMENT CONTROL: SKY, FOG, LIGHTS, PASSTHROUGH
- A world has one surrounding slot. It holds an environment, or a space at full size, in which case the space's `surround` child fills it.
- Only the occupant's env.set calls count (env.writable). Items see writable false and get one explanatory warning.
- The settings are: background, fog, lights, exposure, far, passthrough, ground and transitionMs, plus spawn and player.teleport.
- Leaving the slot restores everything; run-module.ts already restores background and fog.
- Changing environment: the next one compiles invisibly, then the host fades through its fog colour over transitionMs, using a veil sphere on the camera, and swaps.
- Room: settings apply to the R3F scene, camera and renderer.
  - background goes to scene.background. Scene.tsx:850 already drops its <color> while surrounded.
  - fog goes to scene.fog.
  - far goes to camera.far. This replaces FarEnough (Scene.tsx:1092), which forces 2000 while surrounded.
  - lights "own" hides the room's directionalLight (Scene.tsx, just after :851) and SharedDawn.
  - exposure goes to gl.toneMappingExposure.
  - passthrough "visible" sets background null and drops the VoidSphere (Immersive.tsx:1099 already skips it for isFullView). It works in an immersive-ar session, which xr-store.ts requests first.
  - ground sets the teleport floor.
  - The meditation scenery steps aside through the `surrounded` gate (Scene.tsx:654, :966 and on).
- Standalone: settings apply to the page's scene. passthrough "visible" makes the Enter button request immersive-ar.

11. COMPOSITION AND COMMUNICATION
- A space declares its children by ref, with:
  - at, turn and scale;
  - props;
  - `in`: the scenes the child appears in;
  - `surround`: whether the child is the environment.
- Ids are <space>/<key>.
- Model level: a parent can call m.dispatch on a child, and a child's m.emit reaches the parent's on["key:event"], both in the same ordered step.
- View level: ctx.things.<key> gives api (what the child's setup returned), onMoment, onEvent, state, act and root.
  - A handle exists before its child mounts.
  - Its subscriptions survive remounts and reloads.
- The current scene is model.scene when the space has a model with a `scene` field; otherwise it is the shared value "scene", as in phase 1.
- Same-repo refs resolve within the same deploy, so a push replaces the whole module graph at once. Cross-repo refs follow their branch, and each child hot-swaps on its own repo's spaceDeployed.
- Siblings talk through the parent.
- Ports are declared and copied into the manifest, so the Library and agents can compose things without reading their code.

12. LIFECYCLE ACROSS A PUSH (hot reload that keeps state)
1. A push deploys, and spaceDeployed fires (routes.ts:299 and :579, then server/index.ts:743).
2. The room refetches the listing (useModuleSources) and finds a new pinned URL.
3. The engine imports the new module and runs setup on a detached root BESIDE the old instance, with the new bus muted. The old instance keeps running.
4. compileAsync runs.
5. The roots swap in one frame, the buses crossfade over 200 ms, and the old instance is disposed with reason "reload".
6. The old version's save() becomes the new version's ctx.hot.data.
Other effects:
- Shared values and models live on the server and are untouched.
- Model reducers switch at the code entry's seq (phase 2).
- If the new code fails to import or throws in setup, the old version stays, and the badge reads "7f3a2c1 by sill: TypeError ... still showing 5b1e0aa". (Today ModuleItems.tsx disposes the old version before the new one starts.)
- A browser's import() SyntaxError carries no line, so the deploy step parses every published .js (acorn, or node --check) and puts the file and line on the Library card and the badge.
- In vite dev, import.meta.hot triggers the same swap.

13. MODES: ITEM, FULL SIZE, MINIATURE
- item: placed and carried by the host (use-carry.ts, ThingControls), like the Go table.
- full: fills the surrounding slot at 1:1. In a workroom its spawn point is offered ("Go to start" in the gear menu), not forced. On arrival in a finished room or a site it is applied.
- model: a space as a miniature on a plinth (MODULE_SCALE.model 0.05, MODEL_HEIGHT 0.8).
  - The environment is not applied to the room.
  - Audio is scaled by 0.3.
  - Tips are empty, because a life-size hand would smash a 1:20 drum. Presses still work.
  - ctx.viewer is a movable "you are here" pin, so things that reveal as you approach (Mica's rain and sky) preview correctly.
  - Phase 3 clips the model with a stencil box. Material stencil state works with custom ShaderMaterials, where clipping planes need shader chunks. It needs gl stencil: true at Scene.tsx:840, which XR layers inherit.
- A mode change re-runs setup with hot data; the model and shared values are untouched.
- The same instance as a model and at full size at once (phase 4): the second view is a mirror. It gets no input, tips or keys; it sends no moments or actions; it is muted; and it receives everything for its visuals.

14. PEOPLE AND PRESENCE
- ctx.people gives me, all(), join and leave events, head and hands in local coordinates, and whether each person is talking.
- attach() lets the surrounding thing hang an object on a person: a team mark, a held tool.
- Room: people come from connection.peopleRef (WirePerson). Avatars, voice, Whisper and Kokoro remain the room's.
- Standalone: people come from the hub (KitPerson), drawn by figures.ts, with voice from voice.ts.
- Reducers see seats only, through m.people.

15. PERFORMANCE ON A QUEST
- Things declare a budget. The engine measures each thing's frame time as a moving average and counts draws and triangles once a second.
- A HUD in the gear menu compares them with a world budget of 150 draw calls. Near.tsx records 276 with thirty pieces.
- relevance generalises Near: beyond its radius a thing is hidden or put to sleep, and moments and audio continue if it is marked audible. Over budget, far things are hidden largest-first; the surroundings never are.
- Also: compileAsync before showing, shared loaders, one AudioContext, and no allocation per frame inside the engine.

16. WORKING FROM INSIDE
- Each thing has a badge: repo/thing@commit, who pushed it, frame ms, and problems.
- The gear menu holds:
  - props, filtered by who may change them;
  - the thing's buttons and views ("Go to");
  - volume and mute;
  - follow a branch, or stay on this deploy;
  - reset the model (builders only);
  - reload.
- Problems are also POSTed to /bff/spaces/:repo/problems (once per deploy), so an agent can curl them after a push.
- Dev builds warn when a thing uses window listeners, document or the renderer.
- A deploy-time lint shows on the Library card. It flags:
  - top-level side effects;
  - new AudioContext;
  - setAnimationLoop;
  - context.destination;
  - document.createElement;
  - onBeforeRender.

17. THE SANDBOX SEAM (designed for, not built)
- Why not a worker: 42441f0 built a worker that described scenes, and b1467a7 removed it, because plain three.js (ShaderMaterials, instancing, worklets) cannot be described cheaply. The sandbox will therefore share the page's realm.
- It will be one Hardened JS (SES) Compartment per repo:
  - Its globals are harmless intrinsics only.
  - It may import three, with loaders swapped for ctx.assets-backed ones so that no fetch reaches /bff with cookies; three/addons; saha; and its own deploy.
  - ctx is its only capability.
  - ctx.root becomes a membrane: parent is null above it.
- Code that follows R1-R7 runs unchanged.
- What breaks: globals; walking above root; and onBeforeRender's renderer argument. Mica's sky reads getDrawingBufferSize, the one known case, and moves to a ctx value before then.
- Official and finalized (pinned, reviewed) things can also have their reducers replayed on the server in an isolate, which gives authoritative snapshots and hidden information.


# hosts

The same module file runs in all of these. Only the adapter around it changes.

(A) THE saha.ing ROOM, FOR WORKROOMS AND LIVE DEVELOPMENT (React Three Fiber plus @react-three/xr 6)
- Mounting:
  - Phase 1: inside ModuleThing in src/space/modules/ModuleItems.tsx. After import(), a branded default export runs as a ThingInstance; anything else runs through runModule, the legacy path.
  - Phase 2: <EngineLayer> (src/space/engine/EngineLayer.tsx) replaces <ModuleItems> at Scene.tsx:928. It creates one World, room:<roomKey>, in which every ModuleRoomItem (shared/room-items.ts:83-97) is a root instance.
- Chrome around each placed instance is kept from 808d9ab:
  - the MOVE handle and carry (use-carry.ts, grab-hold.ts), like the Go table;
  - ThingControls: smaller, bigger, turn, full size, take away;
  - the plinth for a miniature;
  - the problem caption.
  To these it adds props, buttons, views, volume and follow-branch.
- The Library, opened from Settings: use-library.ts, LibrarySection.tsx, and the headset Library tab (settings-menu-model.ts:30, :340-364).
  - The room's own project repos come first, then public ones (GET /bff/spaces/library).
  - Entries are grouped: Spaces ("Around us" or "As a model"), Environments ("Around us"), Items ("Bring here").
  - Each repo has a branch picker.
  - Choosing one shows it live in the room you are in, never as a separate page.
- In a workroom:
  - Members bring things in, move them and take them away. describeModule checks membership or a public flag (routes.ts:772).
  - Every push to the followed branch swaps the thing in place for everyone standing there.
  - Work panels are room chrome, not things, so they stay available.

(B) ITS OWN WEBSITE, WITH AVATARS AND NETWORKING
- /kit/saha.js gains runSpace(options), built from src/engine plus src/kit by vite.kit.config.ts, with three kept external.
- If a deploy has no index.html and saha.json names a "site", serveSite generates this page:
```html
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="importmap">{ "imports": { "three": "/kit/three/three.module.js", "three/addons/": "/kit/three/addons/", "saha": "/kit/saha-sdk.js" } }</script>
<script type="module">import { runSpace } from "/kit/saha.js"; runSpace({ thing: "./things/rain-concert.js" });</script>
```
- What runSpace does:
  - creates the renderer (XR enabled, with a stencil buffer), the scene, the camera and the rig;
  - calls joinSaha({ scene, camera, renderer, player }), which brings figures for everyone (figures.ts), movement (movement.ts: sticks, snap turn, palm joystick, WASD with drag-to-look), voice (voice.ts), the wrist menu (menu.ts, which also lists the thing's buttons and "everyone" props), doors and the badge;
  - runs the World site:<repo>@<branch> over the hub socket, which keeps tickets in the #fragment, guests who watch, seats replaced per page, and the heartbeat;
  - sets up input through vanilla @pmndrs/pointer-events pointers;
  - applies the environment to the page's scene and honours the spawn point;
  - owns setAnimationLoop.
- Sites are CSP-sandboxed (SITE_SANDBOX, routes.ts:53): they have an opaque origin and no cookies. Refs are therefore resolved through:
  - /bff/spaces/:repo/modules?ticket=..., because the kit already appends its ticket to /bff requests;
  - or GET /kit/resolve?ref=... for public repos, with CORS * and no cookies.
  Guests see public things only.
- Authors who want control write index.html themselves and call runSpace with options: voice:false, extra buttons, a start view.
- Branch previews (/s/<repo>/@<branch>/) and "Enter as yourself" (/go/<repo>) work as they do today.
- A conformance script plays one scripted input sequence against both the room host and this host.
- Later, a public room and its website can share one world, so visitors on either see each other.

(C) A FINISHED saha.ing ROOM, WITH CONTROLS BLOCKED
- "Make a room from this" on a space's Library card (owners only) calls POST /bff/rooms/:room/finalize {ref}. The server:
  - resolves the space and, recursively, every ref it uses to a deploy id, and writes a lockfile;
  - pins those deploys, so that store.toRetire (store.ts:130, which keeps 10 per branch) skips them;
  - writes onto the room record template {ref: "meditation.ar/rain-concert~<deploy>", lock} and policy {edit: "owners", panels: false, library: false, carry: false, builderControls: false}.
  The room's hello message carries both.
- On the client:
  - The template space runs at full size as the room's base, with the room scenery off, and its spawn point applies on arrival.
  - Hidden: work panels (Scene.tsx openPanels is empty), the Library, carry handles, gear editing, builder props and buttons, follow-branch, and the dev badge.
  - Kept: avatars, voice, Whisper and Kokoro, movement, comfort settings, the wrist menu's leave and microphone, volume, "everyone" props and buttons, and every thing's own interactions (the drums, the stone, the hourglass), which are the experience.
- The server enforces the policy:
  - Module item POST, PATCH and DELETE are for owners only, and so are w.sys operations.
  - Panel routes refuse visitors.
  - w.set and w.act are open to everyone.
- A finished room never follows pushes. Changing it means finalizing again.
- Making it public uses the existing public listing and lobby doors (/bff/spaces/public).

(D) AN OFFICIAL saha.ing ITEM
- Official things live in the first-party repo saha.official, with the same git, deploys and contract as any other repo.
  - The Library shows its "saha.ing" shelf first.
  - Its things appear in every room's Add menu, not only in workrooms.
- Core official things are also bundled into the app:
  - src/things/official/registry.ts maps "saha:go" to () => import("./go/index.ts"). It is the same file, compiled into the room, so it needs no network.
  - Sites get the same file at /kit/things/<name>.js.
- Promotion: either pin a reviewed deploy of a team's thing (for example "saha:hourglass" pointing at meditation.ar/hourglass~<deploy>), or copy the code into saha.official.
- Rebuilding the room's own pieces:
  - Scene.tsx mounts about 45 hard-coded pieces (:966-1047). Many have their own server module in server/space/: bowl.ts, fire.ts, lantern.ts, garden.ts, cairn.ts, hourglass.ts and others.
  - They are ported one at a time. Each port deletes its server module and its wire types, because models and shared values replace them.
  - The meditation room becomes saha.official/meditation-room: a space whose script runs the dawn, the bell and the orb. Near becomes relevance.
  - Contract Example 5 sketches the Go table.
  - As a stopgap, a room-only adapter (not part of the public contract) lets an existing R3F component act as an official thing's view, so state can move into the model before the drawing is rewritten.

(E) DEVELOPMENT AND TESTS
- `saha dev` (vite plus @saha/vite, phase 3) serves a local studio:
  - the same runSpace host, importing /kit/saha.js;
  - an in-page LocalSequencer, so it works alone and offline;
  - HMR calling the same swap a push uses;
  - ?hub=<repo>@<branch> to join a real branch preview for multiplayer.
- saha/test simulate() runs a thing in Node: a scene graph with no WebGL, N fake people, synthetic presses and tips, and a clock you advance.
- The room harness (tools/dev-room-harness.mts, plus tools/dev-demo-things.mts rewritten to the contract) and IWER cover the real browser path.

PACKAGING AND BUILD
- Plain JS (Sill, agents): write things/*.js, list them in saha.json (or in saha-pieces.json during migration), and push. There is no build.
- TypeScript and vite (Mica):
  - Phase 1: vite.things.config.ts (in the contract): app mode, JS entries, preserveEntrySignatures "exports-only", "three" and "saha" external, base "./". Commit dist/.
  - Phase 3: the @saha/vite plugin does the same, writes saha.json, maps errors through sourcemaps, and in dev keeps three and saha external through the import map.
- The server never builds anything: a push deploys files.
- saha.json declares "three": "0.186". The room warns when a thing was built against a different three.js.


# server_mapping

All paths below are in the nightjar worktree: branch nightjar-request-trust, HEAD 808d9ab on top of b1467a7, plus 7 uncommitted edits. main in the qa worktree has none of this yet. The rule: the server keeps doing what it already does well (git, deploys, identity, sockets) and learns one new job, putting actions in order. It never runs authors' code.

KEEP, AS BUILT
- Git and deploys:
  - git hosting (server/spaces/git.ts);
  - deployCommit, DeployQueue and keepPerBranch retention (deploy.ts, shared/spaces.ts:105);
  - SpaceStore (store.ts, node:sqlite);
  - backups and the code browser.
- Pinned deploys: /s/<repo>/~<deploy>/..., served immutable (routes.ts:385-393), and moduleUrl() (shared/space-bench.ts). These are the only URLs things are imported from. They are why a push swaps a whole module graph, and why a finished room stays fixed.
- Branch previews /s/<repo>/@<branch>/, /go/:repo, tickets.ts, auth.ts and mayUse.
- The Library: /bff/spaces/library and /bff/spaces/:space/modules (routes.ts:791-823), modulesOf (:762), and describeModule (:772), which remains the permission check for bringing a thing in.
- spaceDeployed: deployFor (routes.ts:299, :579) broadcasts through server/index.ts:743. It drives hot reload, and from phase 2 it also writes code entries.
- One three.js:
  - /kit/three-bridge.js (server/spaces/three-bridge.ts, served at routes.ts:877);
  - /kit/three/* (:881);
  - the room's import map (index.html:23);
  - globalThis.__SAHA_THREE__ (src/main.tsx:16).
- The room item of kind "module":
  - ModuleRoomItem, parseModuleItem, MODULE_SCALE and isFullView (shared/room-items.ts:80-137);
  - POST, PATCH and DELETE /bff/space/items and addModule (server/space/items.ts:84-151).
  It is the structure record of a root instance (source, role, view, position, scale, addedBy). It stays the structure API.
- Carrying and holds: use-carry.ts, grab-hold.ts and holds.ts (8 s lease, renewed every 3 s).
- The room socket's session stamping and per-socket rate limit (server/space/socket.ts:607-621).
- The space hub (server/spaces/live.ts): tickets, read-only guests, seats replaced per page, the 30 s heartbeat, leaveEverywhere, and state kept in the database.
- The kit (src/kit: connect, movement, figures, voice, menu, door, screen) and vite.kit.config.ts.
- Room UI from 808d9ab: LibrarySection.tsx, use-library.ts, the Library tab in settings-menu-model.ts, and ThingControls.

CHANGE, PHASE 1 (small)
- shared/space-wire.ts:546: the module item id check widens from ^[A-Za-z0-9-]{1,64}$ to also accept up to three child segments, ^[A-Za-z0-9-]{1,64}(\/[a-z0-9][a-z0-9_-]{0,31}){0,3}$. Composed children then carry their own values and moments. The 4 KB value limit and MODULE_KEY (:497-498) are unchanged.
- server/space/module-state.ts: forget(room, item) also drops "item/..." children. The limits stay at 200 keys and 256 KB per instance.
- index.html:23: the import map gains "saha": "/kit/saha-sdk.js".
- server/spaces/routes.ts: GET /kit/saha-sdk.js is served beside /kit/three-bridge.js, with the same headers.
- src/space/modules/run-module.ts: kept only as the legacy adapter. freeObject, the update-failure counter, and the background and fog restore move into src/engine/instance.ts.

CHANGE, PHASE 2 (the world log)
- moduleEvent and moduleState are replaced by the world wire. This touches:
  - shared/space-wire.ts:318-321, :441-444 and :544-560;
  - socket.ts:607-621;
  - src/space/useSpaceSocket.ts:388.
  The per-socket limit becomes 120 batched entries a second and 64 KB a second, in place of 40 messages a second (socket.ts:612).
- ModuleStates (in memory, last write wins) is replaced by WorldStore (SQLite). GET /bff/space/items/:id/state is replaced by w.join. Room items stay the structure API: the item routes also append a sys entry (spawn, despawn, transform or props) to the room's world, so structure and actions share one order and $props reducers stay deterministic.
- ModuleRoomItem gains props (PATCH /bff/space/items/:id {props}), and parseModuleItem validates them as JSON of 4 KB at most.
- Go table rows (GoRoomItem) stay as they are until phase 4.

CHANGE, PHASE 3 AND LATER
- shared/space-bench.ts readPieces also reads saha.json { saha: 1, three, things: [{ id, kind, name, entry, size?, props?, ports?, budget?, uses? }], site? }. saha-pieces.json keeps working, including the "export" key for legacy factories.
- The deploy step parses every published .js file (acorn) and records the file, line and message of any syntax error among the deploy's problems.
- server/spaces/live.ts:
  - routes w.* to the WorldService as site:<repo>@<branch>;
  - keeps t:"set" and t:"emit" for older pages;
  - gains an `inst` field and a budget per instance, because KIT_LIMITS allows 200 keys and 64-character keys per space (shared/space-kit.ts).
- serveSite generates the host page when saha.json names a site and there is no index.html.
- /bff/spaces/:space/modules accepts ?ticket=, and GET /kit/resolve answers for public repos, for sandboxed sites.
- vite.kit.config.ts builds the engine and the standalone host into saha.js.
- Room records gain template and policy (phase 4). Panel and placement routes consult the policy. store.toRetire (store.ts:130) skips pinned deploys.

NEW
- Phase 1: server/spaces/saha-sdk.ts, which exports sahaSdkSource(): a small ES module string with defineItem, defineEnvironment, defineSpace and isThing, branded with Symbol.for("saha.thing"). It is the same pattern as three-bridge.ts, so the room needs no second library build.
- Phase 2:
  - shared/world-wire.ts. Every message carries `world`.
    - Client to server: w.join {since}, w.set {i, k, v, cid}, w.act {i, a, p, cid}, w.moment {i, n, d}, w.stream {i, n, v}, w.snap {i, seq, state?, hash}, w.ping, w.batch [...].
    - Server to client: w.hello {seq, now, values, models, entries}, w.e {seq, at, by, cid?, k: set | act | sys | join | leave | code | tick, i?, ...}, w.refused {cid, why} (rate, size or policy), w.moment / w.stream {..., from, at}, w.pong {now}, w.resync.
  - server/world/sequencer.ts: seq, at and by; append and broadcast; ticks for timers; snapshot requests and hash canaries.
  - server/world/seats.ts: $join and $leave, with the 45 s grace period and replacement per page.
  - server/world/store.ts: the world_entries, world_values and world_models tables, through a migration in server/db/schema.ts.
  - server/world/routes.ts: GET /bff/worlds/:id, and POST /bff/worlds/:id/act for agents.
  - POST and GET /bff/spaces/:space/problems.
- Phase 3:
  - /kit/saha.d.ts, /kit/saha-test.js and /kit/saha-vite.mjs;
  - GET /kit/resolve;
  - the generated site page.
- Phase 4:
  - POST /bff/rooms/:room/finalize, writing the lockfile, the pins and the policy;
  - a pins table read by toRetire;
  - the saha.official repo and src/things/official/registry.ts.

RETIRED ONCE PORTED
- run-module.ts's ad-hoc `saha` object (onPress, onFrame, world).
- usePressRouter's raycast and controller re-parenting in ModuleItems.tsx.
- module-room.ts, except as the kit-shaped facade for legacy factories.
- Every bespoke server/space/*.ts module and its wire types, as its piece becomes an official thing.


# migration

SILL'S HAND DRUMS (xr.instruments): pieces/drums.js becomes things/drums.js (contract Example 1), about an hour.
- drums-math.js and test/drums-math.test.mjs are unchanged.
- How today's plumbing maps onto ctx:

| today | becomes |
|---|---|
| a module-level `let audio`, plus pointerdown/keydown unlock listeners added at import | ctx.audio (the host unlocks it) |
| a new PannerNode per hit, and listener writes per hit | audio.at(skin), once per drum (the room's AudioListener already moves) |
| capture-phase pointerdown, a Raycaster, and stopImmediatePropagation against the kit's look-drag | input.press(skin, fn, { poke: false }) (the host claims the pointer) |
| window keydown for 1-4 | input.keys("1234"), only while the drums have focus |
| getControllerGrip and getHand(...).joints["index-finger-tip"], visible checks, group.worldToLocal | input.tips (local, after locomotion, one per hand) |
| connected/disconnected bookkeeping plus vibrationActuator.playEffect | haptics.pulse(tip.hand, ...) |
| room.emit("drums", { i: id, ... }) with a hand-made id filter, and the play(..., mine) split | net.moment("hit") and net.onMoment (scoped per instance, local echo) |
| a disposables list | automatic |

- New: a tuning prop, and api.hit so a space can play the drums.
- saha-pieces.json gains {"id":"drums-thing","name":"Hand drums","item":"things/drums.js"}. Today drums is listed only as "code".
- createDrums stays exported from pieces/drums.js for existing pages, and drums.html keeps working.
- Later, drums.html becomes a five-line runSpace page, or the generated site.

SILL'S MARIMBA, the same way (about an hour)
- The bars become input.strike targets. Mallets, fingertips, triggers and clicks all play them, and the ray "select" listener and the mouse raycast go away.
- The keyboard row uses input.keys. Each bar's sound goes through audio.at(bar).
- Its two bugs are fixed:
  - Its "marimba" event has no instance id, so two marimbas would play each other's notes.
  - It never removes its pointerdown and select listeners, because it has no dispose.
- The `local.y < 0.915` threshold works unchanged in local coordinates.

MICA'S RAIN (meditation.ar, in a "things" branch agreed with Mica; it carries Sill's rain stone)
- The exact source changes:
  1. src/space/rain-audio.ts:
     - The options gain `context?`, `destination?` and `makeNode?(name, options)`.
     - When they are given, start() uses that context and makeNode instead of `new AudioContext()` and audioWorklet.addModule, and connects to `destination` instead of ctx.destination.
     - release() only disconnects. It never closes a context it was given.
     - The document visibilitychange listener and the document.hidden check go away; the thing handles that with ctx.on("sleep"/"wake").
     - About 15 lines change, and shared/rain-audio.ts and its tests are untouched.
  2. src/space/rain-retreat-view.ts: `private readonly sound = new RainAudio()` becomes a field set in the constructor from `options.sound`, and the constructor takes `StoneOptions & { sound?: RainAudioOptions }`. That is 2 lines. The view keeps driving its own sound through update(), so the thing does NOT make a second RainAudio.
  3. New: src/things/rain.ts (contract Example 3).
  4. New: vite.things.config.ts (in the contract). Then commit dist/things/rain.js and its worklet asset.
  5. A saha-pieces.json entry at the top of the repo: {"id":"rain","name":"Rain retreat","environment":"things/rain.js"}.
- Unchanged: RainRetreatView's shaders, rain-stone.ts, shared/rain-retreat.ts, the worklet, and all the vitest tests.
- Not needed inside the thing, though the review pages keep using them: preview-room.ts (renderer, VRButton, WASD and drag-look, snap turn, rig, XR hooks) and rain-preview.ts's joinSaha and loop.
- Moved:
  - The "Listen to the rain" button becomes ctx.audio.whenUnlocked, plus the gear menu's mute.
  - #status becomes ctx.caption.
  - ?review=rain|seat|stone becomes `views`.
  - The reveal by distance becomes retreatLevel(ctx.viewer.distance), which also works in a miniature.
- New: a `fade` action (a function of server time) and a `flash` api, so a space can drive the rain.
- Note: the rain "amount" is the view's reveal, its fade or opacity. It is not drop density.

MICA'S SKY (src/things/sky.ts)
- `await loadSkyCatalogue()` moves from sky-preview.ts's top level into an async setup. The hyg-bright.bin `?url` asset resolves inside the pinned deploy.
- Time comes from server time: `new EarthSkyClock(catalogue, reference, live, ctx.time.now())` and `clock.advance(ctx.time.now())`. Both parameters already exist, so every device shows the same instant of the same night.
- clock.view.update(eye, ...) takes ctx.viewer.position, which is local.
- sky-choice.ts's DOM select becomes a `night` choice prop (shared/sky-nights.ts keys plus "live"). It is shared and kept, so a group watches the same historic night together, and on("props") calls clock.select().
- The meteor and bolide buttons become `buttons` that send net.moment("meteor", { kind, dir }), so everyone sees the same streak.
- The camp ground texture loads through ctx.assets.texture. skyProximity and campVisibility use ctx.viewer.distance.
- env: { background: "#010205", lights: "own", far: 150 }. The backdrop sphere sits at 81 m (RADIUS 80 + 1). The room camera's far is 60 m except while surrounded (FarEnough), so an explicit far is required.
- In a miniature:
  - The dome follows the "you are here" pin (earth-sky-view.ts:208 copies the eye), so at 0.05 scale it is a 4 m dome around the pin.
  - Phase 1-2: hide the backdrop and the meteors when ctx.mode is "model".
  - Phase 3: the stencil box clips the dome into a diorama.
- Known item for the future sandbox: points.onBeforeRender reads renderer.getDrawingBufferSize. It works in the page today. It should move to ctx.prefs.pixelRatio plus the camera's projection before the sandbox lands.

MICA'S OTHER PIECES
- hourglass: contract Example 2. The model replaces room.set last-writer-wins, the 15 s renewing lease and Date.now. A stream replaces the "hourglass-carry" moments. input.grab replaces the hand-written pinch, controller and desktop grab code. The minutes prop replaces the `<dialog>` and the canvas panel. createHourglassForm takes { canvas, pixelRatio } in place of the renderer, which it uses only as a cache key and for getPixelRatio.
- singing bowl: input.tips for rubbing the rim, input.strike to strike it, and audio.at(bowl) for its sound. bowlReflection draws through ctx.assets.canvas.
- sand garden: the rake uses input.drag (local hit points). Rocks use input.grab with kept rest poses. Strokes become capped `act`s, or each author's own shared value. The "garden-carry" moments and "hold:" keys disappear, and so do the prefix + "rock:" + i keys, because state is per instance.
- sakura and fireflies: environments like rain. Fireflies use passthrough "visible" in AR.
- Baiwei and Mica's multi-scene journey becomes one space with scenes (Example 4's shape): rain, sky and fireflies as surround children, each `in` its scene.

THE DEV DEMO THINGS (tools/dev-demo-things.mts)
- The orb, dusk and demo space are rewritten with defineItem, defineEnvironment and defineSpace.
- The harness then exercises the contract offline, without WebHarness.

LATER: THE GO TABLE (phase 4)
- It becomes the official thing saha:go (contract Example 5).
- Its rules are shared/go-rules.ts (placeGoStone), go-score.ts (countGo) and go-clock.ts (settleTurn with m.now), unchanged, inside reducers.
- Seats are kept by person id and freed on $leave.
- The view (RoomItems.tsx GoTable, about 1,180 lines of R3F) is rewritten in three.js from go-textures.ts, go-rock-geometry.ts and go-snap.ts, or it runs first through the room-only R3F adapter.
- GoTableSettings.ts becomes props.
- Data: a one-off converter turns each stored GoRoomItem into a module item {source: saha.official/go}, with a model snapshot built from its fields (size, colours, stones, captures, ko, passes, clock). It runs as a dry run first. The Go routes in server/space/items.ts stay readable for a week, then retire.
- Agents play through POST /bff/worlds/:id/act.

LATER: THE REST OF THE ROOM
- Each meditation piece becomes an official thing, one at a time, and each port deletes its server/space module and wire types.
- The meditation room and the lobby become template spaces in saha.official.


# build_plan

PHASE 0 (under 1 hour)
- On nightjar-request-trust, commit the 7 uncommitted edits plus tools/dev-demo-things.mts. They are:
  - server/space/items.ts;
  - server/spaces/routes.ts;
  - shared/room-items.ts;
  - src/space/modules/ModuleItems.tsx;
  - src/space/modules/run-module.ts;
  - src/space/modules/use-library.ts;
  - tools/dev-room-harness.mts.
- Run vitest with --maxWorkers=2 and confirm it is green.

PHASE 1 (about one long day): "DRUMS AND RAIN ON THE CONTRACT, LIVE IN THE WORKROOM"
Scope:
- the contract, and the in-page engine for single things and one level of spaces;
- running on the EXISTING transport (moduleState, moduleEvent, ModuleStates);
- no sequencer, no models, no streams, no grab, no standalone site.
Code written against the contract never changes when the transport moves to the log in phase 2.

Files in /Users/fxg/Desktop/Python Stuff/My Projects/NEW EXPIRIMENTING/fxg-agent-crew-nightjar:
1. NEW server/spaces/saha-sdk.ts (about 40 lines). sahaSdkSource() returns defineItem, defineEnvironment and defineSpace (each adds the Symbol.for("saha.thing") brand, the kind, and light validation with explanatory errors) and isThing.
2. EDIT server/spaces/routes.ts: add app.get("/kit/saha-sdk.js") next to /kit/three-bridge.js (:877), with the same headers.
3. EDIT index.html:23: add "saha": "/kit/saha-sdk.js" to the import map.
4. EDIT shared/space-wire.ts:546: accept child ids, using the regex given in the server mapping. Add a test in shared/space-wire.test.ts.
5. EDIT server/space/module-state.ts: forget() also removes children. Add a test.
6. NEW src/engine/types.ts: the saha.d.ts types, also copied to public/kit/saha.d.ts.
7. NEW src/engine/host.ts: the Host interface. It provides:
   - a transport (values, moments, people, now);
   - scene, camera and renderer;
   - an env applier;
   - resolve(ref);
   - a problem sink.
8. NEW src/engine/instance.ts. ThingInstance:
   - load and brand check;
   - setup on a detached root, with the "still starting" note;
   - compileAsync, then attach;
   - frame callbacks with the 20-failure pause;
   - swap(url), which keeps the old instance if the new one fails, carries save() into hot.data, and crossfades the bus;
   - dispose: freeObject, env restore and unregistering, moved from run-module.ts.
9. NEW src/engine/context.ts: builds ctx. In phase 1 that covers:
   - frame;
   - state get/set/watch, with watch firing immediately;
   - net.moment with local echo, and onMoment;
   - props (defaults plus a space's child props);
   - hot, caption, log and problem;
   - viewer and toLocal;
   - time (Date.now plus the snapshot offset);
   - env.set (background, fog, far);
   - assets.url and assets.texture.
   A thing that declares a model gets a clear "models arrive in phase 2" problem.
10. NEW src/engine/audio.ts:
    - THREE.AudioContext.getContext() with the close guard;
    - the things master and each thing's bus;
    - at() panners, moved only when their object moves;
    - workletNode with hashed processor names;
    - whenUnlocked.
11. NEW src/engine/input.ts:
    - the target registry;
    - XR press through pmndrs plain listeners, honouring { poke: false };
    - DesktopPointer: a capture listener on the canvas container that raycasts targets plus internal.interaction occluders, calls claimPointer and stops the event;
    - keys with focus;
    - tips from the XRFrame (originReferenceSpace, then the XROrigin matrixWorld, then the inverse of the root's matrixWorld).
12. NEW src/engine/space.ts:
    - children from refs: same deploy, or other repos through bff.spaceModules, with a spaceDeployed subscription so each child swaps on its own;
    - child ids <id>/<key>;
    - transforms and props;
    - scenes driven by the shared value "scene";
    - ChildHandle (api, onMoment, state);
    - the space's setup runs after its children mount.
13. NEW src/engine/engine.test.ts (vitest, with a fake host). It checks:
    - setup runs on a detached root and attaches only on success;
    - a failed swap keeps the old version;
    - hot.data carries over;
    - watch runs at once;
    - a moment plays locally first, exactly once;
    - dispose frees geometry and materials and restores the env;
    - worklet names hash and reuse;
    - tips convert to local coordinates under a rotated, scaled root;
    - press with poke:false ignores the touch pointer.
14. NEW src/space/engine/room-host.ts: the room's Host.
    - The transport is moduleRoom (module-room.ts) for any instance id.
    - The env applier works on the R3F scene and camera.far; FarEnough's 2000 stays the default for surroundings.
    - resolve uses bff.spaceModules.
    - people.me comes from `you`.
15. EDIT src/space/modules/ModuleItems.tsx:
    - ModuleThing: import the module; a branded export becomes a ThingInstance, anything else runs through runModule.
    - useFrame(state, delta, frame) calls instance.frame.
    - A new URL triggers a swap instead of dispose-first.
    - Mount useThingInput once in ModuleItems.
    - Keep usePressRouter only while a legacy instance is running.
16. EDIT src/space/modules/module-room.ts: an option for local echo of moments (engine instances only; the legacy facade keeps today's behaviour).
17. EDIT tools/dev-demo-things.mts: rewrite the demo orb, dusk and space to the contract.

Content, pushed as branches so main is untouched:
18. xr.instruments@things:
    - things/drums.js (contract Example 1);
    - in saha-pieces.json, {"id":"drums-thing","name":"Hand drums","item":"things/drums.js"}.
19. meditation.ar@things (with Mica):
    - the rain-audio.ts and rain-retreat-view.ts edits;
    - src/things/rain.ts, in its phase 1 form: no model; `api.fade(to, over)` is local, computed from ctx.time.now();
    - vite.things.config.ts, and the built dist/things/;
    - things/begin-stone.js, phase 1 form: the press sends net.moment("pressed");
    - things/rain-concert.js, phase 1 form (below);
    - saha-pieces.json entries for rain (environment), begin-stone (item) and rain-concert (space).
    The phase 1 rain-concert:
```js
import { defineSpace } from "saha";
export default defineSpace({
  name: "Rain concert",
  scenes: { list: ["arrival", "concert"], initial: "arrival" },          // phase 1: the scene is the shared value "scene"
  things: {
    rain:  { ref: "rain", surround: true },
    stone: { ref: "begin-stone", at: [0, 0, 1.2], in: ["arrival"] },
    drums: { ref: "xr.instruments/drums-thing@things", at: [0, 0, -1.3], in: ["concert"] },
  },
  setup(ctx) {
    ctx.things.stone.onMoment("pressed", (_, info) => { if (info.mine) ctx.state.set("scene", "concert"); });   // reported once, by the presser
    ctx.state.watch("scene", (scene) => ctx.things.rain.api.fade?.(scene === "concert" ? 0.6 : 1, 3000));
    ctx.things.drums.onMoment("hit", ({ v }) => ctx.things.rain.api.flash?.(v * 0.6));
  },
});
```

Hours:

| hours | work |
|---|---|
| 0 to 1 | files 1-5 and their tests |
| 1 to 4.5 | files 6-11 and 13 |
| 4.5 to 6 | files 12, 14-17 |
| 6 to 7.5 | the ports and pushes (18-19) |
| 7.5 to 9 | two people through the room harness (curl as person B; restart the harness after every build), a Quest check, the push checks, fixes |

If it slips, file 12 and the concert space move to the next morning. The drums and the rain alone still prove the contract.

Phase 1 is done when:
1. Library, then xr.instruments@things, then "Hand drums" stands in front of you.
   - A click plays a drum and makes its skin glow.
   - Tab B hears the hit from where the drums stand.
   - In a Quest, controller and fingertip strikes play with a buzz, and there is no double hit from a poke.
   - Keys 1-4 work only after you have touched the drums.
2. "Rain retreat", Around us:
   - The room's scenery leaves and the rain reveals as you approach.
   - Sound starts after the first gesture or on entering VR.
   - Taking it away restores the room exactly.
3. "Rain concert", Around us:
   - Pressing the stone in tab A moves both tabs to the concert: the drums appear and the rain fades in.
   - Drum hits flash the sky in both tabs.
   - Reloading tab B lands it in the concert.
4. Pushing a new drum colour swaps the drums in both tabs within seconds, with tuning and scene unchanged. Pushing a syntax error leaves the old drums playing, and the badge names the commit and the error.
5. The rain's sound survives a push of the rain (the hashed worklet name).
6. vitest is green with --maxWorkers=2. The draw calls logged in the headset stay at or under 150.

PHASE 2 (about 4 days): THE WORLD LOG, MODELS AND COMPLETE INPUT
- New files:
  - shared/world-wire.ts;
  - server/world/sequencer.ts, seats.ts (45 s grace, replacement per page), store.ts (SQLite migration in server/db/schema.ts) and routes.ts;
  - src/engine/log.ts: apply in order, the $set overlay, confirmed-only reducers, ModelCtx, the dev traps, code entries, snapshots and hash canaries;
  - src/engine/time.ts.
- Changes:
  - socket.ts:607 and useSpaceSocket.ts:388 route w.*, with batching and the new budget;
  - room item routes append sys entries;
  - props on ModuleRoomItem.
- Input: hover, drag, grab (holds, pose streams, rest poses), strike and buttons. Streams. Haptics on every device.
- <EngineLayer> replaces <ModuleItems>.
- The gear menu gains props, buttons, views, follow or pin, and reset. Settings gets the Spaces list with "Around us" and "As a model".
- The deploy-time parse check. The problems endpoint.
- Property tests: random interleavings converge, and two presses in one second give one start.
- Ports:
  - the final versions of begin-stone, rain (model fade) and rain-concert (Example 4, without m.after);
  - the hourglass (Example 2);
  - the marimba.

PHASE 3 (about 5 days): THE SAME MODULE EVERYWHERE, AND AUTHORING
- runSpace in /kit/saha.js: joinSaha plus the engine, with vanilla @pmndrs/pointer-events pointers driven from the XRFrame. Start with a half-day spike.
- The generated site page from saha.json. The hub routes w.* with `inst`. Refs resolve by ticket, or through /kit/resolve for public repos.
- A conformance test: one scripted input run against both hosts.
- saha.json in readPieces; the @saha/vite plugin; /kit/saha.d.ts; saha/test simulate(); a starter repo (JS and TS); docs/THINGS.md.
- The stencil miniature (gl stencil: true at Scene.tsx:840) with a movable viewer pin.
- The environment completed: lights, exposure, passthrough, ground, transitions, player.teleport and people.attach.
- media.video. m.after timers. The budget HUD and relevance.
- Ports: sky, sakura, fireflies, bowls, sand garden.

PHASE 4 (1-2 weeks, incremental): FINISHED ROOMS AND OFFICIAL THINGS
- finalize: the lockfile, the pins table and the policy (enforced by the server and followed by the client). Public rooms through lobby doors.
- The saha.official repo, and the bundled registry.
- The Go table on the model, with the GoRoomItem converter and its dry run.
- The built-in pieces, one at a time, each deleting its server/space module.
- The room Canvas moves to pmndrs events, and DesktopPointer and usePressRouter retire.
- Mirror views (a miniature of the space you are in).
- Optimistic actions, opt-in per action.
- Optionally, one world shared by a public room and its site.

PHASE 5 (when Nikk decides): SAFETY
- SES compartments per repo; three with attenuated loaders; the root membrane.
- Capability declarations in saha.json ("needs").
- The deploy lint becomes enforcement.
- Reducers replayed on the server in an isolate, for official and finalized things.
- Legacy factories refused outside their members' own rooms.


# risks

- No sandbox, by decision. A thing pulled into a room runs in every viewer's page with that viewer's saha.ing session: it can call /bff as them, and the room page has no CSP. Mitigations until phase 5: only member or public repos can be brought in (describeModule); public things carry a 'this runs with your saha.ing access' confirmation; finished public rooms load only pinned deploys from the owner's repos and saha.official; dev warnings and a deploy lint flag globals.
- The sandbox promise holds only for code that keeps to R1-R7. A same-realm SES compartment cannot preserve walking above ctx.root, window or document use, onBeforeRender's renderer argument (Mica's sky uses it), or code that closes or replaces the audio context. These break, and the lint and dev warnings exist to surface them years early. A worker sandbox was already tried and removed (42441f0, b1467a7) because it cannot run custom shaders and worklets.
- Two transports for one contract. Phase 1 rides moduleState/moduleEvent (in memory, last write wins, 40 messages a second); phase 2 moves to the log. The API stays the same, but limits and timing change underneath, and anything that relied on phase 1's lack of persistence will see values survive restarts.
- Reducer determinism. Every device must reach the same model state. Float maths can differ between V8 (Quest, Chrome) and JavaScriptCore (Safari, visionOS); mixed deploy versions and accidental Date.now or Math.random calls also diverge. Mitigations: JSON-only state, dev traps, code entries at a fixed seq, hash canaries with automatic resync, and guidance to keep reducers to integers and plain arithmetic.
- Model snapshots come from clients and the server cannot verify them without running code. A buggy client could poison a late joiner. This is no worse than today's moduleState, where any client may write any value, and hash canaries catch accidents; malice needs server-side replay in an isolate (phase 5).
- The 45 s leave grace is a trade-off. It stops headset reconnects (about every 30 s, per shared/room-items.ts) from releasing holds or resetting a lone meditator, but someone who really vanishes keeps holding the hourglass for 45 s unless an explicit leave arrives (pagehide, Leave, leaveEverywhere).
- Until phase 4 the room has two desktop input paths. DesktopPointer, which raycasts thing targets with R3F's interactive objects as occluders, must agree with R3F's own nearest-hit ordering, or a click could reach a panel behind a drum or miss one in front. It needs tests with panels in front of and behind things, and the room's later switch to pmndrs events touches every R3F handler and the look-drag.
- Paths for the same input on two hosts can drift: @react-three/xr 6 in the room, and vanilla @pmndrs/pointer-events pointers driven by the engine on sites. Both use pointer-events 6.6.30, but capture, ordering and pointer kinds still need the conformance test and an early spike.
- Hot reload leaks. ES modules cannot be unloaded, so every push imports a new module graph, and hashed AudioWorklet processors stay registered for the rest of the visit. This is fine at kilobyte scale for an evening of pushes; offer a soft reload after about 50 swaps and make sure GPU resources are freed, which is where the real memory is.
- Quest performance. Mica's environments run 100-160k triangles, and an environment plus a miniature plus avatars plus several authors' things can drop frames; shader compiles, AudioWorklets and texture memory all add up. Budgets, the HUD, relevance tiers and compileAsync make this visible and reduce it, but they do not prevent it.
- Stencil miniatures need a stencil buffer (Scene.tsx:840 sets only antialias) and cost a little per material. Camera-relative domes (Mica's sky) and shader-placed geometry (rain drops with frustumCulled false) behave oddly at 0.05 scale. Until phase 3, miniatures of environments hide such parts by checking ctx.mode.
- Socket budgets. Batching to 120 entries and 64 KB a second per socket, with a share per thing, still means a chatty thing (state written every frame, poses at 15 Hz, a fast drummer) competes with everything else; and the hub's per-space key limit (200) needs the inst field before sites carry many things. Over-limit traffic must be refused with a message, not dropped silently as socket.ts does today.
- CSP-sandboxed standalone sites have an opaque origin, no cookies and no localStorage: refs resolve by ticket or as public, guests see public things only, and anything kept per device lives in memory. immersive-ar and hand tracking inside the sandbox must be confirmed on Quest and the XREAL Aura.
- Pinned deploys retire (keepPerBranch 10). Finished rooms need the pins table, and open sessions on old deploys must refetch rather than 404 when a branch pushes more than 10 times in one sitting.
- Build pitfalls for TypeScript authors: Vite library mode inlines assets; app mode drops the default export without preserveEntrySignatures; bundling a second three.js silently breaks instanceof checks and pointer capture; and vite dev must leave three and saha to the import map. The template config and the @saha/vite plugin carry these rules, and a deploy lint flags a bundled three.js.
- three.js lock-in. Every thing runs on the room's three 0.186, and an upgrade can break custom ShaderMaterials that #include chunks (Mica uses colorspace_fragment). Manifests declare their three version, and official things get a render smoke test on every upgrade.
- Authoring discipline, especially for AI agents. The who-does-what rule, pure reducers and no top-level side effects are easy to break, and a broken one looks like flaky multiplayer. The defences are the four-rule model in the docs, explanatory errors, dev traps, the deploy lint, and simulate() tests in Node.
- Hidden-information games (card hands, secret roles) and server-run world logic (an NPC that must decide once) are impossible while every client replicates every model. They need server-side models later; until then, keep decisions to whoever caused them, plus functions of time.
- Data migrations from the bespoke stores (Go tables, lanterns, garden strokes) can lose live games and drawings. Each one needs a converter with a dry run, a backup, and the old routes kept readable for a week.