import { Transform, type TransformCallback } from "node:stream";

/**
 * BIG SPACE FILES SHARE A CAPPED RATE, SO THE PAGE NEVER STARVES (Nikk, 6928).
 *
 * On 2026-10-03 a space with 55 MB of scans stood full size in the saha.ing
 * room. Everyone in the room downloaded all of it at once, the box's uplink
 * filled, and the page, the chat and the room list queued behind it: a 271 KB
 * file took 12.7 s, Baiwei could not get into VR, and Nikk saw "the room
 * stopped answering".
 *
 * So every big file a space serves goes through one shared budget (a virtual
 * clock: each chunk is sent once the budget has room for it, first come first
 * served). However many people download however much, space files together
 * never take more than `bytesPerSecond`, and everything else the server sends
 * has the rest. Small files (under `smallBytes`) are never held back: a
 * thing's scripts arrive at once.
 */
export type FairShare = {
  readonly bytesPerSecond: number;
  readonly smallBytes: number;
  /** A stream that passes chunks on as the shared budget allows. */
  throttle(): Transform;
};

export function fairShare(options: { bytesPerSecond: number; smallBytes: number; now?: () => number; wait?: (ms: number, fn: () => void) => void }): FairShare {
  const now = options.now ?? (() => performance.now());
  const wait = options.wait ?? ((ms, fn) => void setTimeout(fn, ms));
  /** When the budget is next free, in `now()` milliseconds. */
  let free = 0;
  return {
    bytesPerSecond: options.bytesPerSecond,
    smallBytes: options.smallBytes,
    throttle() {
      return new Transform({
        transform(chunk: Buffer, _encoding, done: TransformCallback) {
          const at = now();
          const start = Math.max(at, free);
          free = start + (chunk.length / options.bytesPerSecond) * 1000;
          const delay = start - at;
          if (delay <= 1) done(null, chunk);
          else wait(delay, () => done(null, chunk));
        },
      });
    },
  };
}

/** What a space's big file is served as. Anything not here is sent as before, unthrottled. */
export const BIG_FILE_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  vrm: "model/gltf-binary",
  bin: "application/octet-stream",
  ktx2: "image/ktx2",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  hdr: "application/octet-stream",
  exr: "application/octet-stream",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
};
