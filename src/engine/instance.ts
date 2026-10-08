import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { thingAudio, type ThingAudio } from "./audio";
import { EngineBus } from "./bus";
import type { EnvLayer } from "./env";
import type { Host } from "./host";
import { InputHub, type InputHubOptions, type InstanceInput } from "./input";
import type { Child, ChildHandle, Ctx, Handle, Json, Mode, Off, ThingDefinition } from "./types";
import { thingUi } from "./ui";

/**
 * A THING, RUNNING (docs/things/DESIGN.md, 1): loaded from its pinned
 * address, set up on a root that is not in the scene yet, its shaders
 * compiled, then attached in one frame. Everything it registers through ctx
 * is undone when it goes, its own dispose() is called, and everything under
 * its root is freed. A setup that throws leaves a badge, never a hole: when
 * a push breaks, the version before keeps running (the caller swaps only on
 * success).
 */

const BRAND = Symbol.for("saha.thing");
export const isThing = (value: unknown): value is ThingDefinition => Boolean(value) && (value as Record<symbol, unknown>)[BRAND] === 1;

/** A frame callback that throws this many times in a row is paused; the thing's others and the room go on. */
const FRAME_FAILURES = 20;

/**
 * A space's part is <space id>/<key>, and the room's relay carries ids of up
 * to three parts deep with keys like these (shared/space-wire.ts), so a key
 * that would not travel is refused here, where the author sees why.
 */
const CHILD_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CHILD_DEPTH = 3;

/** Where three's decoders are served (server/spaces/routes.ts, /kit/three/addons/). */
const DRACO_PATH = "/kit/three/addons/libs/draco/";
const BASIS_PATH = "/kit/three/addons/libs/basis/";

/** One per page: the host, the shared values and moments, and input. */
export class Engine {
  readonly bus: EngineBus;
  readonly input: InputHub;
  private gltf: GLTFLoader | null = null;
  private draco: DRACOLoader | null = null;
  private ktx2: KTX2Loader | null = null;
  constructor(readonly host: Host, input: InputHubOptions) {
    this.bus = new EngineBus(host.transport, {
      who: (id) => (id === null ? host.me : host.people().find((person) => person.id === id) ?? (id ? { id, name: id, me: false, agent: false } : null)),
      now: () => host.now(),
      arrived: () => host.invalidate(),
      problem: (id, text) => host.problem(id, text),
    });
    this.input = new InputHub(input);
  }
  /** One glTF loader for the page, with every compression three can read (meshopt, Draco, KTX2). */
  gltfLoader(): GLTFLoader {
    if (!this.gltf) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
      loader.setDRACOLoader(this.draco);
      if (this.host.renderer) {
        this.ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(this.host.renderer);
        loader.setKTX2Loader(this.ktx2);
      }
      this.gltf = loader;
    }
    return this.gltf;
  }
  /** Before things run each frame: where the hands are. */
  frame(xr: { frame?: XRFrame | null; referenceSpace?: XRReferenceSpace | null; origin?: THREE.Object3D | null } = {}): void {
    this.input.readTips(xr.frame, xr.referenceSpace ?? null, xr.origin ?? null);
  }
  async load(url: string): Promise<{ def: ThingDefinition } | { module: Record<string, unknown> }> {
    const module = await this.host.importModule(url);
    return isThing(module.default) ? { def: module.default } : { module };
  }
  dispose(): void {
    this.bus.dispose();
    this.input.dispose();
    this.draco?.dispose();
    this.ktx2?.dispose();
  }
}

export function freeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose?.();
    }
  });
}

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export type InstanceOptions = {
  id: string;
  url: string;
  def: ThingDefinition;
  mode: Mode;
  /** World metres per local metre. */
  scale: number;
  /** Where its root attaches once it has set itself up. */
  parent: THREE.Object3D;
  props?: Record<string, Json>;
  /** It fills the surroundings: env writes count. */
  surround: boolean;
  /** What the version before it saved. */
  hot?: unknown;
};

