import * as THREE from "three";
import { MODULE_ITEM, MODULE_KEY, MODULE_VALUE_BYTES, type ClientMessage, type ServerMessage } from "../../../shared/space-wire";
import { bff, type SpaceModules } from "../../bff-client";
import { space } from "../../space-client";
import { EnvStack } from "../../engine/env";
import type { Host, Resolved, TransportEvent } from "../../engine/host";
import { Engine } from "../../engine/instance";
import type { Json, Person } from "../../engine/types";
import { claimPointer } from "../pointer-claim";
import { resumeRoomAudio } from "../room-audio";

/**
 * THE SAHA.ING ROOM, AS A HOST FOR THINGS (src/engine/host.ts): what the
 * engine needs, made from what the room already has. Shared values and
 * moments ride the room's own socket (moduleState / moduleEvent), stamped by
 * the server; refs resolve through the spaces' listings; surroundings are the
 * room's scene and camera, in layers (src/engine/env.ts); problems go to the
 * badge of the thing they belong to.
 *
 * A space's own parts ("orb") come from the very deploy the space came from,
 * so a push never mixes this push's space with last push's parts. A part from
 * another space ("xr.instruments/drums") follows that space's branch: when it
 * deploys, the spaces using it are told to load again (onReload).
 */

const REF = /^(?:([a-z0-9][a-z0-9._-]{0,63})\/)?([a-z0-9][a-z0-9_-]{0,31})(?:@([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?$/;
/** /s/<space>/~<deploy>/...: one deploy of one space (shared/space-bench.ts, moduleUrl). */
const PINNED = /\/s\/([^/]+)\/~([A-Za-z0-9_-]{1,64})\//;

export type RoomEngine = {
  engine: Engine;
  /** Where a module came from, and which thing in the room it is, so a space's "orb" means its own deploy's orb. */
  know(url: string, source: { space: string; branch: string }, item: string): void;
  /** A thing's badge: problems for its id and its parts' ids. */
  onProblem(rootId: string, fn: (text: string) => void): () => void;
  /** A part this thing uses from another space has a new deploy: load the thing again. */
  onReload(rootId: string, fn: () => void): () => void;
  /**
   * A turn to load and set up (Nikk, 6928: "have the objects download be one by one"): things come in one
   * after another, so a heavy one's files never compete with all the others at once. Call the release when
   * done; a turn that takes over 20 s lets the next one go anyway, so one stuck thing never blocks the room.
   */
  turn(): Promise<() => void>;
  dispose(): void;
};

export function createRoomEngine(deps: {
  scene: THREE.Scene;
  camera: () => THREE.Camera;
  gl: THREE.WebGLRenderer;
  invalidate: () => void;
  occluders: () => THREE.Object3D[];
  me: () => Person | null;
  people: () => readonly Person[];
  /** False when the socket was not open. */
  send: (message: ClientMessage) => boolean | void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  reducedMotion: () => boolean;
}): RoomEngine {
  /** Each module url: its space and branch, and the thing in the room it belongs to. */
  const sources = new Map<string, { space: string; branch: string; item: string | null }>();
  const listings = new Map<string, Promise<SpaceModules>>();
  const badges = new Map<string, Set<(text: string) => void>>();
  const reloads = new Map<string, Set<() => void>>();
  /** For each space@branch, the things in the room with a part from it. */
  const users = new Map<string, Set<string>>();

  const cached = (key: string, fetch: () => Promise<SpaceModules>) => {
    let found = listings.get(key);
    if (!found) {
      found = fetch();
      found.catch(() => listings.delete(key));
      listings.set(key, found);
    }
    return found;
  };
  /** One deploy's listing never changes. */
  const ofDeploy = (spaceName: string, deploy: string) => cached(`${spaceName}~${deploy}`, () => bff.spaceModules(spaceName, undefined, undefined, deploy));
  /** A branch's listing is its live deploy's, until that branch deploys again. */
  const ofBranch = (spaceName: string, branch?: string) => cached(`${spaceName}@${branch ?? ""}`, () => bff.spaceModules(spaceName, branch));

  const stack = new EnvStack({
    read: () => {
      const camera = deps.camera() as THREE.PerspectiveCamera;
      return { background: deps.scene.background as THREE.Color | THREE.Texture | null, fog: deps.scene.fog as THREE.Fog | THREE.FogExp2 | null, far: camera.far, exposure: deps.gl.toneMappingExposure };
    },
    write: (state) => {
      const camera = deps.camera() as THREE.PerspectiveCamera;
      deps.scene.background = state.background;
      deps.scene.fog = state.fog;
      if (camera.far !== state.far) {
        camera.far = state.far;
        camera.updateProjectionMatrix();
      }
      deps.gl.toneMappingExposure = state.exposure;
      deps.invalidate();
    },
  });

  const host: Host = {
    name: "room",
    final: false,
    transport: {
      values: (id) => space.moduleState(id).then((answer) => answer.state as Record<string, Json>),
      set: (item, key, value) => deps.send({ type: "moduleState", item, key, value }) !== false,
      moment: (item, name, data) => void deps.send({ type: "moduleEvent", item, name, data }),
      // What the room's relay carries (shared/space-wire.ts): anything else would change here and nowhere else.
      check: (item, name, value) => {
        if (!MODULE_ITEM.test(item)) return `this thing's id (${item}) cannot travel; a part's key is lowercase letters, digits, - and _.`;
        if (!MODULE_KEY.test(name)) return "a name is 1 to 64 letters, digits and _ . : / -.";
        const size = JSON.stringify(value ?? null)?.length ?? 0;
        if (size > MODULE_VALUE_BYTES) return `that is ${size} characters as JSON; ${MODULE_VALUE_BYTES} is the most that travels. Keep big things in files (ctx.assets).`;
        return null;
      },
      subscribe: (listener) =>
        deps.subscribe((message) => {
          let event: TransportEvent | null = null;
          if (message.type === "moduleState") event = { type: "value", instance: message.item, key: message.key, value: message.value as Json, by: message.by };
          if (message.type === "moduleEvent") event = { type: "moment", instance: message.item, name: message.name, data: message.data as Json, from: message.from };
          if (event) listener(event);
        }),
    },
    scene: deps.scene,
    get camera() {
      return deps.camera();
    },
    renderer: deps.gl,
    get me() {
      return deps.me();
    },
    people: deps.people,
    now: () => Date.now(),
    get reducedMotion() {
      return deps.reducedMotion();
    },
    async resolve(ref, from): Promise<Resolved | null> {
      const match = REF.exec(ref);
      if (!match) return null;
      const here = sources.get(from);
      const pinned = PINNED.exec(new URL(from, window.location.origin).pathname);
      let found: SpaceModules | null;
      if (!match[1] && !match[3] && pinned) {
        // This space's own part: from the same deploy as the space.
        found = await ofDeploy(decodeURIComponent(pinned[1]), pinned[2]).catch(() => null);
      } else {
        const spaceName = match[1] ?? here?.space;
        if (!spaceName) return null;
        const branch = match[3] ?? (match[1] ? undefined : here?.branch);
        found = await ofBranch(spaceName, branch).catch(() => null);
        if (found && here?.item) {
          // When that branch deploys again, this thing loads again, and its parts with it.
          const key = `${found.space}@${found.branch}`;
          let who = users.get(key);
          if (!who) {
            who = new Set();
            users.set(key, who);
          }
          who.add(here.item);
        }
      }
      const entry = found?.modules.find((module) => module.id === match[2]);
      if (!found || !entry) return null;
      const url = new URL(entry.url, window.location.origin).href;
      sources.set(url, { space: found.space, branch: found.branch, item: here?.item ?? null });
      return { url, exportName: entry.export, kind: entry.kind };
    },
    importModule: (url) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>,
    envLayer: () => stack.layer(),
    problem(id, text) {
      const [rootId, ...part] = id.split("/");
      const line = part.length ? `${part.join("/")}: ${text}` : text;
      for (const fn of badges.get(rootId) ?? []) fn(line);
      console.warn(`[thing ${id}]`, text);
    },
    caption(id, text) {
      if (text) host.problem(id, text);
    },
    invalidate: deps.invalidate,
    occluders: deps.occluders,
  };

  const engine = new Engine(host, {
    camera: deps.camera,
    element: () => deps.gl.domElement,
    occluders: deps.occluders,
    me: deps.me,
    claim: (event) => claimPointer(event),
    invalidate: deps.invalidate,
    unlockAudio: () => {
      resumeRoomAudio();
      const context = THREE.AudioContext.getContext() as unknown as BaseAudioContext & { resume(): Promise<void> };
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    },
  });

  const stop = deps.subscribe((message) => {
    // Back from a dropped socket: what was missed while it was down, and what was set meanwhile.
    if (message.type === "welcome") void engine.bus.resync();
    if (message.type !== "spaceDeployed") return;
    listings.delete(`${message.space}@${message.branch}`);
    listings.delete(`${message.space}@`);
    for (const item of users.get(`${message.space}@${message.branch}`) ?? []) for (const fn of reloads.get(item) ?? []) fn();
  });

  const subscribeTo = (map: Map<string, Set<never>>) => <F>(rootId: string, fn: F) => {
    let set = map.get(rootId) as Set<F> | undefined;
    if (!set) {
      set = new Set();
      map.set(rootId, set as Set<never>);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  };

  let line: Promise<void> = Promise.resolve();
  const turn = () => {
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const mine = line.then(() => undefined);
    line = mine.then(() => Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, 20_000))]));
    return mine.then(() => release);
  };

  return {
    engine,
    turn,
    know: (url, source, item) => sources.set(url, { ...source, item }),
    onProblem: subscribeTo(badges as Map<string, Set<never>>),
    onReload: subscribeTo(reloads as Map<string, Set<never>>),
    dispose: () => {
      stop();
      engine.dispose();
    },
  };
}
