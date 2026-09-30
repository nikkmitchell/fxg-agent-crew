import * as THREE from "three";
import {
  PIECE_API,
  PIECE_LIMITS,
  PieceBudget,
  readPieceOp,
  resolveOwn,
  type NodeSpec,
  type PiecePerson,
  type PieceSound,
  type PieceTween,
  type Vec3,
} from "../../../shared/piece-wire";
import { pieceWorkerSource } from "./runtime-source";

/**
 * THE PAGE'S SIDE OF A LIVE PIECE (shared/piece-wire.ts has the why): it
 * starts the piece's worker, checks every message, and draws the piece into
 * `group`, which the page places wherever the piece stands. Plain three.js, so
 * the saha.ing room (react-three-fiber) and the kit in a space's page (plain
 * three) host pieces with the very same code.
 *
 * The page calls `tick()` every frame (tweens, spins, the watchdog), `press()`
 * when somebody presses one of `pressables()`, and hands on what other people
 * set and emit with `receiveState` / `receiveEvent`. What the piece shares
 * leaves through `share`, which the page sends to everyone else.
 */

export type WorkerLike = {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type PieceAudio = {
  tone(sound: Required<Pick<PieceSound, "tone" | "ms" | "wave" | "gain">>): void;
  sample(url: string, gain: number): void;
};

export type PieceHostOptions = {
  /** The piece's module, absolute (…/s/<space>/…/piece.js). */
  url: string;
  space: string;
  env: "room" | "space";
  you: PiecePerson | null;
  /** This piece's shared values as they are now. */
  state?: Record<string, unknown>;
  /** How the piece's shared values and moments reach everyone else. */
  share: { set(key: string, value: unknown): void; emit(name: string, data: unknown): void };
  /** Loads a model of the piece's own space; absent, a model is drawn as a small box. */
  loadModel?: (url: string) => Promise<THREE.Object3D>;
  /** Draws a line of text; absent, text is left out. */
  makeText?: (text: string, size: number, color: string) => THREE.Object3D;
  audio?: PieceAudio | null;
  /** What the piece logs, and why it stopped, for whoever is building it. */
  onLog?: (text: string) => void;
  onProblem?: (text: string) => void;
  /** Tests start the runtime in-process; the page starts a real worker. */
  startWorker?: () => WorkerLike;
  now?: () => number;
};

type Part = {
  id: number;
  object: THREE.Object3D;
  mesh: THREE.Mesh | null;
  spec: NodeSpec;
  children: Set<number>;
  parent: number | null;
  /** What it is has been made (a shape, model or text); moving it does not make it again. */
  built: boolean;
  /** It holds one of the piece's PIECE_LIMITS.models. */
  holdsModel: boolean;
};

/** A part's own objects: everything under it except the parts standing on it. */
function ownObjects(part: Part, visit: (object: THREE.Object3D) => void): void {
  const walk = (object: THREE.Object3D) => {
    visit(object);
    for (const child of object.children) if (child.userData.piecePart === undefined) walk(child);
  };
  for (const child of part.object.children) if (child.userData.piecePart === undefined) walk(child);
}
type Tween = { part: Part; from: PieceTween; to: PieceTween; start: number; ms: number };

const noRaycast = () => undefined;

/** A real worker from a data: URL: the browser gives it an opaque origin of its own. */
export function startPieceWorker(): WorkerLike {
  const source = pieceWorkerSource();
  return new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`, { type: "module" }) as unknown as WorkerLike;
}

function geometryFor(spec: NodeSpec): THREE.BufferGeometry {
  const s = spec.size ?? [];
  const n = (index: number, fallback: number) => s[index] ?? fallback;
  switch (spec.shape) {
    case "sphere":
      return new THREE.SphereGeometry(n(0, 0.05), 24, 16);
    case "cylinder":
      return s.length >= 3 ? new THREE.CylinderGeometry(n(0, 0.05), n(1, 0.05), n(2, 0.1), 24) : new THREE.CylinderGeometry(n(0, 0.05), n(0, 0.05), n(1, 0.1), 24);
    case "cone":
      return new THREE.ConeGeometry(n(0, 0.05), n(1, 0.1), 24);
    case "torus":
      return new THREE.TorusGeometry(n(0, 0.08), n(1, 0.02), 12, 32);
    case "plane":
      return new THREE.PlaneGeometry(n(0, 0.2), n(1, 0.2));
    case "ring":
      return new THREE.RingGeometry(n(0, 0.04), Math.max(n(1, 0.08), n(0, 0.04) + 0.001), 32);
    default:
      return new THREE.BoxGeometry(n(0, 0.1), n(1, s.length === 1 ? n(0, 0.1) : 0.1), n(2, s.length === 1 ? n(0, 0.1) : 0.1));
  }
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

export class PieceHost {
  readonly group = new THREE.Group();
  private readonly worker: WorkerLike;
  private readonly parts = new Map<number, Part>();
  private readonly tweens = new Map<number, Tween>();
  private readonly budget: PieceBudget;
  private readonly sounds: PieceBudget;
  private readonly now: () => number;
  private models = 0;
  private pinged = 0;
  private answered: number;
  private lastPing = 0;
  private overBudgetSaid = false;
  private stopped = false;
  ready = false;

  constructor(private readonly options: PieceHostOptions) {
    this.now = options.now ?? (() => performance.now());
    this.budget = new PieceBudget(PIECE_LIMITS.perSecond, this.now);
    this.sounds = new PieceBudget(PIECE_LIMITS.soundsPerSecond, this.now);
    this.answered = this.now();
    this.group.name = `piece ${options.url}`;
    this.worker = (options.startWorker ?? startPieceWorker)();
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = () => this.stop("The piece's worker could not start (is it a JavaScript module?).");
    this.post({ t: "start", api: PIECE_API, url: options.url, env: options.env, space: options.space, you: options.you, state: options.state ?? {} });
  }

  private post(message: unknown): void {
    if (!this.stopped) this.worker.postMessage(message);
  }

  /** A message from the piece, checked. Anything else is dropped. */
  receive(raw: unknown): void {
    if (this.stopped) return;
    if (!this.budget.take()) {
      if (!this.overBudgetSaid) this.options.onProblem?.(`The piece sent more than ${PIECE_LIMITS.perSecond} messages a second; the rest are dropped. Use tween or spin to animate.`);
      this.overBudgetSaid = true;
      return;
    }
    const op = readPieceOp(raw);
    if (!op) return;
    switch (op.t) {
      case "add":
        return this.add(op.id, op.spec);
      case "set": {
        const part = this.parts.get(op.id);
        if (part) this.change(part, op.spec);
        return;
      }
      case "remove": {
        const part = this.parts.get(op.id);
        if (part) this.remove(part);
        return;
      }
      case "tween": {
        const part = this.parts.get(op.id);
        if (part) this.tween(part, op.to, op.ms);
        return;
      }
      case "sound":
        return this.sound(op.sound);
      case "state":
        return this.options.share.set(op.k, op.v);
      case "emit":
        return this.options.share.emit(op.name, op.data);
      case "log":
        return this.options.onLog?.(op.text);
      case "failed":
        this.options.onProblem?.(`The piece did not start: ${op.text}`);
        return;
      case "ready":
        this.ready = true;
        return;
      case "pong":
        this.answered = this.now();
        return;
    }
  }

  private add(id: number, spec: NodeSpec): void {
    if (this.parts.has(id)) return;
    if (this.parts.size >= PIECE_LIMITS.nodes) {
      this.options.onProblem?.(`A piece can have ${PIECE_LIMITS.nodes} parts at once; more are left out.`);
      return;
    }
    const holder = new THREE.Group();
    const parent = spec.parent !== undefined ? this.parts.get(spec.parent) ?? null : null;
    const part: Part = { id, object: holder, mesh: null, spec: {}, children: new Set(), parent: parent?.id ?? null, built: false, holdsModel: false };
    holder.userData.piecePart = id;
    (parent?.object ?? this.group).add(holder);
    parent?.children.add(id);
    this.parts.set(id, part);
    this.change(part, spec);
  }

  /** Apply a description: rebuild what changed shape, move and colour the rest. */
  private change(part: Part, spec: NodeSpec): void {
    const before = part.spec;
    const next: NodeSpec = { ...before, ...spec };
    part.spec = next;
    const rebuild = spec.shape !== undefined || spec.size !== undefined || spec.model !== undefined || spec.text !== undefined || spec.textSize !== undefined
      || (spec.color !== undefined && next.text !== undefined && next.shape === undefined && next.model === undefined);
    if (rebuild || !part.built) this.build(part);
    else this.paint(part);
    const object = part.object;
    if (spec.at) object.position.set(...spec.at);
    if (spec.turn) object.rotation.set(...spec.turn);
    if (spec.scale !== undefined) typeof spec.scale === "number" ? object.scale.setScalar(spec.scale) : object.scale.set(...spec.scale);
    if (spec.visible !== undefined) object.visible = spec.visible;
    if (spec.pressable !== undefined) this.aim(part);
  }

  /** What the part IS: a shape, a model, a line of text (or nothing but a holder for others). */
  private build(part: Part): void {
    const spec = part.spec;
    for (const child of [...part.object.children]) {
      if (child.userData.piecePart !== undefined) continue;
      part.object.remove(child);
      disposeTree(child);
    }
    part.mesh = null;
    part.built = true;
    if (part.holdsModel) {
      part.holdsModel = false;
      this.models -= 1;
    }
    if (spec.model) {
      const url = resolveOwn(this.options.url, spec.model);
      if (!url || !this.options.loadModel || this.models >= PIECE_LIMITS.models) {
        if (url && this.models >= PIECE_LIMITS.models) this.options.onProblem?.(`A piece can load ${PIECE_LIMITS.models} models at once.`);
        this.shape(part, { ...spec, shape: "box", size: [0.08] });
        return;
      }
      this.models += 1;
      part.holdsModel = true;
      const wanted = spec.model;
      this.options.loadModel(url).then(
        (model) => {
          if (this.stopped || !this.parts.has(part.id) || part.spec.model !== wanted) {
            disposeTree(model);
            return;
          }
          part.object.add(model);
          this.aim(part);
        },
        () => this.options.onProblem?.(`Could not load ${wanted}.`),
      );
      return;
    }
    if (spec.text !== undefined && spec.shape === undefined) {
      const words = this.options.makeText?.(spec.text, spec.textSize ?? 0.05, spec.color ?? "#ffffff");
      if (words) {
        part.object.add(words);
        this.aim(part);
      }
      return;
    }
    if (spec.shape) this.shape(part, spec);
  }

  private shape(part: Part, spec: NodeSpec): void {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, side: spec.shape === "plane" || spec.shape === "ring" ? THREE.DoubleSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(geometryFor(spec), material);
    part.object.add(mesh);
    part.mesh = mesh;
    this.paint(part);
    this.aim(part);
  }

  private paint(part: Part): void {
    const material = part.mesh?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) return;
    const spec = part.spec;
    material.color.set(spec.color ?? "#cccccc");
    material.emissive.set(spec.emissive ?? "#000000");
    const opacity = spec.opacity ?? 1;
    material.opacity = opacity;
    material.transparent = opacity < 1;
  }

  /** Only a pressable part catches a pointer; the rest let it pass to whatever is behind. */
  private aim(part: Part): void {
    const pressable = part.spec.pressable === true;
    ownObjects(part, (child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      // An own property shadows the prototype's raycast; deleting it restores it.
      if (pressable) delete (child as { raycast?: unknown }).raycast;
      else child.raycast = noRaycast;
    });
  }

  private remove(part: Part): void {
    for (const child of [...part.children]) {
      const inner = this.parts.get(child);
      if (inner) this.remove(inner);
    }
    if (part.holdsModel) this.models -= 1;
    part.object.parent?.remove(part.object);
    disposeTree(part.object);
    this.parts.delete(part.id);
    this.tweens.delete(part.id);
    if (part.parent !== null) this.parts.get(part.parent)?.children.delete(part.id);
  }

  private tween(part: Part, to: PieceTween, ms: number): void {
    const object = part.object;
    const material = part.mesh?.material as THREE.MeshStandardMaterial | undefined;
    const from: PieceTween = {
      at: [object.position.x, object.position.y, object.position.z],
      turn: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: [object.scale.x, object.scale.y, object.scale.z],
      color: material ? `#${material.color.getHexString()}` : undefined,
      opacity: material?.opacity,
    };
    if (ms <= 0) {
      this.change(part, to);
      return;
    }
    this.tweens.set(part.id, { part, from, to, start: this.now(), ms });
  }

  private sound(sound: PieceSound): void {
    const audio = this.options.audio;
    if (!audio || !this.sounds.take()) return;
    const gain = sound.gain ?? 0.25;
    if (sound.tone !== undefined) audio.tone({ tone: sound.tone, ms: sound.ms ?? 300, wave: sound.wave ?? "sine", gain });
    if (sound.url) {
      const url = resolveOwn(this.options.url, sound.url);
      if (url) audio.sample(url, gain);
    }
  }

  /** Every frame: tweens and spins move, and a piece that stops answering is stopped. */
  tick(seconds: number): void {
    if (this.stopped) return;
    const now = this.now();
    for (const [id, tween] of this.tweens) {
      const k = Math.min(1, (now - tween.start) / tween.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const object = tween.part.object;
      const mix = (a: Vec3 | number | undefined, b: Vec3 | number | undefined): Vec3 | undefined => {
        if (b === undefined || a === undefined) return undefined;
        const va: Vec3 = typeof a === "number" ? [a, a, a] : a;
        const vb: Vec3 = typeof b === "number" ? [b, b, b] : b;
        return [va[0] + (vb[0] - va[0]) * e, va[1] + (vb[1] - va[1]) * e, va[2] + (vb[2] - va[2]) * e];
      };
      const at = mix(tween.from.at, tween.to.at);
      if (at) object.position.set(...at);
      const turn = mix(tween.from.turn, tween.to.turn);
      if (turn) object.rotation.set(...turn);
      const scale = mix(tween.from.scale, tween.to.scale);
      if (scale) object.scale.set(...scale);
      const material = tween.part.mesh?.material as THREE.MeshStandardMaterial | undefined;
      if (material && tween.to.color && tween.from.color) material.color.set(tween.from.color).lerp(new THREE.Color(tween.to.color), e);
      if (material && tween.to.opacity !== undefined && tween.from.opacity !== undefined) {
        material.opacity = tween.from.opacity + (tween.to.opacity - tween.from.opacity) * e;
        material.transparent = material.opacity < 1;
      }
      if (k >= 1) {
        this.tweens.delete(id);
        tween.part.spec = { ...tween.part.spec, ...tween.to };
      }
    }
    for (const part of this.parts.values()) if (part.spec.spin) part.object.rotation.y += part.spec.spin * seconds;
    if (now - this.lastPing >= 1000) {
      this.lastPing = now;
      this.post({ t: "ping", n: ++this.pinged });
    }
    if (now - this.answered > PIECE_LIMITS.silentMs) this.stop(`The piece stopped answering for ${PIECE_LIMITS.silentMs / 1000} seconds, so it was stopped.`);
  }

  /** The objects a pointer may press. */
  pressables(): THREE.Object3D[] {
    return [...this.parts.values()].filter((part) => part.spec.pressable).map((part) => part.object);
  }

  /**
   * Somebody pressed `object` (or something inside it) at `worldPoint`. Returns
   * whether it belonged to a pressable part of this piece.
   */
  press(object: THREE.Object3D, by: PiecePerson | null, hand: "left" | "right" | "pointer", worldPoint?: THREE.Vector3): boolean {
    if (this.stopped) return false;
    let at: THREE.Object3D | null = object;
    while (at && at !== this.group) {
      const id = at.userData.piecePart as number | undefined;
      const part = id === undefined ? undefined : this.parts.get(id);
      if (part?.spec.pressable) {
        const local = worldPoint ? this.group.worldToLocal(worldPoint.clone()) : new THREE.Vector3();
        this.post({ t: "press", id: part.id, by, hand, point: [local.x, local.y, local.z] });
        return true;
      }
      at = at.parent;
    }
    return false;
  }

  receiveState(key: string, value: unknown, by: string | null): void {
    this.post({ t: "state", k: key, v: value, by });
  }

  receiveEvent(name: string, data: unknown, from: string | null): void {
    this.post({ t: "event", name, data, from });
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** Stop the piece and take everything it drew away. */
  stop(why?: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.terminate();
    for (const part of [...this.parts.values()]) if (part.parent === null) this.remove(part);
    this.group.parent?.remove(this.group);
    if (why) this.options.onProblem?.(why);
  }
}