export class ThingInstance {
  readonly root = new THREE.Group();
  readonly id: string;
  readonly def: ThingDefinition;
  handle: Handle | null = null;
  failed: string | null = null;
  private readonly offs = new Set<Off>();
  /** Each frame callback, and how many times in a row it has thrown. */
  private readonly frames = new Map<(dt: number, t: number) => void, number>();
  private input: InstanceInput | null = null;
  private audio: ThingAudio | null = null;
  private envLayer: EnvLayer | null = null;
  private children: SpaceChildren | null = null;
  private disposed = false;
  private started = 0;

  constructor(private readonly engine: Engine, private readonly options: InstanceOptions) {
    this.id = options.id;
    this.def = options.def;
    this.root.name = `thing ${options.id}`;
  }

  /** Registered through ctx: undone when the thing goes, or at once when it has gone already. */
  own<T extends Off>(off: T): T {
    if (this.disposed) {
      try {
        off();
      } catch {
        // Nothing to undo into.
      }
    } else {
      this.offs.add(off);
    }
    return off;
  }

  get gone(): boolean {
    return this.disposed;
  }

  /**
   * Set up and attach. False when setup failed (nothing was attached), or the
   * thing was taken away while it was still starting: then whatever its setup
   * made after that is undone too, and its dispose() is called.
   */
  async start(): Promise<boolean> {
    const { host, bus } = this.engine;
    const def = this.def;
    this.started = performance.now();
    if (def.model) host.problem(this.id, "This thing declares a model: ordered actions arrive in phase 2. Its shared values (ctx.state) and moments work now.");
    try {
      await bus.load(this.id, def.shared ?? {});
      if (this.disposed) return false;
      const ctx = this.makeContext();
      if (def.kind === "space") {
        this.children = new SpaceChildren(this.engine, this, def.things ?? {}, def.scenes ?? null, this.options);
        await this.children.mountScene();
        if (this.disposed) return this.abandon();
      }
      const made = def.setup ? await def.setup(ctx) : undefined;
      this.handle = made && typeof made === "object" ? made : null;
    } catch (error) {
      if (this.disposed) return this.abandon();
      this.failed = describe(error);
      host.problem(this.id, `${def.name} did not start: ${this.failed}`);
      this.teardown();
      return false;
    }
    if (this.disposed) return this.abandon();
    // Shaders compiled before the thing appears, so bringing it in mid-VR does not stutter.
    const renderer = host.renderer as (THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, s?: THREE.Scene) => Promise<unknown> }) | null;
    try {
      await renderer?.compileAsync?.(this.root, host.camera, host.scene);
    } catch {
      // Compiling ahead is a nicety; drawing it compiles anyway.
    }
    if (this.disposed) return this.abandon();
    this.options.parent.add(this.root);
    host.invalidate();
    return true;
  }

  /** Taken away mid-start: what setup made after dispose() ran is undone now. */
  private abandon(): false {
    try {
      this.handle?.dispose?.();
    } catch {
      // It was never shown; its tidying is best effort.
    }
    this.handle = null;
    this.teardown();
    return false;
  }

  private makeContext(): Ctx {
    const { host, bus, input: hub } = this.engine;
    const options = this.options;
    const id = this.id;
    const root = this.root;
    const own = <T extends Off>(off: T): T => this.own(off);
    this.input = hub.forInstance(root, { model: options.mode === "model", report: (what, error) => host.problem(id, `${what} went wrong: ${describe(error)}`) });
    this.input.surround = options.surround;
    // Made on first use: most things never sound, and a test host has no AudioContext.
    const sound = (): ThingAudio => {
      if (this.disposed) throw new Error(`${this.def.name} has been taken away; its sound has gone with it.`);
      return (this.audio ??= thingAudio(root, { quiet: options.mode === "model" }));
    };
    const input = this.input;
    const state = bus.state(id);
    const props: Record<string, Json> = {};
    for (const [key, prop] of Object.entries(this.def.props ?? {})) props[key] = prop.default;
    Object.assign(props, options.props ?? {});
    const textures = new Map<string, Promise<THREE.Texture>>();
    const viewerAt = new THREE.Vector3();
    const viewerTurn = new THREE.Quaternion();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const instance = this;
    const started = this.started;
    const ctx: Ctx = {
      id,
      kind: this.def.kind,
      mode: options.mode,
      scale: options.scale,
      root,
      props: Object.freeze(props),
      host: { name: host.name, final: host.final },
      prefs: {
        get reducedMotion() {
          return host.reducedMotion;
        },
      },
      hot: { data: options.hot },
      frame: (fn) => {
        if (!this.disposed) this.frames.set(fn, 0);
        return own(() => this.frames.delete(fn));
      },
      state: {
        get: state.get,
        set: state.set,
        watch: (keys, fn) => own(state.watch(keys, fn)),
      },
      net: {
        moment: (name, data) => bus.moment(id, name, data === undefined ? null : data),
        onMoment: (name, fn) => own(bus.onMoment(id, name, fn)),
      },
      act: async () => {
        host.problem(id, "ctx.act and models arrive in phase 2 (the ordered log); use ctx.state and ctx.net for now.");
        return { ok: false, why: "phase 2" };
      },
      ui: {
        ...thingUi({
          input,
          canvas: (width, height) =>
            typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width, height }) : new OffscreenCanvas(width, height),
          own,
          invalidate: () => host.invalidate(),
          gone: () => this.disposed,
        }),
        query: (queryOptions) => {
          if (this.disposed) return Promise.resolve({ status: "removed" as const });
          if (!host.query) return Promise.resolve({ status: "not-here" as const });
          const asking = host.query(id, queryOptions ?? {});
          own(asking.close);
          return asking.result;
        },
        openLink: (url) => {
          let parsed: URL | null = null;
          try {
            parsed = new URL(String(url));
          } catch {
            parsed = null;
          }
          if (!parsed || parsed.protocol !== "https:") return { ok: false, why: "only an https address opens" };
          if (typeof window === "undefined") return { ok: false, why: "this page has no browser to open it in" };
          const opened = window.open(parsed.href, "_blank", "noopener,noreferrer");
          return opened === null && !document.hasFocus() ? { ok: false, why: "the browser did not open it" } : { ok: true };
        },
      },
      rooms: {
        go: async (room) => {
          const name = String(room ?? "").trim();
          if (this.disposed) return { ok: false as const, why: "removed" as const, message: `${this.def.name} has been taken away.` };
          if (!host.goToRoom) return { ok: false as const, why: "not-here" as const, message: "Rooms are in saha.ing; this page has none." };
          // Only from a press on this thing: a door is opened by a person, never by a thing on its own.
          if (!this.input || performance.now() - this.input.lastPressAt > 2000) {
            return { ok: false as const, why: "no-press" as const, message: "A door opens from a press on the thing: call rooms.go from a press." };
          }
          try {
            await host.goToRoom(name);
            return { ok: true as const };
          } catch (error) {
            return { ok: false as const, why: "refused" as const, message: error instanceof Error ? error.message : `Could not go to ${name}.` };
          }
        },
      },
      books: {
        shelf: (n, shelfOptions) => (host.books ? host.books.shelf(n, shelfOptions?.order === "title" ? "title" : "popular") : Promise.reject(Object.assign(new Error("Books are in a saha.ing room; this page has none."), { why: "not-here" }))),
        read: (bookId, page = 1) =>
          host.books ? host.books.read(bookId, page) : Promise.reject(Object.assign(new Error("Books are in a saha.ing room; this page has none."), { why: "not-here" })),
        search: (searchOptions) =>
          host.books
            ? host.books.search(String(searchOptions?.query ?? ""), searchOptions?.cursor ?? null)
            : Promise.reject(Object.assign(new Error("Books are in a saha.ing room; this page has none."), { why: "not-here" })),
      },
      reviews: (() => {
        const none = <T,>(): Promise<T> => Promise.reject(Object.assign(new Error("Review rounds are in a saha.ing room; this page has none."), { why: "not-here" }));
        const reviews = host.reviews;
        if (!reviews) {
          return {
            list: () => none(), accept: () => none(), decline: () => none(), findings: () => none(), open: () => none(), back: () => undefined,
            request: () => Promise.resolve({ ok: false as const, why: "not-here" as const, message: "Review rounds are in a saha.ing room; this page has none." }),
            submit: () => Promise.resolve({ ok: false as const, why: "not-here" as const, message: "Review rounds are in a saha.ing room; this page has none." }),
          };
        }
        return {
          list: (o) => reviews.list(o ?? {}),
          accept: (rid) => reviews.accept(rid),
          decline: (rid) => reviews.decline(rid),
          findings: (rid, o) => reviews.findings(rid, o ?? {}),
          open: (rid, variant) => reviews.open(rid, variant),
          back: () => reviews.back(),
          request: (o) => {
            if (this.disposed) return Promise.resolve({ ok: false as const, why: "removed" as const, message: `${this.def.name} has been taken away.` });
            const requesting = reviews.request(id, o);
            own(requesting.close);
            return requesting.result;
          },
          submit: (rid, o) => {
            if (this.disposed) return Promise.resolve({ ok: false as const, why: "removed" as const, message: `${this.def.name} has been taken away.` });
            const submitting = reviews.submit(id, rid, o);
            // Taking the thing away closes its panel, as for questions.
            own(submitting.close);
            return submitting.result;
          },
        };
      })(),
      questions: {
        ask: (askOptions) => {
          if (this.disposed) return Promise.resolve({ ok: false, why: "removed", message: `${this.def.name} has been taken away.` });
          if (!host.questions) return Promise.resolve({ ok: false, why: "not-here", message: "Questions are asked in a saha.ing room; this page has none." });
          const asking = host.questions.ask(id, askOptions ?? {});
          // Taking the thing away closes its panel (Mica, 7322): never a stale Send.
          own(asking.close);
          return asking.result;
        },
        list: (listOptions) => {
          if (!host.questions) return Promise.reject(Object.assign(new Error("Questions are asked in a saha.ing room; this page has none."), { why: "not-here" }));
          return host.questions.list(id, listOptions ?? {});
        },
      },
      time: {
        now: () => host.now(),
        get elapsed() {
          return (performance.now() - started) / 1000;
        },
      },
      people: {
        get me() {
          return host.me;
        },
        all: () => host.people(),
      },
      get viewer() {
        host.camera.getWorldPosition(viewerAt);
        host.camera.getWorldQuaternion(viewerTurn);
        const position = root.worldToLocal(viewerAt.clone());
        const quaternion = root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(viewerTurn);
        return { position, quaternion, distance: Math.hypot(position.x, position.z) };
      },
      toLocal: (world, out) => root.worldToLocal((out ?? new THREE.Vector3()).copy(world)),
      input,
      haptics: {
        pulse: (hand, strength, ms) => hub.pulse(host.renderer?.xr.getSession() ?? null, hand, strength, ms),
      },
      audio: {
        get context() {
          return sound().context;
        },
        get out() {
          return sound().out;
        },
        at: (where, placement) => sound().at(where, placement),
        // A path is beside the thing's module, as with ctx.assets.
        workletNode: (url, processor, nodeOptions) => sound().workletNode(new URL(String(url), options.url).href, processor, nodeOptions),
        buffer: (url) => sound().buffer(new URL(String(url), options.url).href),
        get unlocked() {
          return sound().unlocked;
        },
        whenUnlocked: (fn) => own(sound().whenUnlocked(fn)),
      },
      assets: {
        url: (path) => new URL(path, options.url).href,
        texture: (path, textureOptions = {}) => {
          const url = new URL(path, options.url).href;
          let loading = textures.get(url);
          if (!loading) {
            loading = new THREE.TextureLoader().loadAsync(url).then((texture) => {
              if (textureOptions.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
              return texture;
            });
            textures.set(url, loading);
          }
          return loading;
        },
        gltf: async (path) => {
          const gltf = await this.engine.gltfLoader().loadAsync(new URL(path, options.url).href);
          return { scene: cloneSkinned(gltf.scene) as THREE.Group, animations: gltf.animations };
        },
        json: async (path) => (await fetch(new URL(path, options.url).href)).json(),
        bytes: async (path) => (await fetch(new URL(path, options.url).href)).arrayBuffer(),
        canvas: (width, height) => {
          if (typeof document !== "undefined") return Object.assign(document.createElement("canvas"), { width, height });
          return new OffscreenCanvas(width, height);
        },
      },
      env: {
        // This thing's own layer of the surroundings (env.ts): a push's new version goes on top, and the old one's leaving changes nothing.
        set: (settings) => {
          if (!options.surround || this.disposed) return;
          (this.envLayer ??= host.envLayer()).set(settings);
        },
        light: (light) => {
          root.add(light);
          return own(() => {
            light.parent?.remove(light);
            (light as THREE.Light & { dispose?: () => void }).dispose?.();
          });
        },
        get writable() {
          return options.surround;
        },
      },
      get things() {
        return instance.children?.handles ?? {};
      },
      get scene() {
        return instance.children?.scene ?? null;
      },
      caption: (text) => host.caption(id, text),
      log: (...args) => console.info(`[${id}]`, ...args),
      problem: (text) => host.problem(id, text),
    };
    // A surrounding thing's environment, as its definition says, from the start.
    if (options.surround && this.def.env) ctx.env.set(this.def.env);
    return ctx;
  }

  /** Every frame, from the host's loop. */
  frame(dt: number, t: number): void {
    if (this.disposed || this.failed) return;
    const step = Math.min(dt, 0.1);
    this.input?.frame(step);
    for (const [fn, failures] of this.frames) {
      if (failures >= FRAME_FAILURES) continue;
      try {
        fn(step, t);
        if (failures) this.frames.set(fn, 0);
      } catch (error) {
        const now = failures + 1;
        if (this.frames.has(fn)) this.frames.set(fn, now);
        if (failures === 0) console.error(`[${this.id}] a frame callback threw`, error);
        if (now === FRAME_FAILURES) this.engine.host.problem(this.id, `A frame callback is paused after ${FRAME_FAILURES} errors in a row: ${describe(error)}`);
      }
    }
    this.children?.frame(step, t);
    this.audio?.frame();
  }

  /** What the next version of this thing is handed, after a push. */
  save(): unknown {
    try {
      return this.handle?.save?.();
    } catch {
      return undefined;
    }
  }

  private teardown(): void {
    for (const off of [...this.offs]) {
      try {
        off();
      } catch {
        // Undoing one registration must not stop the rest.
      }
    }
    this.offs.clear();
    this.frames.clear();
    this.children?.dispose();
    this.children = null;
    this.input?.dispose();
    this.input = null;
    this.audio?.dispose();
    this.audio = null;
    this.envLayer?.remove();
    this.envLayer = null;
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      freeObject(child);
    }
  }

  /** Take it away: its registrations undone, its dispose(), its root freed, the surroundings back. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.handle?.dispose?.();
    } catch (error) {
      this.engine.host.problem(this.id, `Did not tidy up cleanly: ${describe(error)}`);
    }
    this.teardown();
    this.root.parent?.remove(this.root);
    this.engine.host.invalidate();
  }
}

/**
 * A SPACE'S PARTS (docs/things/DESIGN.md, composition): each declared child
 * resolved from its ref, set up under the space's root where the space says,
 * with its own id (<space>/<key>), so its values and moments are its own. A
 * space with scenes mounts the children of the current one; the scene is the
 * space's shared value "scene", so everyone is in the same one.
 */
