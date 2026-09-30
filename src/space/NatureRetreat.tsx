import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { natureLevel, type NatureKind } from "../../shared/nature-retreat";
import { NatureRetreatView } from "./nature-retreat-view";

export type NatureRetreatHandle = { enableSound(): Promise<boolean>; mute(): void };
/** Place either independent clearing in an existing XR room without changing its state. */
export const NatureRetreat = forwardRef<NatureRetreatHandle, {
  kind: NatureKind; at: { x: number; z: number }; enabled?: boolean; reducedMotion?: boolean;
}>(function NatureRetreat({ kind, at, enabled = true, reducedMotion = false }, handle) {
  const root = useRef<THREE.Group>(null), view = useRef<NatureRetreatView | null>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useImperativeHandle(handle, () => ({
    enableSound: () => view.current?.enableSound() ?? Promise.resolve(false),
    mute: () => view.current?.mute(),
  }), []);
  useEffect(() => {
    const made = new NatureRetreatView(kind, { x: at.x, z: at.z });
    view.current = made; root.current?.add(made.group);
    return () => { made.dispose(); if (view.current === made) view.current = null; };
  }, [kind, at.x, at.z]);
  useFrame((state, delta) => {
    const current = view.current; if (!current) return;
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera;
    camera.getWorldPosition(eye);
    current.update(enabled ? natureLevel(Math.hypot(eye.x - at.x, eye.z - at.z)) : 0, delta, reducedMotion);
  });
  return <group ref={root} />;
});
