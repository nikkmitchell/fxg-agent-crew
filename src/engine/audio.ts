import * as THREE from "three";
import type { Off, Vec3 } from "./types";

/**
 * SOUND FOR THINGS (docs/things/DESIGN.md, 7): one AudioContext for the
 * page (the room's own, which its listener follows and its gestures
 * unlock), a master for every thing, and a bus per thing. Sources placed at
 * an object get an HRTF panner the engine keeps at that object.
 *
 * The context is the REAL one, not a proxy: AudioWorkletNode and friends
 * check what they are given. It is given a close() that does nothing, so a
 * thing that tidies up by closing its context (Mica's RainAudio does) cannot
 * silence the room's calls.
 */
let master: GainNode | null = null;
let guarded = false;

export function pageAudio(): { context: AudioContext; master: GainNode } {
  const context = THREE.AudioContext.getContext() as AudioContext;
  if (!guarded) {
    guarded = true;
    (context as { close: () => Promise<void> }).close = () => Promise.resolve();
  }
  if (!master || master.context !== context) {
    master = context.createGain();
    master.connect(context.destination);
  }
  return { context, master };
}

/**
 * A WORKLET'S PROCESSORS, RENAMED PER ADDRESS, so a push (a new pinned
 * address) never re-registers a name, and two spaces never share one. The
 * module is added from its real address, so its own imports resolve: the
 * worklet scope's registerProcessor is wrapped just before it (appending
 * "~<hash>") and put back just after, one worklet at a time.
 */
const worklets = new Map<string, Promise<string>>();
let adding: Promise<unknown> = Promise.resolve();
function hashOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const scriptUrl = (source: string) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
function loadWorklet(context: AudioContext, url: string): Promise<string> {
  const absolute = new URL(url, globalThis.location?.href).href;
  const hash = hashOf(absolute);
  let loading = worklets.get(hash);
  if (!loading) {
    const run = adding.catch(() => undefined).then(async () => {
      const worklet = context.audioWorklet;
      await worklet.addModule(scriptUrl(`globalThis.__sahaRegisterProcessor ??= globalThis.registerProcessor;
globalThis.registerProcessor = (name, processor) => globalThis.__sahaRegisterProcessor(name + "~${hash}", processor);`));
      try {
        await worklet.addModule(absolute);
      } finally {
        await worklet.addModule(scriptUrl("globalThis.registerProcessor = globalThis.__sahaRegisterProcessor;"));
      }
      return hash;
    });
    adding = run;
    loading = run;
    run.catch(() => worklets.delete(hash));
    worklets.set(hash, loading);
  }
  return loading;
}

const buffers = new Map<string, Promise<AudioBuffer>>();

export type ThingAudio = {
  context: AudioContext;
  out: GainNode;
  at(where: THREE.Object3D | Vec3, options?: { refDistance?: number; rolloff?: number }): GainNode;
  workletNode(url: string | URL, processor: string, options?: AudioWorkletNodeOptions): Promise<AudioWorkletNode>;
  buffer(url: string | URL): Promise<AudioBuffer>;
  readonly unlocked: boolean;
  whenUnlocked(fn: () => void): Off;
  /** Every frame: move the panners whose objects moved. */
  frame(): void;
  dispose(): void;
};

/** One thing's sound: its bus into the master, quieter in a model, faded in. */
export function thingAudio(root: THREE.Object3D, options: { quiet: boolean }): ThingAudio {
  const { context, master: into } = pageAudio();
  const out = context.createGain();
  const level = options.quiet ? 0.3 : 1;
  out.gain.setValueAtTime(0, context.currentTime);
  out.gain.linearRampToValueAtTime(level, context.currentTime + 0.2);
  out.connect(into);
  const panners: { object: THREE.Object3D | null; local: THREE.Vector3; panner: PannerNode; last: THREE.Vector3 }[] = [];
  const unlockers = new Set<() => void>();
  const world = new THREE.Vector3();

  const audio: ThingAudio = {
    context,
    out,
    at(where, placement = {}) {
      const gain = context.createGain();
      const panner = context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = placement.refDistance ?? 1;
      panner.rolloffFactor = placement.rolloff ?? 1;
      gain.connect(panner).connect(out);
      const object = Array.isArray(where) ? null : where;
      const local = Array.isArray(where) ? new THREE.Vector3(...where) : new THREE.Vector3();
      panners.push({ object, local, panner, last: new THREE.Vector3(Infinity, 0, 0) });
      return gain;
    },
    async workletNode(url, processor, nodeOptions) {
      const hash = await loadWorklet(context, String(url));
      return new AudioWorkletNode(context, `${processor}~${hash}`, nodeOptions);
    },
    buffer(url) {
      const key = String(url);
      let decoding = buffers.get(key);
      if (!decoding) {
        decoding = fetch(key).then((answer) => answer.arrayBuffer()).then((bytes) => context.decodeAudioData(bytes));
        decoding.catch(() => buffers.delete(key));
        buffers.set(key, decoding);
      }
      return decoding;
    },
    get unlocked() {
      return context.state === "running";
    },
    whenUnlocked(fn) {
      if (context.state === "running") {
        queueMicrotask(fn);
        return () => undefined;
      }
      const check = () => {
        if (context.state !== "running") return;
        context.removeEventListener("statechange", check);
        unlockers.delete(stop);
        fn();
      };
      const stop = () => context.removeEventListener("statechange", check);
      context.addEventListener("statechange", check);
      unlockers.add(stop);
      return stop;
    },
    frame() {
      for (const entry of panners) {
        if (entry.object) entry.object.getWorldPosition(world);
        else world.copy(entry.local).applyMatrix4(root.matrixWorld);
        if (world.distanceToSquared(entry.last) < 1e-6) continue;
        entry.last.copy(world);
        const p = entry.panner;
        if (p.positionX) {
          p.positionX.value = world.x;
          p.positionY.value = world.y;
          p.positionZ.value = world.z;
        } else {
          (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(world.x, world.y, world.z);
        }
      }
    },
    dispose() {
      for (const stop of unlockers) stop();
      unlockers.clear();
      const end = context.currentTime + 0.2;
      out.gain.cancelScheduledValues(context.currentTime);
      out.gain.setValueAtTime(out.gain.value, context.currentTime);
      out.gain.linearRampToValueAtTime(0, end);
      setTimeout(() => {
        out.disconnect();
        for (const entry of panners) entry.panner.disconnect();
      }, 250);
    },
  };
  return audio;
}
