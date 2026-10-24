import * as THREE from "three";

/**
 * A HIDDEN CLOUD OF GLOWING POINTS for a pooled effect: additive, unlit, not culled, starting invisible
 * at opacity 0; the effect moves `positions` and fades the material. The arrival sparkles and the
 * speaking motes both build their pools from this (they were two copies).
 */
export function glowPoints(count: number, color: string, size: number): { points: THREE.Points; positions: Float32Array } {
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  points.frustumCulled = false;
  return { points, positions };
}

/** Frees what glowPoints made. */
export function disposeGlowPoints(points: THREE.Points): void {
  points.geometry.dispose();
  (points.material as THREE.Material).dispose();
}
