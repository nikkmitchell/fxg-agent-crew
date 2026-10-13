import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { Ray, Vec3 } from "../../shared/grab-move";
import { space } from "../space-client";
import { grabHold } from "./grab-hold";
import { claimPointer } from "./pointer-claim";

/**
 * ONE GRAB, FOR EVERYTHING IN THE ROOM THAT IS PICKED UP AND MOVED.
 *
 * Panels (Movable.tsx), the Go table and things from spaces (use-carry.ts) each
 * had their own copy of this, line for line, and Nikk could feel them drifting
 * apart: "the movement for objects or other things, it happens differently in
 * many places" (2026-10-14). What every one of them needs, and gets from here:
 *
 * - THE WINDOW LISTENS FROM THE MOMENT OF THE GRAB, not from the next render. A
 *   flick of a controller is faster than React, and a drag that starts and ends
 *   inside that gap never got a single move; the Go table simply did not move.
 * - STEERED FROM R3F TOO. A headset produces no window pointer events at all,
 *   only R3F's own, so every handle steers and lets go by both roads
 *   (headset-drag.test.ts holds every handle to it).
 * - LET GO EXACTLY ONCE. A mouse delivers the release twice — the window's and
 *   the handle's — and a panel used to be saved twice per drag.
 * - ONE POINTER. A headset has two; the other hand brushing the thing mid-drag
 *   must not take it over.
 * - ONE CARRIER AT A TIME (grab-hold.ts). The claim is taken at once in the
 *   background and let go only after the save lands; if somebody else has it,
 *   the grab ends in your hand and `refused` says who.
 *
 * - NEARER AND FURTHER, the one direction a ray cannot point. The mouse wheel,
 *   and in a headset the thumbstick pushed forward or pulled back while you
 *   hold — which only the settings menu had (Nikk, 6213), so a panel or a
 *   table could not be pushed away at all in a headset. Both arrive as metres.
 *   The stick's forward axis is free here: walking is off and the right stick
 *   turns (Immersive.tsx).
 *
 * What a move DOES — carry, ease, resize, turn to face you — is the caller's,
 * passed in as callbacks, read fresh on every event.
 */

