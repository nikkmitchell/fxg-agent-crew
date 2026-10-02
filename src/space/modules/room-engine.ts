import * as THREE from "three";
import type { ClientMessage, ServerMessage } from "../../../shared/space-wire";
import { bff, type SpaceModules } from "../../bff-client";
import { space } from "../../space-client";
import type { Host, Resolved, TransportEvent } from "../../engine/host";
import { Engine } from "../../engine/instance";
import type { EnvSettings, Json, Person } from "../../engine/types";
import { claimPointer } from "../pointer-claim";

/**
 * THE SAHA.ING ROOM, AS A HOST FOR THINGS (src/engine/host.ts): what the
 * engine needs, made from what the room already has. Shared values and
 * moments ride the room's own socket (moduleState / moduleEvent), stamped by
 * the server; refs resolve through the Library's listings; surroundings are
 * the room's scene and camera; problems go to the badge of the thing they
 * belong to.
 */

const REF = /^(?:([a-z0-9][a-z0-9._-]{0,63})\/)?([a-z0-9][a-z0-9_-]{0,31})(?:@([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?$/;

export type RoomEngine = {
  engine: Engine;
  /** Where a module came from, so a space's "drums" means its own repo's drums. */
  know(url: string, source: { space: string; branch: string }): void;
  /** What a branch offers now (shared with ModuleItems' own listing). */
  listing(spaceName: string, branch?: string): Promise<SpaceModules>;
  /** A thing's badge: problems for its id and its parts' ids. */
  onProblem(rootId: string, fn: (text: string) => void): () => void;
  forgetListing(spaceName: string, branch: string): void;
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
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  reducedMotion: boolean;
}): RoomEngine {
  const sources = new Map<string, { space: string; branch: string }>();
  const listings = new Map<string, Promise<SpaceModules>>();
  const badges = new Map<string, Set<(text: string) => void>>();
  const listing = (spaceName: string, branch?: string) => {
    const key = `${spaceName}@${branch ?? ""}`;
    let found = listings.get(key);
    if (!found) {
      found = bff.spaceModules(spaceName, branch);
      found.catch(() => listings.delete(key));
      listings.set(key, found);
    }
    return found;
  };

  const host: Host = {
    name: "room",
    final: false,
    transport: {
      values: (id) => space.moduleState(id).then((answer) => answer.state as Record<string, Json>),
      set: (item, key, value) => deps.send({ type: "moduleState", item, key, value }),
      moment: (item, name, data) => deps.send({ type: "moduleEvent", item, name, data }),
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
    reducedMotion: deps.reducedMotion,
    async resolve(ref, from): Promise<Resolved | null> {
      const match = REF.exec(ref);
      if (!match) return null;
      const here = sources.get(from);
      const spaceName = match[1] ?? here?.space;
      if (!spaceName) return null;
      const branch = match[3] ?? (match[1] ? undefined : here?.branch);
      const found = await listing(spaceName, branch).catch(() => null);
      const entry = found?.modules.find((module) => module.id === match[2]);
      if (!found || !entry) return null;
      const url = new URL(entry.url, window.location.origin).href;
      sources.set(url, { space: found.space, branch: found.branch });
      return { url, exportName: entry.export, kind: entry.kind };
    },
    importModule: (url) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>,
    applyEnv(settings: Partial<EnvSettings>) {
      const scene = deps.scene;
      const camera = deps.camera() as THREE.PerspectiveCamera;
      const before = { background: scene.background, fog: scene.fog, far: camera.far, exposure: deps.gl.toneMappingExposure };
      if (settings.background !== undefined) {
        scene.background = settings.background === null ? null : settings.background instanceof THREE.Texture ? settings.background : new THREE.Color(settings.background);
      }
      if (settings.fog !== undefined) {
        const fog = settings.fog;
        scene.fog = fog === null ? null : "density" in fog ? new THREE.FogExp2(fog.color, fog.density) : new THREE.Fog(fog.color, fog.near, fog.far);
      }
      if (settings.far !== undefined) {
        camera.far = settings.far;
        camera.updateProjectionMatrix();
      }
      if (settings.exposure !== undefined) deps.gl.toneMappingExposure = settings.exposure;
      deps.invalidate();
      return () => {
        scene.background = before.background;
        scene.fog = before.fog;
        camera.far = before.far;
        camera.updateProjectionMatrix();
        deps.gl.toneMappingExposure = before.exposure;
        deps.invalidate();
      };
    },
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
  });

  return {
    engine,
    know: (url, source) => sources.set(url, source),
    listing,
    forgetListing: (spaceName, branch) => {
      listings.delete(`${spaceName}@${branch}`);
      listings.delete(`${spaceName}@`);
    },
    onProblem(rootId, fn) {
      let set = badges.get(rootId);
      if (!set) {
        set = new Set();
        badges.set(rootId, set);
      }
      set.add(fn);
      return () => set!.delete(fn);
    },
    dispose: () => engine.dispose(),
  };
}
