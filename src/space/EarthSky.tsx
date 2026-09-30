import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SKY_REFERENCE, skyProximity, type SkyReference } from "../../shared/earth-sky";
import { EarthSkyClock } from "./earth-sky-clock";
import { loadSkyCatalogue } from "./sky/load-catalogue";

/** Opt-in backdrop; never reads or writes the room's shared constellation state. */
export function EarthSky({ at, reference = SKY_REFERENCE, panorama = false, enabled = true, live = true, reducedMotion = false }: {
  at: { x: number; z: number }; reference?: SkyReference; panorama?: boolean; enabled?: boolean; live?: boolean; reducedMotion?: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const clock = useRef<EarthSkyClock | null>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    let cancelled = false;
    let made: EarthSkyClock | null = null;
    void loadSkyCatalogue().then((rows) => {
      if (cancelled) return;
      made = new EarthSkyClock(rows, reference, live);
      clock.current = made;
      root.current?.add(made.view.group);
    }).catch((error) => { if (!cancelled) console.error("Earth sky failed to load", error); });
    return () => { cancelled = true; made?.view.dispose(); if (clock.current === made) clock.current = null; };
  }, [reference, live]);
  useFrame((state, delta) => {
    const current = clock.current;
    if (!current) return;
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera;
    camera.getWorldPosition(eye);
    const target = !enabled ? 0 : panorama ? 1 : skyProximity(Math.hypot(eye.x - at.x, eye.z - at.z));
    camera.getWorldDirection(forward);
    current.view.update(eye, target, delta, current.advance(), reducedMotion, forward);
  });
  return <group ref={root} />;
}