/** Metres a notch of the mouse wheel pushes a held thing away. */
export const WHEEL_REACH = 0.0022;
/** Metres a second a thumbstick held fully forward pushes it away. */
export const STICK_REACH_PER_SECOND = 1.5;
/** Below this a resting thumbstick's drift is not a push. */
const STICK_DEAD_ZONE = 0.2;
export function useGrab<Kind extends string = "move">(options: {
  /** What the server's holds are keyed by: "panel:<id>" or "item:<id>". */
  thing: string;
  /** Your own thing (your screen): nobody else can hold it, so no hold is asked. */
  personal?: boolean;
  /** Taken hold of, along this ray, at the point it struck. */
  begin: (ray: Ray, struck: Vec3 | null, kind: Kind) => void;
  /** The pointer moved while it was held. */
  drag: (ray: Ray) => void;
  /** Push it away (positive) or pull it in, in metres: the wheel, or a thumbstick. */
  reach?: (metres: number) => void;
  /** Let go: save, and answer with the save, so the hold is let go only once it lands. */
  release: () => Promise<unknown> | void;
  /** Somebody else has it. The grab has already ended; put it back and say this. */
  refused: (why: string) => void;
}): {
  /** Held right now, for drawing. */
  held: boolean;
  /** Held right now, for code that runs later than a render (a save's answer). */
  holding: () => boolean;
  take: (kind: Kind) => (event: ThreeEvent<PointerEvent>) => void;
  steer: (event: ThreeEvent<PointerEvent>) => void;
  letGo: (event: ThreeEvent<PointerEvent>) => void;
} {
  const latest = useRef(options);
  latest.current = options;
  const [held, setHeld] = useState(false);
  const grabbing = useRef(false);
  const grabbedPointer = useRef<number | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const caster = useMemo(() => ({ ray: new THREE.Raycaster(), ndc: new THREE.Vector2() }), []);
  const vec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: v.x, y: v.y, z: v.z });

  /** The ray an R3F event was cast along: a mouse and a controller fill the same field. */
  const rayOf = (event: ThreeEvent<PointerEvent>): Ray => ({ origin: vec(event.ray.origin), direction: vec(event.ray.direction) });

  /** The same ray from a raw window event, for a drag that has left the handle behind. */
  const rayFromScreen = (clientX: number, clientY: number): Ray | null => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    caster.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    caster.ray.setFromCamera(caster.ndc, camera);
    return { origin: vec(caster.ray.ray.origin), direction: vec(caster.ray.ray.direction) };
  };

  /** The grab is over, by release or by refusal: stop listening, forget the pointer. */
  const end = () => {
    grabbing.current = false;
    grabbedPointer.current = null;
    stopListening.current?.();
    setHeld(false);
  };

  const refusedNow = useRef<(why: string) => void>(() => undefined);
  refusedNow.current = (why: string) => {
    if (!grabbing.current) return;
    end();
    latest.current.refused(why);
  };
  const hold = useMemo(
    () => grabHold({
      thing: options.thing,
      api: options.personal ? async () => undefined : space.hold,
      refused: (why) => refusedNow.current(why),
    }),
    [options.thing, options.personal],
  );

  const finish = () => {
    if (!grabbing.current) return;
    end();
    const saved = latest.current.release();
    hold.release(saved ?? undefined);
  };

  const listen = () => {
    stopListening.current?.();
    const move = (event: PointerEvent) => {
      const ray = rayFromScreen(event.clientX, event.clientY);
      if (ray) latest.current.drag(ray);
    };
    const up = () => finish();
    const wheel = (event: WheelEvent) => {
      if (!grabbing.current || !latest.current.reach) return;
      // Or the page scrolls underneath the room, moving the canvas out from under the drag.
      event.preventDefault();
      // Wheel up is negative, and wheel up should send it away from you.
      latest.current.reach(-event.deltaY * WHEEL_REACH);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("wheel", wheel, { passive: false });
    stopListening.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("wheel", wheel);
      stopListening.current = null;
    };
  };

  // The thumbstick, while held: forward is negative on the axis, and pushes away.
  useFrame((_, delta) => {
    if (!grabbing.current || !latest.current.reach) return;
    let push = 0;
    for (const source of gl.xr.getSession()?.inputSources ?? []) {
      const y = source.gamepad?.axes[3] ?? 0;
      if (Math.abs(y) > STICK_DEAD_ZONE) push = -y;
    }
    if (push !== 0) latest.current.reach(push * STICK_REACH_PER_SECOND * delta);
  });

  // Never leave a listener behind on a thing that has gone away, nor a claim on
  // it being renewed every few seconds by a grab that no longer exists.
  useEffect(() => () => stopListening.current?.(), []);
  useEffect(() => () => hold.release(), [hold]);

  const take = (kind: Kind) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    // Tell the look-drag this press is spoken for, or moving a thing also swings the camera.
    claimPointer(event.nativeEvent);
    grabbedPointer.current = event.pointerId;
    // Captured, so the grab survives the ray slipping off the handle for a frame.
    (event.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(event.pointerId);
    grabbing.current = true;
    setHeld(true);
    hold.take();
    latest.current.begin(rayOf(event), event.point ? vec(event.point) : null, kind);
    listen();
  };

  const steer = (event: ThreeEvent<PointerEvent>) => {
    if (grabbedPointer.current !== event.pointerId) return;
    event.stopPropagation();
    latest.current.drag(rayOf(event));
  };

  const letGo = (event: ThreeEvent<PointerEvent>) => {
    if (grabbedPointer.current !== event.pointerId) return;
    finish();
  };

  return { held, holding: () => grabbing.current, take, steer, letGo };
}
