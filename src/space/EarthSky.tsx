import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SKY_REFERENCE, skyProximity, type SkyReference } from "../../shared/earth-sky";
import { EarthSkyClock } from "./earth-sky-clock";

/** Opt-in backdrop; never reads or writes the room's shared constellation state. */
export function EarthSky({ at, reference = SKY_REFERENCE, panorama = false, enabled = true, live = true }: {
  at: { x: number; z: number }; reference?: SkyReference; panorama?: boolean; enabled?: boolean; live?: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const clock = useRef<EarthSkyClock | null>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const made = new EarthSkyClock(reference, live);
    clock.current = made;
    root.current?.add(made.view.group);
    return () => { made.view.dispose(); if (clock.current === made) clock.current = null; };
  }, [reference, live]);
  useFrame((state, delta) => {
    const current = clock.current;
    if (!current) return;
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera;
    camera.getWorldPosition(eye);
    const target = !enabled ? 0 : panorama ? 1 : skyProximity(Math.hypot(eye.x - at.x, eye.z - at.z));
    current.view.update(eye, target, delta, current.advance());
  });
  return <group ref={root} />;
}
