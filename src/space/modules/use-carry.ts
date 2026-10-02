import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { beginGrab, clamp, grabbedTo, pushPull, type Grab, type Ray, type Vec3 } from "../../../shared/grab-move";
import { space } from "../../space-client";
import { grabHold } from "../grab-hold";
import { claimPointer } from "../pointer-claim";

/**
 * CARRYING A THING FROM A SPACE, the way the Go table is carried
 * (RoomItems.tsx, GoTable): press its MOVE handle and it goes where the
 * pointer goes, at the distance it was taken from (the wheel pushes and pulls
 * on a computer), and is saved where it is let go. One carrier at a time: the
 * grab claims it (grab-hold.ts), and a refusal puts it back and says who.
 *
 * Steered from the window on a computer (a drag can outrun a render) and from
 * R3F's own events in a headset, which delivers no window pointer events.
 */
type Place = { x: number; y: number; z: number; rotationY: number };

export function useCarry(options: {
  id: string;
  position: Place;
  /** The group that stands where the thing does. */
  body: RefObject<THREE.Object3D | null>;
  /** Save where it was let go; resolves false if that did not stick. */
  save: (to: Place) => Promise<boolean>;
  notice: (text: string) => void;
}) {
  const { id, body, save, notice } = options;
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const [carrying, setCarrying] = useState(false);
  const grab = useRef<Grab | null>(null);
  const grabbedPointer = useRef<number | null>(null);
  const want = useRef<Vec3 | null>(null);
  const latest = useRef(options.position);
  latest.current = options.position;
  const letGo = useRef<(() => void) | null>(null);
  const caster = useMemo(() => ({ ray: new THREE.Raycaster(), ndc: new THREE.Vector2() }), []);
  const asVec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: v.x, y: v.y, z: v.z });

  const refused = useRef<(why: string) => void>(() => undefined);
  const hold = useMemo(() => grabHold({ thing: `item:${id}`, api: space.hold, refused: (why) => refused.current(why) }), [id]);
  useEffect(() => () => hold.release(), [hold]);

  const putBack = useCallback(() => {
    const node = body.current;
    const at = latest.current;
    if (node) node.position.set(at.x, at.y, at.z);
    invalidate();
  }, [body, invalidate]);

  const rayFromScreen = useCallback((x: number, y: number): Ray | null => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    caster.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    caster.ray.setFromCamera(caster.ndc, camera);
    return { origin: asVec(caster.ray.ray.origin), direction: asVec(caster.ray.ray.direction) };
  }, [camera, gl, caster]);

  const steer = useCallback((ray: Ray | null) => {
    if (!ray || !grab.current) return;
    const to = grabbedTo(ray, grab.current);
    want.current = { x: to.x, y: clamp(to.y, -0.5, 5), z: to.z };
    invalidate();
  }, [invalidate]);

  /** Let go exactly once: a mouse delivers the release twice (the window's and the handle's). */
  const drop = useCallback(() => {
    if (!grab.current) return;
    const at = want.current;
    grab.current = null;
    want.current = null;
    grabbedPointer.current = null;
    setCarrying(false);
    if (!at) {
      hold.release();
      return;
    }
    const saved = save({ x: at.x, y: at.y, z: at.z, rotationY: latest.current.rotationY });
    hold.release(saved);
    void saved.then((ok) => {
      if (!ok && !grab.current) putBack();
    });
  }, [hold, putBack, save]);

  const listen = useCallback(() => {
    letGo.current?.();
    const move = (event: PointerEvent) => steer(rayFromScreen(event.clientX, event.clientY));
    const up = () => {
      letGo.current?.();
      drop();
    };
    const wheel = (event: WheelEvent) => {
      if (!grab.current) return;
      event.preventDefault();
      grab.current = pushPull(grab.current, -event.deltaY * 0.0022);
      invalidate();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("wheel", wheel, { passive: false });
    letGo.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("wheel", wheel);
      letGo.current = null;
    };
  }, [steer, rayFromScreen, drop, invalidate]);
  useEffect(() => () => letGo.current?.(), []);

  refused.current = (why: string) => {
    if (!grab.current) return;
    letGo.current?.();
    grab.current = null;
    want.current = null;
    grabbedPointer.current = null;
    setCarrying(false);
    putBack();
    notice(why);
  };

  useFrame(() => {
    const node = body.current;
    const at = want.current;
    if (node && at) node.position.set(at.x, at.y, at.z);
  });

  const take = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    claimPointer(event.nativeEvent);
    const at = latest.current;
    grab.current = beginGrab({ origin: asVec(event.ray.origin), direction: asVec(event.ray.direction) }, { x: at.x, y: at.y, z: at.z });
    hold.take();
    grabbedPointer.current = event.pointerId;
    (event.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(event.pointerId);
    setCarrying(true);
    listen();
  };
  const steerByRay = (event: ThreeEvent<PointerEvent>) => {
    if (grabbedPointer.current !== event.pointerId) return;
    event.stopPropagation();
    steer({ origin: asVec(event.ray.origin), direction: asVec(event.ray.direction) });
  };
  const dropByRay = (event: ThreeEvent<PointerEvent>) => {
    if (grabbedPointer.current !== event.pointerId) return;
    letGo.current?.();
    drop();
  };

  return { carrying, take, steerByRay, dropByRay };
}
