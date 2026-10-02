import * as THREE from "three";

/**
 * RUN A THING FROM A SPACE, RIGHT HERE (Nikk, 2026-10-01: "run the code for
 * the forest inside of the website ... not running that entire website, it's
 * running the part about the forest").
 *
 * A thing is a JavaScript module in a space's git, listed in its
 * saha-pieces.json as an item, an environment or a space. Its function (the
 * default export, or the one the manifest names) is called with:
 *
 *   {
 *     scene,      // a group that is the thing's own place: put everything in it;
 *                 //   saha.ing places, moves and scales it
 *     camera, renderer, THREE,  // the room's own, as on the thing's own page
 *     room,       // shared values and moments between every copy in the room:
 *                 //   room.set/state/on("state"), room.emit/on("event"), room.you
 *     at: [0, 0, 0], rotationY: 0, id,  // for factories written like createDrums
 *     saha: {
 *       mode,     // "item" | "model" | "full": a thing, a space as a model, or all around
 *       scale,    // how much the room has scaled its place (a model: about 0.05)
 *       world,    // the room's THREE.Scene, for an environment's background or fog
 *       url(path),        // a file beside the module, in the same deploy
 *       onPress(object, fn),  // fn({ point, by }) when somebody presses that object
 *       onFrame(fn),      // fn(dt, t) every frame, as well as update()
 *     },
 *   }
 *
 * and may return (or resolve to) { update(dt, t), dispose() }. Both optional:
 * whatever it put in `scene` is taken away and freed when it unloads, and an
 * environment's background and fog are put back. It must not call
 * renderer.setAnimationLoop: the room owns the frame.
 *
 * NOTHING IS SANDBOXED YET (Nikk: security comes after the proof of concept).
 * A thing runs as the room's page does.
 */

export type ModuleMode = "item" | "model" | "full";

export type ModuleRoom = {
  you: { id: string; name: string } | null;
  readonly state: Record<string, unknown>;
  set(key: string, value: unknown): void;
  emit(name: string, data?: unknown): void;
  on(event: string, listener: (...args: never[]) => void): () => void;
  people: Map<string, unknown>;
  others(): unknown[];
  ready: boolean;
  connected: boolean;
  guest: boolean;
};

export type RunOptions = {
  url: string;
  exportName: string | null;
  id: string;
  mode: ModuleMode;
  /** The group the thing builds in; the caller places it. */
  root: THREE.Object3D;
  world: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  room: ModuleRoom;
  scale?: number;
  /** Something went wrong in the thing's own code: shown to whoever is building it. */
  onProblem?: (text: string) => void;
  /** Tests import from elsewhere; the room uses the browser's own import(). */
  importModule?: (url: string) => Promise<Record<string, unknown>>;
};

export type PressInfo = { point: THREE.Vector3 | null; by: { id: string; name: string } | null };

export type RunningModule = {
  /** Every frame, from the room's own loop. */
  update(dt: number, t: number): void;
  /** Somebody pressed `object` (or something in it): true when the thing asked to hear it. */
  press(object: THREE.Object3D, info: PressInfo): boolean;
  /** Take it away: its dispose, everything in its place freed, the room's background and fog back. */
  dispose(): void;
  readonly failed: string | null;
};

/** What a thing's function may give back. */
type ModuleHandle = { update?: (dt: number, t: number) => void; dispose?: () => void };

/** Updates that throw this many times in a row stop being called (the rest of the room goes on). */
const UPDATE_FAILURES = 20;

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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

export async function runModule(options: RunOptions): Promise<RunningModule> {
  const problem = (text: string) => options.onProblem?.(text);
  const pressHandlers = new Map<THREE.Object3D, (info: PressInfo) => void>();
  const frameHandlers = new Set<(dt: number, t: number) => void>();
  const background = options.world.background;
  const fog = options.world.fog;
  let handle: ModuleHandle | null = null;
  let failed: string | null = null;
  let updateFailures = 0;
  let disposed = false;

  const saha = {
    mode: options.mode,
    scale: options.scale ?? 1,
    world: options.world,
    url: (path: string) => new URL(path, options.url).href,
    onPress: (object: THREE.Object3D, fn: (info: PressInfo) => void) => {
      pressHandlers.set(object, fn);
      return () => pressHandlers.delete(object);
    },
    onFrame: (fn: (dt: number, t: number) => void) => {
      frameHandlers.add(fn);
      return () => frameHandlers.delete(fn);
    },
  };

  try {
    const loaded = await (options.importModule ?? ((url: string) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>))(options.url);
    const start = options.exportName ? loaded[options.exportName] : loaded.default;
    if (typeof start !== "function") {
      throw new Error(options.exportName ? `the module has no function called ${options.exportName}` : "the module needs a default export: export default function (options) { ... }");
    }
    const made = await (start as (args: unknown) => unknown)({
      scene: options.root,
      camera: options.camera,
      renderer: options.renderer,
      THREE,
      room: options.room,
      at: [0, 0, 0],
      rotationY: 0,
      id: options.id,
      saha,
    });
    handle = made && typeof made === "object" ? (made as ModuleHandle) : null;
  } catch (error) {
    failed = describe(error);
    problem(`Could not start: ${failed}`);
  }

  const running: RunningModule = {
    get failed() {
      return failed;
    },
    update(dt, t) {
      if (disposed || failed !== null || updateFailures >= UPDATE_FAILURES) return;
      try {
        handle?.update?.(dt, t);
        for (const fn of frameHandlers) fn(dt, t);
        updateFailures = 0;
      } catch (error) {
        updateFailures += 1;
        if (updateFailures === UPDATE_FAILURES) problem(`Stopped updating after ${UPDATE_FAILURES} errors in a row: ${describe(error)}`);
      }
    },
    press(object, info) {
      for (let at: THREE.Object3D | null = object; at; at = at.parent) {
        const fn = pressHandlers.get(at);
        if (!fn) continue;
        try {
          fn(info);
        } catch (error) {
          problem(`A press went wrong: ${describe(error)}`);
        }
        return true;
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        handle?.dispose?.();
      } catch (error) {
        problem(`Did not tidy up cleanly: ${describe(error)}`);
      }
      for (const child of [...options.root.children]) {
        options.root.remove(child);
        freeObject(child);
      }
      pressHandlers.clear();
      frameHandlers.clear();
      options.world.background = background;
      options.world.fog = fog;
    },
  };
  return running;
}
