import * as THREE from "three";
import type { Hand, Input, Off, Person, PressEvent, StrikeEvent, Tip } from "./types";

/**
 * INPUT FOR THINGS, ONE PATH PER KIND OF POINTER (docs/things/DESIGN.md, 5),
 * so nothing ever fires twice:
 *
 *   - IN A HEADSET, @react-three/xr's ray, grab and touch pointers come from
 *     @pmndrs/pointer-events, which calls plain three.js listeners on the
 *     objects it hits. Only registered targets get listeners, so pointing past
 *     a big environment costs nothing and no mesh has its raycast touched.
 *   - WITH A MOUSE, the room's R3F events only reach objects with JSX
 *     handlers. So one capture listener above R3F's casts at the registered
 *     targets, and at R3F's own interactive objects as things in the way; when
 *     a thing's target is nearest, the pointer is the thing's.
 *   - STRIKES are physical: each hand's tip (a controller's grip, or a tracked
 *     index fingertip), read from the XRFrame, crossing a target's surface.
 */

/** Sill's curve (drums-math.js velocityFor): metres a second to 0..1. */
const MIN_SPEED = 0.35;
const FULL_SPEED = 3;
export const strikeStrength = (speed: number) => Math.max(0, Math.min(1, (speed - MIN_SPEED) / (FULL_SPEED - MIN_SPEED)));

/** Keys that belong to the room, never to a thing. */
const ROOMS_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "escape"]);
const FOCUS_MS = 30_000;

type WorldTip = { id: string; hand: Hand; kind: "controller" | "finger"; position: THREE.Vector3; previous: THREE.Vector3; velocity: THREE.Vector3 };

type Target = { object: THREE.Object3D; instance: InstanceInput; press: ((e: PressEvent) => void) | null; poke: boolean };

export type InputHubOptions = {
  camera: () => THREE.Camera;
  /** The element R3F listens on; the mouse is caught just above it. */
  element: () => HTMLElement | null;
  occluders?: () => THREE.Object3D[];
  me: () => Person | null;
  claim?: (native: Event) => void;
  invalidate?: () => void;
};

export type InstanceInput = Input & {
  /** A point in the room, in this thing's own frame. */
  toLocal(world: THREE.Vector3): THREE.Vector3;
  /** Every frame, after tips are read: strikes. */
  frame(dt: number): void;
  readonly focused: boolean;
  surround: boolean;
  dispose(): void;
};

/** One per page: the registry of targets, the mouse, the keys and the hands. */
export class InputHub {
  private readonly targets = new Map<THREE.Object3D, Target>();
  private readonly instances = new Set<InstanceInput>();
  private worldTips: WorldTip[] = [];
  private readonly caster = new THREE.Raycaster();
  private pending: { pointerId: number; target: Target; point: THREE.Vector3; x: number; y: number } | null = null;
  private readonly off: Array<() => void> = [];

  constructor(private readonly options: InputHubOptions) {
    this.listenForMouse();
    this.listenForKeys();
  }

