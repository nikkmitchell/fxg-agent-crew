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
    expect(triangles).toBeLessThan(kind === "sakura" ? 2800 : 1600);
    view.update(1, .1);
    const meshes = view.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
    const times = meshes.map(mesh => mesh.material.uniforms.uTime.value);
    view.update(1, .1, true);
    expect(meshes.map(mesh => mesh.material.uniforms.uTime.value)).toEqual(times);
    expect(meshes.every(mesh => mesh.material.uniforms.uReduced.value === 1)).toBe(true);
    for (let i = 0; i < 200; i++) view.update(0, .1);
    if (kind === "fireflies") {
      const lights = meshes.find(mesh => mesh.material.uniforms.uNear)!;
      expect(lights.material.uniforms.uNear.value).toBeLessThan(.001);
      const guide = lights.geometry.getAttribute("guide");
      expect(Array.from(guide.array).filter(value => value === 1)).toHaveLength(1);
      expect(view.group.visible).toBe(true);
    } else expect(view.group.visible).toBe(false);
    view.dispose();
    return expect(view.enableSound()).resolves.toBe(false);
  });
}

test("sakura releases petals only beneath the canopy and lets old falls finish after leaving", () => {
  const view = new NatureRetreatView("sakura", { x: 0, z: 0 });
  const petals = (view.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]).find(mesh => mesh.material.uniforms.uPetalTime)!;
  const uniforms = petals.material.uniforms;
  view.update(.5, .1);
  expect(uniforms.uEmissionEnd.value).toBe(-1);
  view.update(1, .1);
  const began = uniforms.uEmissionStart.value;
  const end = uniforms.uEmissionEnd.value;
  view.update(.5, .1);
  expect(uniforms.uEmissionEnd.value).toBe(end);
  expect(uniforms.uPetalTime.value).toBeGreaterThan(end);
  view.update(1, .1);
  expect(uniforms.uPreviousStart.value).toBe(began);
  expect(uniforms.uPreviousEnd.value).toBe(end);
  expect(uniforms.uEmissionStart.value).toBeGreaterThan(end);
  view.dispose();
});
