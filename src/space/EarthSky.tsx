import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SKY_REFERENCE, skyProximity, type SkyReference } from "../../shared/earth-sky";
import { EarthSkyClock } from "./earth-sky-clock";

/** Opt-in backdrop; never reads or writes the room's shared constellation state. */
export function EarthSky({ at, reference = SKY_REFERENCE, panorama = false, enabled = true, live = true }: {
  at: { x: number; z: number }; reference?: SkyReference; panorama?: boolean; enabled?: boolean; live?: boolean;
}) {
  const clock = useMemo(() => new EarthSkyClock(reference, live), [reference, live]);
  const view = clock.view;
  const eye = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => view.dispose(), [view]);
  useFrame((state, delta) => {
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera;
    camera.getWorldPosition(eye);
    const target = !enabled ? 0 : panorama ? 1 : skyProximity(Math.hypot(eye.x - at.x, eye.z - at.z));
    view.update(eye, target, delta, clock.advance());
  });
  return <primitive object={view.group} />;
}