  private listenForMouse(): void {
    const element = this.options.element();
    const above = element?.parentElement ?? element;
    if (!above || typeof window === "undefined") return;
    const ndc = new THREE.Vector2();
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !this.targets.size) return;
      const box = (element ?? above).getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
      ndc.set(((event.clientX - box.left) / box.width) * 2 - 1, -(((event.clientY - box.top) / box.height) * 2 - 1));
      this.caster.setFromCamera(ndc, this.options.camera());
      const hit = this.nearest(this.caster);
      if (!hit) return;
      this.options.claim?.(event);
      event.stopPropagation();
      this.pending = { pointerId: event.pointerId, target: hit.target, point: hit.point, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      const pending = this.pending;
      if (!pending || pending.pointerId !== event.pointerId) return;
      this.pending = null;
      event.stopPropagation();
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) return;
      this.fire(pending.target, pending.point, "mouse", null);
    };
    above.addEventListener("pointerdown", down, true);
    above.addEventListener("pointerup", up, true);
    this.off.push(() => {
      above.removeEventListener("pointerdown", down, true);
      above.removeEventListener("pointerup", up, true);
    });
  }

  /** The nearest registered target along a ray, unless something of the room's own is in front of it. */
  private nearest(caster: THREE.Raycaster): { target: Target; point: THREE.Vector3 } | null {
    const objects = [...this.targets.keys()].filter((object) => object.visible);
    const hits = caster.intersectObjects(objects, true);
    if (!hits.length) return null;
    const first = hits[0];
    const occluding = this.options.occluders?.() ?? [];
    if (occluding.length) {
      const blocker = caster.intersectObjects(occluding, true)[0];
      if (blocker && blocker.distance < first.distance) return null;
    }
    for (let at: THREE.Object3D | null = first.object; at; at = at.parent) {
      const target = this.targets.get(at);
      if (target) return { target, point: first.point.clone() };
    }
    return null;
  }

  private listenForKeys(): void {
    if (typeof window === "undefined") return;
    const key = (down: boolean) => (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      const name = event.key.toLowerCase();
      if (typing || event.repeat || ROOMS_KEYS.has(name) || event.metaKey || event.ctrlKey || event.altKey) return;
      for (const instance of this.instances) (instance as InstanceInputImpl).key(name, down);
    };
    const keydown = key(true);
    const keyup = key(false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    this.off.push(() => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    });
  }

  /** A press arrived (mouse, ray, poke): world point in, local point out. */
  fire(target: Target, worldPoint: THREE.Vector3, pointer: PressEvent["pointer"], hand: Hand | null): void {
    target.press?.({ object: target.object, point: target.instance.toLocal(worldPoint.clone()), pointer, hand, by: this.options.me() });
    (target.instance as InstanceInputImpl).focus();
    this.options.invalidate?.();
  }

  register(target: Target): Off {
    this.targets.set(target.object, target);
    // In a headset: pmndrs calls plain three.js listeners (see the top of this file).
    const listener = (event: { pointerType?: string; point?: THREE.Vector3; pointerState?: { inputSource?: XRInputSource } }) => {
      const kind = event.pointerType ?? "ray";
      if (kind === "touch" && !target.poke) return;
      const hand = event.pointerState?.inputSource?.handedness;
      const point = event.point ?? target.object.getWorldPosition(new THREE.Vector3());
      this.fire(target, point, kind === "touch" ? "poke" : kind === "grab" ? "grab" : "ray", hand === "left" || hand === "right" ? hand : null);
    };
    target.object.addEventListener("click" as never, listener as never);
    return () => {
      target.object.removeEventListener("click" as never, listener as never);
      if (this.targets.get(target.object) === target) this.targets.delete(target.object);
    };
  }

  /** Every frame, before things run: where each hand's tip is, in the room. */
  readTips(frame: XRFrame | null | undefined, referenceSpace: XRReferenceSpace | null, origin: THREE.Object3D | null): void {
    if (!frame || !referenceSpace) {
      this.worldTips = [];
      return;
    }
    const before = new Map(this.worldTips.map((tip) => [tip.id, tip]));
    const next: WorldTip[] = [];
    const matrix = new THREE.Matrix4();
    for (const source of frame.session.inputSources) {
      if (source.handedness !== "left" && source.handedness !== "right") continue;
      const finger = source.hand?.get("index-finger-tip");
      const space = finger ?? source.gripSpace;
      if (!space) continue;
      const pose = finger ? frame.getJointPose?.(finger, referenceSpace) : frame.getPose(space, referenceSpace);
      if (!pose) continue;
      const position = new THREE.Vector3().setFromMatrixPosition(matrix.fromArray(pose.transform.matrix));
      if (origin) position.applyMatrix4(origin.matrixWorld);
      const id = `${source.handedness}:${finger ? "finger" : "controller"}`;
      const last = before.get(id);
      const previous = last ? last.position.clone() : position.clone();
      next.push({ id, hand: source.handedness, kind: finger ? "finger" : "controller", position, previous, velocity: new THREE.Vector3() });
    }
    this.worldTips = next;
  }

  get tips(): readonly WorldTip[] {
    return this.worldTips;
  }

  /** Who is here, pressing. */
  me(): Person | null {
    return this.options.me();
  }

  /** A pulse in the hand's controller, when it has one. */
  pulse(frameSession: XRSession | null | undefined, hand: Hand, strength: number, ms: number): void {
    for (const source of frameSession?.inputSources ?? []) {
      if (source.handedness !== hand || !source.gamepad) continue;
      // Quest browsers have hapticActuators[0].pulse; others vibrationActuator.playEffect (Sill's path).
      const actuators = (source.gamepad as unknown as { hapticActuators?: Array<{ pulse?: (v: number, ms: number) => unknown }> }).hapticActuators;
      const vibration = (source.gamepad as unknown as { vibrationActuator?: { playEffect?: (type: string, p: unknown) => unknown } }).vibrationActuator;
      const level = Math.max(0, Math.min(1, strength));
      const pulse = actuators?.[0]?.pulse;
      if (typeof pulse === "function") void pulse.call(actuators![0], level, ms);
      else void vibration?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: level, weakMagnitude: level });
    }
  }

  /** The input of one instance, rooted at `root`. */
  forInstance(root: THREE.Object3D, options: { model: boolean }): InstanceInput {
    const instance = new InstanceInputImpl(this, root, options.model);
    this.instances.add(instance);
    instance.onDispose = () => this.instances.delete(instance);
    return instance;
  }

  dispose(): void {
    for (const off of this.off.splice(0)) off();
  }
}