class SpaceChildren {
  readonly handles: Record<string, ChildHandle> = {};
  private readonly running = new Map<string, ThingInstance>();
  /** Parts on their way in (resolving, importing): never mounted twice. */
  private readonly arriving = new Set<string>();
  private readonly holders = new Map<string, THREE.Group>();
  private readonly things: Record<string, Child> = {};
  private current: string | null;
  private stopWatching: Off | null = null;
  private disposed = false;

  constructor(
    private readonly engine: Engine,
    private readonly parent: ThingInstance,
    things: Record<string, Child>,
    private readonly scenes: { list: string[]; initial: string } | null,
    private readonly options: InstanceOptions,
  ) {
    this.current = scenes ? (engine.bus.state(parent.id).get<string>("scene") ?? scenes.initial) : null;
    const depth = parent.id.split("/").length;
    for (const [key, child] of Object.entries(things)) {
      if (!CHILD_KEY.test(key)) {
        engine.host.problem(parent.id, `things.${key}: a part's key is lowercase letters, digits, - and _ (up to 32), so it can travel to everyone. It is left out.`);
        continue;
      }
      if (depth > CHILD_DEPTH) {
        engine.host.problem(parent.id, `things.${key}: spaces nest ${CHILD_DEPTH} deep at most. It is left out.`);
        continue;
      }
      this.things[key] = child;
      const childId = `${parent.id}/${key}`;
      const holder = new THREE.Group();
      holder.name = `part ${key}`;
      const [x, y, z] = child.at ?? [0, 0, 0];
      holder.position.set(x, y, z);
      holder.rotation.y = THREE.MathUtils.degToRad(child.turn ?? 0);
      holder.scale.setScalar(child.scale ?? 1);
      parent.root.add(holder);
      this.holders.set(key, holder);
      const running = this.running;
      const bus = engine.bus;
      const state = bus.state(childId);
      // What the space hears of its parts is the space's own: it goes when the space goes (a push, or taken away).
      this.handles[key] = {
        get mounted() {
          return running.has(key);
        },
        get root() {
          return running.get(key)?.root ?? null;
        },
        get api() {
          return (running.get(key)?.handle?.api ?? {}) as Record<string, (...args: never[]) => unknown>;
        },
        state: { get: state.get, set: state.set, watch: (keys, fn) => parent.own(state.watch(keys, fn)) },
        onMoment: (name, fn) => parent.own(bus.onMoment(childId, name, fn)),
      };
    }
  }

