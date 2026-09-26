import * as THREE from "three";
import { triTable } from "three/examples/jsm/objects/MarchingCubes.js";
import { GO_RING, GO_ROCK_REACH, GO_SURFACE, goBoardWidth } from "../../shared/go-layout";
import { createGoRockField, smoothstep } from "../../shared/go-rock";

type RockMesh = { positions: Float32Array; normals: Float32Array; colours: Float32Array; indices: Uint32Array };
const cache = new Map<number, RockMesh>();

// Weld vertices on shared cell edges. Marching cubes retains curved openings
// with far fewer triangles than subdividing every cell into tetrahedra.
const cubeEdges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6],
  [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function axis(half: number): number[] {
  const inner = half - 0.065, outer = half + GO_ROCK_REACH + 0.015;
  const values: number[] = [];
  const segment = (a: number, b: number, step: number) => {
    const n = Math.ceil((b - a) / step);
    for (let i = 0; i < n; i++) values.push(a + (b - a) * i / n);
  };
  // Large flat cells over the playing plane, fine cells only in the sculpture.
  segment(-outer, -inner, 0.013);
  segment(-inner, inner, 0.022);
  segment(inner, outer, 0.013);
  values.push(outer);
  return values;
}

function sculpt(size: number): RockMesh {
  const half = goBoardWidth(size) / 2, xs = axis(half), zs = xs;
  const ys = Array.from({ length: 33 }, (_, i) => GO_RING.y - 0.013 + i * 0.0086);
  const nx = xs.length, ny = ys.length, nz = zs.length, count = nx * ny * nz;
  const field = createGoRockField(size), values = new Float32Array(count);
  const coords = new Float32Array(count * 3);
  const id = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = id(x, y, z);
    values[i] = field(xs[x], ys[y], zs[z]);
    coords[i * 3] = xs[x]; coords[i * 3 + 1] = ys[y]; coords[i * 3 + 2] = zs[z];
  }
  const positions: number[] = [], indices: number[] = [], edges = new Map<number, number>();
  const vertex = (a: number, b: number): number => {
    const t = values[a] / (values[a] - values[b]);
    const key = t < 1e-7 ? a * count + a : t > 1 - 1e-7 ? b * count + b
      : Math.min(a, b) * count + Math.max(a, b);
    const known = edges.get(key);
    if (known !== undefined) return known;
    const n = positions.length / 3;
    for (let k = 0; k < 3; k++) positions.push(coords[a * 3 + k] + t * (coords[b * 3 + k] - coords[a * 3 + k]));
    edges.set(key, n);
    return n;
  };
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const corners = [id(x, y, z), id(x + 1, y, z), id(x + 1, y + 1, z), id(x, y + 1, z),
      id(x, y, z + 1), id(x + 1, y, z + 1), id(x + 1, y + 1, z + 1), id(x, y + 1, z + 1)];
    const mask = corners.reduce((m, i, n) => m | (values[i] < 0 ? 1 << n : 0), 0);
    if (mask === 0 || mask === 255) continue;
    const cellEdges = cubeEdges.map(([a, b]) => (values[corners[a]] < 0) !== (values[corners[b]] < 0)
      ? vertex(corners[a], corners[b]) : -1);
    for (let t = mask * 16; triTable[t] !== -1; t += 3) {
      const a = cellEdges[triTable[t]], b = cellEdges[triTable[t + 1]], c = cellEdges[triTable[t + 2]];
      // Our corner axes reverse the lookup table's winding. Flip all faces
      // consistently; judging each tiny face by averaged normals creates
      // back-facing slivers around concave apertures.
      if (a !== b && b !== c && a !== c) indices.push(a, c, b);
    }
  }
  // The central top and sole are planes. Retain their exact boundary vertices
  // but replace the dense interior with fans, spending triangles on the caves.
  const planeEdges = [new Map<string, [number, number]>(), new Map<string, [number, number]>()];
  const curved: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const tri = indices.slice(i, i + 3);
    const interior = tri.every((v) => Math.max(Math.abs(positions[v * 3]), Math.abs(positions[v * 3 + 2])) < half - 0.075);
    const plane = interior ? [GO_SURFACE, GO_RING.y].findIndex((y) => tri.every((v) => Math.abs(positions[v * 3 + 1] - y) < 1e-6)) : -1;
    if (plane === -1) { curved.push(...tri); continue; }
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (planeEdges[plane].has(key)) planeEdges[plane].delete(key);
      else planeEdges[plane].set(key, [a, b]);
    }
  }
  planeEdges.forEach((boundary, plane) => {
    if (!boundary.size) return;
    const centre = positions.length / 3;
    positions.push(0, plane === 0 ? GO_SURFACE : GO_RING.y, 0);
    for (const [a, b] of boundary.values()) curved.push(a, b, centre);
  });
  indices.splice(0, indices.length);
  for (const i of curved) indices.push(i);
  // Remove detached chips smaller than a sample cell left where two worn
  // surfaces almost meet. Keep the connected stone, then compact its vertices.
  const parents = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  for (let i = 0; i < indices.length; i += 3) {
    parents[root(indices[i])] = root(indices[i + 1]);
    parents[root(indices[i + 1])] = root(indices[i + 2]);
  }
  const components = new Map<number, number>();
  for (const i of indices) { const r = root(i); components.set(r, (components.get(r) ?? 0) + 1); }
  const main = [...components].sort((a, b) => b[1] - a[1])[0][0];
  const remap = new Map<number, number>(), compact: number[] = [], connected: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    if (root(indices[i]) !== main) continue;
    for (let k = 0; k < 3; k++) {
      const old = indices[i + k];
      if (!remap.has(old)) { remap.set(old, compact.length / 3); compact.push(...positions.slice(old * 3, old * 3 + 3)); }
      connected.push(remap.get(old)!);
    }
  }
  positions.splice(0, positions.length);
  for (const value of compact) positions.push(value);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(connected);
  // Field gradients keep the limestone smooth across the varying cell sizes.
  const normals = new Float32Array(positions.length), normal = new THREE.Vector3(), e = 0.0003;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    normal.set(field(x + e, y, z) - field(x - e, y, z), field(x, y + e, z) - field(x, y - e, z),
      field(x, y, z + e) - field(x, y, z - e)).normalize();
    normal.toArray(normals, i);
  }
  const colours = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const edge = smoothstep(half - 0.015, half + 0.065, Math.max(Math.abs(x), Math.abs(z)));
    let occlusion = 0;
    // Baked local occlusion lets the grottoes read even in the room's ambient
    // light; no per-frame ray marching or extra XR draw calls.
    for (const d of [0.012, 0.027, 0.055]) {
      const distance = field(x + normals[i] * d, y + normals[i + 1] * d, z + normals[i + 2] * d);
      occlusion += Math.max(0, 1 - distance / d) / 3;
    }
    const shade = 1 - edge * Math.min(0.48, occlusion * 0.6);
    colours[i] = colours[i + 1] = colours[i + 2] = shade;
  }
  const result = { positions: geometry.getAttribute("position").array as Float32Array,
    normals, colours, indices: new Uint32Array(connected) };
  geometry.dispose();
  return result;
}

/** Cache CPU data for the five board sizes; each mount owns/disposes its GPU
 * geometry. Changing size or switching materials does not repeat the sculpt. */
export function goRockGeometry(size: number): THREE.BufferGeometry {
  let data = cache.get(size);
  if (!data) { data = sculpt(size); cache.set(size, data); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