class InstanceInputImpl implements InstanceInput {
  private readonly offs = new Set<Off>();
  private readonly strikes = new Map<THREE.Object3D, (e: StrikeEvent) => void>();
  private readonly armed = new Map<string, boolean>();
  private readonly lastStrike = new Map<THREE.Object3D, number>();
  private readonly keyHandlers: Array<{ keys: Set<string>; fn: (key: string, down: boolean) => void }> = [];
  private focusedAt = -Infinity;
  private localTips: Tip[] = [];
  private readonly caster = new THREE.Raycaster();
  surround = false;
  onDispose: () => void = () => undefined;

  constructor(private readonly hub: InputHub, private readonly root: THREE.Object3D, private readonly model: boolean) {}

  toLocal(world: THREE.Vector3): THREE.Vector3 {
    return this.root.worldToLocal(world);
  }

  focus(): void {
    this.focusedAt = performance.now();
  }

  get focused(): boolean {
    return this.surround || performance.now() - this.focusedAt < FOCUS_MS;
  }

  key(name: string, down: boolean): void {
    if (!this.focused) return;
    for (const handler of this.keyHandlers) if (handler.keys.has(name)) handler.fn(name, down);
  }

  press(target: THREE.Object3D, fn: (e: PressEvent) => void, options: { poke?: boolean } = {}): Off {
    const off = this.hub.register({ object: target, instance: this, press: fn, poke: options.poke !== false });
    this.offs.add(off);
    return () => {
      off();
      this.offs.delete(off);
    };
  }

  strike(target: THREE.Object3D, fn: (e: StrikeEvent) => void): Off {
    this.strikes.set(target, fn);
    // A click or a ray counts as 0.7; a poke is a strike's own business (below), so not here too.
    const offPress = this.press(target, (e) => fn({ ...e, strength: 0.7 }), { poke: false });
    return () => {
      offPress();
      this.strikes.delete(target);
    };
  }

  keys(keys: string, fn: (key: string, down: boolean) => void): Off {
    const handler = { keys: new Set(keys.toLowerCase().split("")), fn };
    this.keyHandlers.push(handler);
    return () => {
      const at = this.keyHandlers.indexOf(handler);
      if (at >= 0) this.keyHandlers.splice(at, 1);
    };
  }

  get tips(): readonly Tip[] {
    return this.localTips;
  }

  frame(dt: number): void {
    if (this.model) {
      this.localTips = [];
      return;
    }
    const inverse = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.localTips = this.hub.tips.map((tip) => {
      const position = tip.position.clone().applyMatrix4(inverse);
      const previous = tip.previous.clone().applyMatrix4(inverse);
      return { id: tip.id, hand: tip.hand, kind: tip.kind, position, previous, velocity: position.clone().sub(previous).divideScalar(Math.max(dt, 1e-3)) };
    });
    if (!this.strikes.size) return;
    const now = performance.now();
    for (const tip of this.hub.tips) {
      const travel = tip.position.clone().sub(tip.previous);
      const length = travel.length();
      const speed = length / Math.max(dt, 1e-3);
      for (const [target, fn] of this.strikes) {
        const key = `${tip.id}|${target.uuid}`;
        const armed = this.armed.get(key) ?? true;
        if (length < 1e-4) continue;
        this.caster.set(tip.previous, travel.clone().normalize());
        this.caster.far = length;
        const hit = this.caster.intersectObject(target, true)[0];
        if (hit && armed && speed >= MIN_SPEED && now - (this.lastStrike.get(target) ?? -Infinity) > 250) {
          this.armed.set(key, false);
          this.lastStrike.set(target, now);
          this.focus();
          fn({ object: target, point: this.root.worldToLocal(hit.point.clone()), pointer: "poke", hand: tip.hand, by: this.hub.me(), strength: strikeStrength(speed) });
        } else if (!hit && !armed) {
          // Re-armed once the tip is 3 cm clear of the surface.
          const box = new THREE.Box3().setFromObject(target).expandByScalar(0.03);
          if (!box.containsPoint(tip.position)) this.armed.set(key, true);
        }
      }
    }
  }

  dispose(): void {
    for (const off of [...this.offs]) off();
    this.offs.clear();
    this.strikes.clear();
    this.keyHandlers.length = 0;
    this.onDispose();
  }
}
