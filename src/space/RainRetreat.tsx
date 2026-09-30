import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { retreatLevel } from "../../shared/rain-retreat";
import { RainRetreatView } from "./rain-retreat-view";

export type RainRetreatHandle = { enableSound(): Promise<boolean>; mute(): void };
/** Independent, opt-in room piece. Enable sound only from a visitor's gesture. */
export const RainRetreat = forwardRef<RainRetreatHandle, {
  at: { x: number; z: number }; enabled?: boolean; reducedMotion?: boolean;
}>(function RainRetreat({ at, enabled = true, reducedMotion = false }, handle) {
  const root = useRef<THREE.Group>(null);
  const view = useRef<RainRetreatView | null>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useImperativeHandle(handle, () => ({
    enableSound: () => view.current?.enableSound() ?? Promise.resolve(false),
    mute: () => view.current?.mute(),
  }), []);
  useEffect(() => {
    const made = new RainRetreatView({ x: at.x, z: at.z });
    view.current = made; root.current?.add(made.group);
    return () => { made.dispose(); if (view.current === made) view.current = null; };
  }, [at.x, at.z]);
  useFrame((state, delta) => {
    const current = view.current; if (!current) return;
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera;
    camera.getWorldPosition(eye);
    current.update(enabled ? retreatLevel(Math.hypot(eye.x - at.x, eye.z - at.z)) : 0, delta, reducedMotion);
  });
  return <group ref={root} />;
});
