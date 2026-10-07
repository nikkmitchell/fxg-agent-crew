import type * as THREE from "three";
import type { EnvLayer } from "./env";
import type { AskResult, Json, Person, QuestionPage } from "./types";

/**
 * WHAT THE ENGINE NEEDS FROM WHEREVER IT RUNS (docs/things/DESIGN.md): the
 * saha.ing room (src/space/engine/room-host.ts), a thing's own page (the kit),
 * or a test. Narrow on purpose: everything a thing can reach goes through
 * here, so a sandbox can later sit in this seam without a thing noticing.
 */

/** What arrives for an instance from its copies elsewhere. */
export type TransportEvent =
  | { type: "value"; instance: string; key: string; value: Json; by: string | null }
  | { type: "moment"; instance: string; name: string; data: Json; from: string | null };

/** Shared values and moments between every copy of an instance (phase 1: the room's relay). */
export interface Transport {
  /** What an instance has decided so far, for a copy that is starting. */
  values(instance: string): Promise<Record<string, Json>>;
  /** False when it could not be sent now (the socket is down): the bus sends it again on resync. */
  set(instance: string, key: string, value: Json): boolean | void;
  moment(instance: string, name: string, data: Json): void;
  /** Why this key or name and value cannot travel (the relay's limits), or null. Refused writes stay local to nobody. */
  check?(instance: string, name: string, value: Json): string | null;
  subscribe(listener: (event: TransportEvent) => void): () => void;
}

/** Where a ref leads: a module at a pinned address, and the function to call when it is not a thing. */
export type Resolved = { url: string; exportName: string | null; kind: "item" | "environment" | "space" };

export interface Host {
  readonly name: "room" | "site" | "test";
  readonly final: boolean;
  readonly transport: Transport;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly renderer: THREE.WebGLRenderer | null;
  readonly me: Person | null;
  people(): readonly Person[];
  /** Server milliseconds. */
  now(): number;
  readonly reducedMotion: boolean;
  /** A ref ("drums", "xr.instruments/drums", "...@branch") from a thing at `from` (its module url). */
  resolve(ref: string, from: string): Promise<Resolved | null>;
  importModule(url: string): Promise<Record<string, unknown>>;
  /** One thing's layer of the room's surroundings (env.ts): set it, and remove it when the thing goes. */
  envLayer(): EnvLayer;
  /** A line for whoever is building, on the thing's badge. */
  problem(instance: string, text: string): void;
  caption(instance: string, text: string | null): void;
  /** Something changed: a host that draws on demand draws again. */
  invalidate(): void;
  /** R3F's own interactive objects, which stand between a pointer and a thing (the desktop mouse). */
  occluders?(): THREE.Object3D[];
  /** Questions for a thing's space (ctx.questions). A host without them answers "not-here". */
  readonly questions?: QuestionHost;
}

/**
 * Where ctx.questions goes. The HOST writes and sends, so a thing cannot make
 * up a question in someone's name: it can only open the panel they type in.
 */
export interface QuestionHost {
  /** Open the writing panel for this instance; `close` is called if the thing goes first. */
  ask(instance: string, options: { prompt?: string; near?: THREE.Object3D }): { result: Promise<AskResult>; close(): void };
  list(instance: string, options: { mine?: boolean; limit?: number; cursor?: string | null }): Promise<QuestionPage>;
}
