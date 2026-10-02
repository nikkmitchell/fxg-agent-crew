import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { thingAudio, type ThingAudio } from "./audio";
import { EngineBus } from "./bus";
import type { Host } from "./host";
import { InputHub, type InputHubOptions, type InstanceInput } from "./input";
import type { Child, ChildHandle, Ctx, EnvSettings, Handle, Json, Mode, Off, ThingDefinition } from "./types";

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

/** Frame callbacks that throw this many times in a row are paused; the room goes on. */
const FRAME_FAILURES = 20;

/** One per page: the host, the shared values and moments, and input. */
export class Engine {
  readonly bus: EngineBus;
  readonly input: InputHub;
  constructor(readonly host: Host, input: InputHubOptions) {
    this.bus = new EngineBus(host.transport, (id) => (id === null ? host.me : host.people().find((person) => person.id === id) ?? (id ? { id, name: id, me: false, agent: false } : null)), () => host.now());
    this.input = new InputHub(input);
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
  private readonly frames = new Set<(dt: number, t: number) => void>();
  private frameFailures = 0;
  private input: InstanceInput | null = null;
  private audio: ThingAudio | null = null;
  private undoEnv: (() => void) | null = null;
  private envSettings: Partial<EnvSettings> = {};
  private children: SpaceChildren | null = null;
  private disposed = false;
  private started = 0;

  constructor(private readonly engine: Engine, private readonly options: InstanceOptions) {
    this.id = options.id;
    this.def = options.def;
    this.root.name = `thing ${options.id}`;
  }

  /** Set up and attach. False when setup failed (nothing was attached). */
  async start(): Promise<boolean> {
    const { host, bus } = this.engine;
    const def = this.def;
    this.started = performance.now();
    if (def.model) host.problem(this.id, "This thing declares a model: ordered actions arrive in phase 2. Its shared values (ctx.state) and moments work now.");
    try {
      await bus.load(this.id, def.shared ?? {});
      const ctx = this.makeContext();
      if (def.kind === "space") {
        this.children = new SpaceChildren(this.engine, this, def.things ?? {}, def.scenes ?? null, this.options);
        await this.children.mountScene();
      }
      const made = def.setup ? await def.setup(ctx) : undefined;
      this.handle = made && typeof made === "object" ? made : null;
    } catch (error) {
      this.failed = describe(error);
      host.problem(this.id, `${def.name} did not start: ${this.failed}`);
      this.teardown();
      return false;
    }
    if (this.disposed) return false;
    // Shaders compiled before the thing appears, so bringing it in mid-VR does not stutter.
    const renderer = host.renderer as (THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, s?: THREE.Scene) => Promise<unknown> }) | null;
    try {
      await renderer?.compileAsync?.(this.root, host.camera, host.scene);
    } catch {
      // Compiling ahead is a nicety; drawing it compiles anyway.
    }
    if (this.disposed) return false;
    this.options.parent.add(this.root);
    host.invalidate();
    return true;
  }

  private makeContext(): Ctx {
    const { host, bus, input: hub } = this.engine;
    const options = this.options;
    const id = this.id;
    const root = this.root;
    const own = <T extends Off>(off: T): T => {
      this.offs.add(off);
      return off;
    };
    this.input = hub.forInstance(root, { model: options.mode === "model" });
    this.input.surround = options.surround;
    // Made on first use: most things never sound, and a test host has no AudioContext.
    const sound = (): ThingAudio => (this.audio ??= thingAudio(root, { quiet: options.mode === "model" }));
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
      prefs: { reducedMotion: host.reducedMotion },
      hot: { data: options.hot },
      frame: (fn) => {
        this.frames.add(fn);
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
        workletNode: (url, processor, nodeOptions) => sound().workletNode(url, processor, nodeOptions),
        buffer: (url) => sound().buffer(url),
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
          const loader = new GLTFLoader();
          loader.setMeshoptDecoder(MeshoptDecoder);
          const gltf = await loader.loadAsync(new URL(path, options.url).href);
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
        set: (settings) => {
          if (!options.surround) return;
          this.envSettings = { ...this.envSettings, ...settings };
          this.undoEnv?.();
          this.undoEnv = host.applyEnv(this.envSettings);
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
    if (this.frameFailures < FRAME_FAILURES) {
      for (const fn of this.frames) {
        try {
          fn(step, t);
          this.frameFailures = 0;
        } catch (error) {
          this.frameFailures += 1;
          if (this.frameFailures === FRAME_FAILURES) this.engine.host.problem(this.id, `Paused after ${FRAME_FAILURES} errors in a row: ${describe(error)}`);
        }
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
    this.undoEnv?.();
    this.undoEnv = null;
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
  private readonly holders = new Map<string, THREE.Group>();
  private current: string | null;
  private stopWatching: Off | null = null;
  private disposed = false;

  constructor(
    private readonly engine: Engine,
    private readonly parent: ThingInstance,
    private readonly things: Record<string, Child>,
    private readonly scenes: { list: string[]; initial: string } | null,
    private readonly options: InstanceOptions,
  ) {
    this.current = scenes ? (engine.bus.state(parent.id).get<string>("scene") ?? scenes.initial) : null;
    for (const [key, child] of Object.entries(things)) {
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
        state: bus.state(childId),
        onMoment: (name, fn) => bus.onMoment(childId, name, fn),
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
    const { host } = this.engine;
    const resolved = await host.resolve(child.ref, this.options.url);
    if (this.disposed || !this.wanted(child) || this.running.has(key)) return;
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
    if (!ok && this.running.get(key) === instance) this.running.delete(key);
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
