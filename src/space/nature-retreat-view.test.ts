// @vitest-environment jsdom
import { expect, test } from "vitest";
import { NatureRetreatView } from "./nature-retreat-view";
import type * as THREE from "three";

for (const kind of ["sakura", "fireflies"] as const) {
  test(`${kind} stays within a small XR geometry budget, freezes motion and disposes`, () => {
    const view = new NatureRetreatView(kind, { x: 3, z: -4 });
    expect(view.group.position.toArray()).toEqual([3, 0, -4]);
    expect(view.group.children.length).toBeLessThanOrEqual(5);
    let triangles = 0;
    for (const child of view.group.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const geometry = mesh.geometry as THREE.InstancedBufferGeometry;
      triangles += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3 * (geometry.instanceCount ?? 1);
      for (const value of geometry.getAttribute("position").array) expect(Number.isFinite(value)).toBe(true);
    }
    expect(triangles).toBeLessThan(2000);
    view.update(1, .1);
    const meshes = view.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
    const times = meshes.map(mesh => mesh.material.uniforms.uTime.value);
    view.update(1, .1, true);
    expect(meshes.map(mesh => mesh.material.uniforms.uTime.value)).toEqual(times);
    expect(meshes.every(mesh => mesh.material.uniforms.uReduced.value === 1)).toBe(true);
    for (let i = 0; i < 200; i++) view.update(0, .1);
    expect(view.group.visible).toBe(false);
    view.dispose();
    return expect(view.enableSound()).resolves.toBe(false);
  });
}
