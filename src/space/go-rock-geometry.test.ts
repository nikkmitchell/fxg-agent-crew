import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GO_SIZES } from "../../shared/room-items";
import { GO_SURFACE, goBoardWidth, goPoint, GO_ROCK_REACH } from "../../shared/go-layout";
import { goRockHoles } from "../../shared/go-rock";
import { goRockGeometry } from "./go-rock-geometry";

describe("the rendered scholar's rock", () => {
  for (const size of GO_SIZES) it(`${size}: is one closed mesh with a playable top and open holes`, () => {
    const geometry = goRockGeometry(size), positions = geometry.getAttribute("position"), index = geometry.index!;
    expect(index.count / 3).toBeLessThan(60_000);
    const edges = new Map<string, number>();
    const winding = new Map<string, number>();
    const parent = Array.from({ length: positions.count }, (_, i) => i);
    const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < index.count; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
        winding.set(key, (winding.get(key) ?? 0) + (a < b ? 1 : -1));
        parent[root(a)] = root(b);
      }
    }
    // A missing wall, an unjoined tube or a disconnected fragment fails here.
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    expect([...winding.values()].every((n) => n === 0)).toBe(true);
    expect(new Set(parent.map((_, i) => root(i))).size).toBe(1);
    for (const attr of ["position", "normal", "color"]) {
      expect(Array.from(geometry.getAttribute(attr).array).every(Number.isFinite)).toBe(true);
    }
    geometry.computeBoundingBox();
    expect(Math.max(geometry.boundingBox!.max.x, geometry.boundingBox!.max.z)).toBeLessThan(goBoardWidth(size) / 2 + GO_ROCK_REACH);
    const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const row of [0, (size - 1) / 2, size - 1]) for (const col of [0, (size - 1) / 2, size - 1]) {
      ray.ray.origin.set(goPoint(col, size), GO_SURFACE + 0.2, goPoint(row, size));
      const hit = ray.intersectObject(mesh)[0];
      expect(hit).toBeDefined();
      expect(hit.point.y).toBeCloseTo(GO_SURFACE, 5);
      expect(hit.face!.normal.y).toBeGreaterThan(0.999);
    }
    for (const hole of goRockHoles(size)) {
      ray.ray.origin.set(hole.centre.x, GO_SURFACE + 0.2, hole.centre.z);
      expect(ray.intersectObject(mesh)).toHaveLength(0);
    }
    geometry.dispose(); material.dispose();
  });
});
