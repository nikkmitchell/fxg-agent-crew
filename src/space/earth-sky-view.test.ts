// @vitest-environment jsdom
import { expect, test } from "vitest";
import * as THREE from "three";
import { makeEarthSky, SKY_REFERENCE } from "../../shared/earth-sky";
import { EarthSkyView } from "./earth-sky-view";

test("twinkle is independent per star, steady for planets and quiet under reduced motion", () => {
  const snapshot = makeEarthSky(Array.from({ length: 20 }, (_, i) => [i + 1, i, 20, 2, .4, 0, 0]), SKY_REFERENCE);
  const view = new EarthSkyView(snapshot);
  const stars = view.group.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const twinkle = stars.geometry.getAttribute("twinkle");
  const rates = new Set<number>();
  for (let i = 0; i < snapshot.stars.length; i++) {
    expect(twinkle.getY(i)).toBeGreaterThanOrEqual(1.1);
    expect(twinkle.getY(i)).toBeLessThanOrEqual(2.7);
    expect(twinkle.getZ(i)).toBeGreaterThanOrEqual(.45);
    expect(twinkle.getZ(i)).toBeLessThanOrEqual(1);
    rates.add(twinkle.getY(i));
  }
  expect(rates.size).toBeGreaterThan(10);
  for (let i = snapshot.stars.length; i < twinkle.count; i++) expect(twinkle.getZ(i)).toBe(0);
  view.update(new THREE.Vector3(), 1, .1);
  const time = stars.material.uniforms.uTime.value;
  view.update(new THREE.Vector3(), 1, .1, 0, true);
  expect(stars.material.uniforms.uTwinkle.value).toBe(0);
  expect(stars.material.uniforms.uTime.value).toBe(time);
  view.dispose();
});