  get scene(): string | null {
    return this.current;
  }

  private wanted(child: Child): boolean {
    return !child.in || this.current === null || child.in.includes(this.current);
  }

  /** Mount what the current scene holds, take away what it does not; and follow the scene from now on. */
  async mountScene(): Promise<void> {
    if (this.scenes && !this.stopWatching) {
      this.stopWatching = this.engine.bus.state(this.parent.id).watch("scene", (scene: string | undefined) => {
        const next = scene ?? this.scenes!.initial;
        if (next === this.current) return;
        this.current = next;
        void this.mountScene();
      });
    }
    await Promise.all(Object.entries(this.things).map(async ([key, child]) => {
      const want = this.wanted(child);
      const have = this.running.get(key);
      if (!want && have) {
        have.dispose();
        this.running.delete(key);
      }
      if (want && !have) await this.mount(key, child);
    }));
  }

  private async mount(key: string, child: Child): Promise<void> {
    if (this.arriving.has(key)) return;
    this.arriving.add(key);
    try {
      await this.arrive(key, child);
    } finally {
      this.arriving.delete(key);
    }
  }

  /** Still wanted, after every wait: the space may have gone, or moved to a scene without this part. */
  private stillWanted(key: string, child: Child): boolean {
    return !this.disposed && this.wanted(child) && !this.running.has(key);
  }

