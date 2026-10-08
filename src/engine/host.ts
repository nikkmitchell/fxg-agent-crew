import type * as THREE from "three";
import type { EnvLayer } from "./env";
import type { AskRefusal, AskResult, BookPage, BookSearch, BookShelf, Json, Person, QuestionPage, ReviewFinding, ReviewRound, ReviewVariant } from "./types";

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
  /** Change the room this page is in, in place (ctx.rooms.go). A host without it answers "not-here". */
  readonly goToRoom?: (room: string) => Promise<void>;
  /** Gutenberg's books (ctx.books). A host without them answers "not-here". */
  readonly books?: { shelf(n: number, order: "popular" | "title"): Promise<BookShelf>; read(id: number, page: number): Promise<BookPage>; search(query: string, cursor: string | null): Promise<BookSearch> };
  /** Review rounds (ctx.reviews). A host without them answers "not-here". */
  readonly reviews?: ReviewHost;
  /** The room's writing panel for a thing's own query (ctx.ui.query). */
  readonly query?: (instance: string, options: { title?: string; initial?: string; near?: THREE.Object3D }) => { result: Promise<{ status: "ok"; text: string } | { status: "cancelled" | "busy" | "removed" | "signed-out" }>; close(): void };
}

/**
 * Where ctx.questions goes. The HOST writes and sends, so a thing cannot make
 * up a question in someone's name: it can only open the panel they type in.
 */
export interface QuestionHost {
  /** Open the writing panel for this instance; `close` is called if the thing goes first. */
  ask(instance: string, options: { prompt?: string; near?: THREE.Object3D; voice?: boolean; to?: string }): { result: Promise<AskResult>; close(): void };
  list(instance: string, options: { mine?: boolean; limit?: number; cursor?: string | null }): Promise<QuestionPage>;
}

/** Where ctx.reviews goes: the board's taking, the room's panel for findings, a version opened for this viewer. */
export interface ReviewHost {
  list(options: { cursor?: string | null; limit?: number }): Promise<{ rounds: ReviewRound[]; next: string | null }>;
  accept(id: string): Promise<{ ok: true } | { ok: false; why: string }>;
  decline(id: string): Promise<{ ok: true } | { ok: false; why: string }>;
  submit(instance: string, id: string, options: { variant: ReviewVariant; near?: THREE.Object3D }): { result: Promise<{ ok: true; finding: ReviewFinding } | { ok: false; why: AskRefusal; message: string }>; close(): void };
  findings(id: string, options: { cursor?: string | null; limit?: number }): Promise<{ findings: ReviewFinding[]; next: string | null }>;
  open(id: string, variant: ReviewVariant): Promise<{ ok: true } | { ok: false; why: string }>;
  back(): void;
  request(instance: string, options: { project: string; space: string; entry: string; mode: "item" | "full" | "model"; candidate: string; baseline?: string | null; checklist: string[]; near?: THREE.Object3D }): { result: Promise<{ ok: true; round: ReviewRound } | { ok: false; why: AskRefusal; message: string }>; close(): void };
}
