// @vitest-environment jsdom
import { expect, test } from "vitest";
import * as THREE from "three";
import { EarthSkyClock } from "./earth-sky-clock";
import { SKY_REFERENCE } from "../../shared/earth-sky";
import { SKY_NIGHTS } from "../../shared/sky-nights";

test("changing night reuses the scene and buffers, retargets objects and keeps a real-speed clock", () => {
  const clock = new EarthSkyClock([[1, 2, 20, 2, .5, 0, 0]], SKY_REFERENCE, false, 1000);
  const group = clock.view.group;
  const stars = group.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const positions = stars.geometry.getAttribute("position");
  const before = Array.from(positions.array);
  clock.view.update(new THREE.Vector3(), 1, .1);
  const moon = group.children[2];
  const beforeMoon = moon.position.clone();
  clock.select(SKY_NIGHTS.find(night => night.id === "galileo")!.reference, false, 2000);
  expect(clock.advance(32_000)).toBe(.5);
  clock.view.update(new THREE.Vector3(), 1, .1, clock.advance(2000));
  expect(clock.view.group).toBe(group);
  expect(stars.geometry.getAttribute("position")).toBe(positions);
  expect(Array.from(positions.array)).not.toEqual(before);
  expect(moon.position.distanceTo(beforeMoon)).toBeGreaterThan(1);
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  clock.select(SKY_REFERENCE, true, Date.parse("2026-10-01T00:00:00Z"));
  expect(clock.advance(Date.parse("2026-10-01T00:00:15Z"))).toBe(.25);
  clock.view.dispose();
});
