import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * DRAWN ONLY WHEN YOU ARE NEAR IT.
 *
 * Sill (5594): with some thirty pieces in meditation.AR the room was about 276
 * draw calls a frame, and a headset draws every frame twice; a Quest is
 * comfortable at 100 to 200 per eye. Most pieces are small things you walk up
 * to, so each is hidden while the viewer is more than `within` metres away
 * across the floor, and costs nothing then. (Hidden is not unmounted: its
 * listeners and sound still run, so a strike across the room is still heard.)
 */
export function isNear(eye: { x: number; z: number }, at: { x: number; z: number }, within: number): boolean {
  return Math.hypot(eye.x - at.x, eye.z - at.z) <= within;
}

const eye = new THREE.Vector3();

export function Near({ at, within = 7, children }: { at: { x: number; z: number }; within?: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current) return;
    state.camera.getWorldPosition(eye);
    group.current.visible = isNear(eye, at, within);
  });
  return <group ref={group}>{children}</group>;
}
