/**
 * THE ROOM'S ANIMATION CLIPS, WITHOUT THE KEYS NOBODY CAN SEE. Runs on dist/
 * at build, before precompress; the clips in public/animations stay exactly as
 * their authors made them.
 *
 * Entering the room downloads every clip: 24 of them, 3.1 MB of the 4.1 MB on
 * the wire (measured 2026-10-22, brotli already). Each keys all ~50 bones at
 * 30 frames a second, including bones that hardly move, so most keys say what
 * a straight line between their neighbours already says. A key is dropped
 * when every key between the two kept around it lies within TOLERANCE of what
 * three plays there (slerp for a rotation, a line for a position): 0.0005 rad
 * (0.03 degrees a bone) and half a millimetre. The idle clips keep about a
 * fifth of their keys, the walks nearly all.
 *
 * Only clips this understands are touched: a glTF binary of float32
 * accessors, LINEAR samplers, no meshes or skins. Anything else is copied as
 * it is. Results are kept by content in node_modules/.cache/vrma-reduce.
 *
 *   tsx tools/vrma-reduce.mts dist        # (part of `pnpm run build`)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TOLERANCE = { rotation: 0.0005, translation: 0.0005 } as const;

type Json = {
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown; name?: string; min?: number[]; max?: number[] }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { byteLength: number; uri?: string }[];
  animations?: { channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  meshes?: unknown[];
  skins?: unknown[];
};

const WIDTH: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

function slerp(a: number[], b: number[], t: number): number[] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  if (dot > 0.9995) {
    const r = a.map((x, i) => x + t * (sign * b[i] - x));
    const n = Math.hypot(...r);
    return r.map((x) => x / n);
  }
  const theta = Math.acos(dot), sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin, wb = (sign * Math.sin(t * theta)) / sin;
  return a.map((x, i) => wa * x + wb * b[i]);
}
/**
 * The angle between two rotations, as 2·atan2(|a−b|, |a+b|) and NOT 2·acos(a·b):
 * near 1, acos turns float32 rounding in the dot product (~4e-7) into a phantom
 * 0.002 rad, four times the tolerance, between two identical keys.
 */
function angleBetween(a: number[], b: number[]): number {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return 2 * Math.atan2(Math.hypot(...a.map((x, i) => x - sign * b[i])), Math.hypot(...a.map((x, i) => x + sign * b[i])));
}
const lerp = (a: number[], b: number[], t: number) => a.map((x, i) => x + t * (b[i] - x));
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]));

/** Which keys to keep so every dropped one lies within tolerance of the interpolation across its gap. */
export function keysToKeep(times: number[], values: number[][], rotation: boolean, tolerance: number): number[] {
  if (times.length <= 2) return times.map((_, i) => i);
  const keep = [0];
  let last = 0;
  for (let next = 2; next < times.length; next += 1) {
    for (let k = last + 1; k < next; k += 1) {
      const t = (times[k] - times[last]) / (times[next] - times[last]);
      const err = rotation
        ? angleBetween(slerp(values[last], values[next], t), values[k])
        : distance(lerp(values[last], values[next], t), values[k]);
      if (err > tolerance) {
        last = next - 1;
        keep.push(last);
        break;
      }
    }
  }
  keep.push(times.length - 1);
  return keep;
}

