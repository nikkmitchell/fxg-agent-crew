// @vitest-environment jsdom
import { expect, test } from "vitest";
import * as THREE from "three";
import { RainRetreatView } from "./rain-retreat-view";

test("foreground rain renders after solid stone depth, within a compact geometry budget", () => {
  const view = new RainRetreatView({ x: 0, z: 0 });
  const [rain, ground, ripples, stone] = view.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  expect(stone.material.depthWrite).toBe(true);
  expect(ground.renderOrder).toBeLessThan(stone.renderOrder);
  expect(stone.renderOrder).toBeLessThan(ripples.renderOrder);
  expect(ripples.renderOrder).toBeLessThan(rain.renderOrder);
  expect(rain.material.depthTest).toBe(true);
  expect(rain.material.depthWrite).toBe(false);
  expect(stone.geometry.getAttribute("position").count / 3).toBeLessThan(1400);
  stone.geometry.computeBoundingBox();
  expect(stone.geometry.boundingBox!.max.y).toBeGreaterThan(.44);
  expect(stone.geometry.boundingBox!.max.y).toBeLessThan(.46);
  expect(view.group.children).toHaveLength(4);
  view.update(1, .1);
  const time = rain.material.uniforms.uTime.value;
  view.update(1, .1, true);
  expect(rain.material.uniforms.uTime.value).toBe(time);
  view.dispose();
});
