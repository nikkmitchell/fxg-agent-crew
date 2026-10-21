import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { keysToKeep, reduceVrma, TOLERANCE } from "../../tools/vrma-reduce.mts";

/**
 * The room's clips with fewer keys (tools/vrma-reduce.mts). What matters is
 * what three PLAYS, so the real clips go through three's own loader and
 * interpolation, sampled far finer than their 30 keys a second.
 */
const clipOf = (bytes: Buffer) => new Promise<THREE.AnimationClip>((done, fail) => {
  new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer, "", (gltf) => done(gltf.animations[0]), fail);
});
const jsonOf = (glb: Buffer) => JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
const angle = (a: number[], b: number[]) => {
  const sign = a.reduce((sum, x, i) => sum + x * b[i], 0) < 0 ? -1 : 1;
  return 2 * Math.atan2(Math.hypot(...a.map((x, i) => x - sign * b[i])), Math.hypot(...a.map((x, i) => x + sign * b[i])));
};
const turn = (radians: number) => [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)];
/** What three plays for a track at a time: the interpolant the mixer itself uses (missing from three's types). */
const player = (track: THREE.KeyframeTrack) => {
  const interpolant = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
  return (t: number) => Array.from(interpolant.evaluate(t) as Float32Array);
};

describe("which keys a clip keeps", () => {
  const times = Array.from({ length: 31 }, (_, i) => i / 30);
  it("keeps only the ends of a bone that does not move, or turns at an even pace", () => {
    expect(keysToKeep(times, times.map(() => turn(0.3)), true, TOLERANCE.rotation)).toEqual([0, 30]);
    expect(keysToKeep(times, times.map((t) => turn(t)), true, TOLERANCE.rotation)).toEqual([0, 30]);
  });

  it("keeps the key where a movement turns back", () => {
    const there = times.map((t) => turn(t <= 0.5 ? t : 1 - t));
    expect(keysToKeep(times, there, true, TOLERANCE.rotation)).toEqual([0, 15, 30]);
  });

  it("keeps a smooth curve within the tolerance at every key", () => {
    const values = times.map((t) => turn(0.4 * Math.sin(t * Math.PI * 2)));
    const keep = keysToKeep(times, values, true, TOLERANCE.rotation);
    expect(keep.length).toBeLessThan(times.length);
    expect(keep.length).toBeGreaterThan(4);
  });
});

describe("the room's clips, reduced", () => {
  for (const name of ["idle", "rb-wave", "world-walk-stop"]) {
    it(`${name}: plays the same in three, within ${TOLERANCE.rotation} rad and half a millimetre, smaller`, async () => {
      const original = readFileSync(`public/animations/${name}.vrma`);
      const reduced = reduceVrma(original);
      expect(reduced).not.toBeNull();
      expect(reduced!.length).toBeLessThan(original.length);
      expect(jsonOf(reduced!).extensions, "the VRM animation extension, bones and all").toEqual(jsonOf(original).extensions);
      expect(jsonOf(reduced!).nodes).toEqual(jsonOf(original).nodes);

      const [before, after] = await Promise.all([clipOf(original), clipOf(reduced!)]);
      expect(after.duration).toBeCloseTo(before.duration, 6);
      expect(after.tracks.map((track) => track.name)).toEqual(before.tracks.map((track) => track.name));
      let worstTurn = 0, worstMove = 0;
      before.tracks.forEach((track, i) => {
        const a = player(track), b = player(after.tracks[i]);
        for (let t = 0; t <= before.duration; t += 1 / 240) {
          const va = a(t), vb = b(t);
          if (track instanceof THREE.QuaternionKeyframeTrack) worstTurn = Math.max(worstTurn, angle(va, vb));
          else worstMove = Math.max(worstMove, Math.hypot(...va.map((x, k) => x - vb[k])));
        }
      });
      expect(worstTurn).toBeLessThanOrEqual(TOLERANCE.rotation * 1.01);
      expect(worstMove).toBeLessThanOrEqual(TOLERANCE.translation * 1.01);
    });
  }

  it("leaves alone what it does not understand", () => {
    expect(reduceVrma(Buffer.from("not a clip at all"))).toBeNull();
    const glb = readFileSync("public/animations/idle.vrma");
    const json = jsonOf(glb);
    json.meshes = [{ primitives: [] }];
    const text = Buffer.from(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, " "));
    const binStart = 20 + glb.readUInt32LE(12);
    const head = Buffer.alloc(20);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + (glb.length - binStart), 8);
    head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
    expect(reduceVrma(Buffer.concat([head, text, glb.subarray(binStart)])), "a file with a mesh is not a clip").toBeNull();
  });
});