/** The same clip with fewer keys, or null when it is not a clip this understands. */
export function reduceVrma(file: Buffer): Buffer | null {
  if (file.length < 20 || file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(16) !== 0x4e4f534a) return null;
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8")) as Json;
  const binHeader = 20 + jsonLength;
  if (file.length < binHeader + 8 || file.readUInt32LE(binHeader + 4) !== 0x004e4942) return null;
  const bin = file.subarray(binHeader + 8, binHeader + 8 + file.readUInt32LE(binHeader));
  if (json.meshes?.length || json.skins?.length || json.buffers.length !== 1 || json.buffers[0].uri || !json.animations?.length) return null;
  const understood = json.animations.every((animation) => animation.samplers.every((sampler) =>
    (sampler.interpolation ?? "LINEAR") === "LINEAR" && [sampler.input, sampler.output].every((index) => {
      const accessor = json.accessors[index];
      const view = accessor?.bufferView === undefined ? undefined : json.bufferViews[accessor.bufferView];
      return accessor && view && accessor.componentType === 5126 && !accessor.sparse && !view.byteStride && WIDTH[accessor.type] !== undefined;
    })));
  if (!understood) return null;

  const read = (index: number): number[][] => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView!];
    const width = WIDTH[accessor.type];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const out: number[][] = [];
    for (let i = 0; i < accessor.count; i += 1) {
      const row: number[] = [];
      for (let c = 0; c < width; c += 1) row.push(bin.readFloatLE(start + (i * width + c) * 4));
      out.push(row);
    }
    return out;
  };

  const accessors: Json["accessors"] = [];
  const bufferViews: Json["bufferViews"] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  const write = (rows: number[][], type: string, name: string | undefined, bounds: boolean): number => {
    const data = Buffer.alloc(rows.length * rows[0].length * 4);
    rows.flat().forEach((value, i) => data.writeFloatLE(value, i * 4));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    chunks.push(data);
    offset += data.length;
    const accessor: Json["accessors"][number] = { bufferView: bufferViews.length - 1, componentType: 5126, count: rows.length, type };
    if (name) accessor.name = name;
    if (bounds) {
      accessor.min = rows[0].map((_, c) => Math.min(...rows.map((row) => row[c])));
      accessor.max = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c])));
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };

  for (const animation of json.animations) {
    const paths = new Map(animation.channels.map((channel) => [channel.sampler, channel.target.path]));
    animation.samplers = animation.samplers.map((sampler, index) => {
      const times = read(sampler.input).map((row) => row[0]);
      const values = read(sampler.output);
      const path = paths.get(index);
      const keep = path === "rotation" || path === "translation"
        ? keysToKeep(times, values, path === "rotation", TOLERANCE[path])
        : times.map((_, i) => i);
      return {
        ...sampler,
        input: write(keep.map((i) => [times[i]]), "SCALAR", json.accessors[sampler.input].name, true),
        output: write(keep.map((i) => values[i]), json.accessors[sampler.output].type, json.accessors[sampler.output].name, false),
      };
    });
  }
  json.accessors = accessors;
  json.bufferViews = bufferViews;
  json.buffers = [{ byteLength: offset }];

  const pad = (buffer: Buffer, fill: number) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(Buffer.concat(chunks), 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunkHeader = (length: number, type: number) => {
    const out = Buffer.alloc(8);
    out.writeUInt32LE(length, 0);
    out.writeUInt32LE(type, 4);
    return out;
  };
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]);
}

function* clips(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* clips(path);
    else if (entry.isFile() && entry.name.endsWith(".vrma")) yield path;
  }
}

/** Reduces every clip under ROOT in place; answers bytes before and after. */
export function reduceClips(root: string, cache: string): { clips: number; before: number; after: number } {
  mkdirSync(cache, { recursive: true });
  const totals = { clips: 0, before: 0, after: 0 };
  const key = createHash("sha256").update(JSON.stringify(TOLERANCE)).update(readFileSync(new URL(import.meta.url))).digest("hex").slice(0, 12);
  for (const path of [...clips(root)]) {
    const bytes = readFileSync(path);
    const kept = join(cache, `${createHash("sha256").update(bytes).digest("hex")}.${key}.vrma`);
    if (!existsSync(kept)) writeFileSync(kept, reduceVrma(bytes) ?? bytes);
    copyFileSync(kept, path);
    totals.clips += 1;
    totals.before += bytes.length;
    totals.after += readFileSync(kept).length;
  }
  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2] ?? "dist");
  const done = reduceClips(root, resolve("node_modules/.cache/vrma-reduce"));
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`vrma-reduce: ${done.clips} clips, ${mb(done.before)} MB to ${mb(done.after)} MB`);
}