  private async arrive(key: string, child: Child): Promise<void> {
    const { host } = this.engine;
    if (!this.stillWanted(key, child)) return;
    const resolved = await host.resolve(child.ref, this.options.url);
    if (!this.stillWanted(key, child)) return;
    if (!resolved) {
      host.problem(this.parent.id, `${key}: nothing called ${child.ref} to bring in.`);
      return;
    }
    let loaded;
    try {
      loaded = await this.engine.load(resolved.url);
    } catch (error) {
      host.problem(this.parent.id, `${key} (${child.ref}) did not load: ${describe(error)}`);
      return;
    }
    if (!this.stillWanted(key, child)) return;
    if (!("def" in loaded)) {
      host.problem(this.parent.id, `${key} (${child.ref}) is not a thing: it needs export default defineItem(...) or defineEnvironment(...).`);
      return;
    }
    const holder = this.holders.get(key)!;
    const surround = Boolean(child.surround) && this.options.surround;
    const mode: Mode = this.options.mode === "model" ? "model" : surround ? "full" : "item";
    const instance = new ThingInstance(this.engine, {
      id: `${this.parent.id}/${key}`,
      url: resolved.url,
      def: loaded.def,
      mode,
      scale: this.options.scale * (child.scale ?? 1),
      parent: holder,
      props: child.props,
      surround,
    });
    this.running.set(key, instance);
    const ok = await instance.start();
    if (this.running.get(key) !== instance) {
      // Taken away while it started (a scene change, or the space went): it was disposed then.
      instance.dispose();
      return;
    }
    if (!ok || this.disposed || !this.wanted(child)) {
      this.running.delete(key);
      instance.dispose();
    }
  }

  frame(dt: number, t: number): void {
    for (const instance of this.running.values()) instance.frame(dt, t);
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatching?.();
    for (const instance of this.running.values()) instance.dispose();
    this.running.clear();
  }
}
