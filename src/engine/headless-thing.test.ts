// @vitest-environment jsdom
/**
 * RUN YOUR THING WITHOUT A HEADSET (a worked example; Sill, 6837).
 *
 * Before you push a thing, run it through the engine's own test world: it mounts the thing exactly as a room does
 * (ThingInstance on an Engine), advances frames, delivers moments from "other people" and disposes it, and collects
 * the lines that would appear on the thing's red badge (`problems`). Nothing here needs WebGL, WebXR or a browser
 * beyond jsdom. Web Audio is replaced by a fake graph that counts how many sound nodes your thing starts, so a test
 * can say "a hit makes a sound". It does not tell you how a thing looks or feels in a headset; only a person can.
 *
 * To test your own file: copy it next to this one with `from "saha"` changed to `from "../../server/spaces/saha-sdk"`
 * (the same defineItem a deploy uses), import it, and pass it to run() as below. It found, for example, that a thing calling ctx.input.drag failed to start before drag
 * existed ("ctx.input.drag is not a function" on the badge), which a push would have shown only to the people in a room.
 *
 *   pnpm exec vitest run src/engine/headless-thing.test.ts
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EnvStack, type EnvState } from "./env";
import type { Host, TransportEvent } from "./host";
import { Engine, ThingInstance } from "./instance";
import type { Json, ThingDefinition } from "./types";

/** What defineItem/defineEnvironment/defineSpace do (server/spaces/saha-sdk.ts), for tests. */
const thing = (kind: ThingDefinition["kind"], def: Omit<ThingDefinition, "kind">): ThingDefinition =>
  Object.freeze({ ...def, kind, [Symbol.for("saha.thing")]: 1 }) as unknown as ThingDefinition;

function world(modules: Record<string, ThingDefinition> = {}, kept: Record<string, Record<string, Json>> = {}) {
  const sent: unknown[][] = [];
  const listeners = new Set<(event: TransportEvent) => void>();
  const problems: string[] = [];
  const env: unknown[] = [];
  const scene = new THREE.Scene();
  /** The surroundings as a room keeps them: layers over what the room had (env.ts). */
  const surroundings: EnvState = { background: null, fog: null, far: 60, exposure: 1 };
  const stack = new EnvStack({ read: () => ({ ...surroundings }), write: (state) => Object.assign(surroundings, state) });
  const host: Host = {
    name: "test",
    final: false,
    transport: {
      values: async (id) => kept[id] ?? {},
      set: (instance, key, value) => {
        sent.push(["set", instance, key, value]);
      },
      moment: (instance, name, data) => sent.push(["moment", instance, name, data]),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer: null,
    me: { id: "nikk", name: "nikk", me: true, agent: false },
    people: () => [],
    now: () => 1_000,
    reducedMotion: false,
    resolve: async (ref) => (modules[ref] ? { url: `https://saha.test/s/x/~d1/${ref}.js`, exportName: null, kind: modules[ref].kind } : null),
    importModule: async (url) => ({ default: modules[/\/([^/]+)\.js$/.exec(url)![1]] }),
    envLayer: () => {
      const layer = stack.layer();
      return {
        set: (settings) => {
          env.push(settings);
          layer.set(settings);
        },
        remove: () => {
          env.push("undo");
          layer.remove();
        },
      };
    },
    problem: (id, text) => problems.push(`${id}: ${text}`),
    caption: () => undefined,
    invalidate: () => undefined,
  };
  const engine = new Engine(host, { camera: () => host.camera, element: () => null, me: () => host.me });
  const deliver = (event: TransportEvent) => listeners.forEach((listener) => listener(event));
  const run = (id: string, def: ThingDefinition, extra: Partial<ConstructorParameters<typeof ThingInstance>[1]> = {}) => {
    const instance = new ThingInstance(engine, { id, url: `https://saha.test/s/x/~d1/${id}.js`, def, mode: "item", scale: 1, parent: scene, surround: false, ...extra });
    return instance;
  };
  return { host, engine, sent, deliver, problems, env, scene, run, surroundings };
}


// A universal fake of the Web Audio graph: any property is a callable node, connect() returns its argument, and
// every start() is counted.
let started = 0;
const node = (): any => new Proxy(function () {}, {
  get: (_t, key) => (key === "connect" ? (x: unknown) => x : key === "start" ? () => { started += 1; } : key === "value" ? 1 : node()),
  apply: () => node(), set: () => true,
});
class FakeAudio {
  destination = node(); currentTime = 0; sampleRate = 48000; state = "running"; listener = node();
  audioWorklet = { addModule: async () => undefined };
  resume = async () => undefined;
  constructor() {
    return new Proxy(this, { get: (t: any, k: string) => (k in t ? t[k] : k === "createBuffer" ? () => ({ sampleRate: 48000, getChannelData: () => new Float32Array(8192) }) : () => node()) });
  }
}
(globalThis as any).AudioContext = FakeAudio;

/** A small instrument, written the way a real one is: a bell you strike; everyone hears it from the bell. */
const bell = thing("item", {
  name: "Bell",
  size: [0.3, 0.5, 0.3],
  setup(ctx) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial({ emissive: 0xffc27a, emissiveIntensity: 0 }));
    ctx.root.add(body);
    ctx.input.strike(body, (e) => ctx.net.moment("ring", { v: e.strength }));
    let glow = 0;
    ctx.net.onMoment("ring", ({ v }: { v: number }) => {
      const c = ctx.audio.context, osc = c.createOscillator(), gain = c.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, c.currentTime);
      osc.connect(gain).connect(ctx.audio.at(body));
      osc.start(); osc.stop(c.currentTime + 1);
      glow = v;
    });
    ctx.frame((dt) => { glow = Math.max(0, glow - dt); (body.material as THREE.MeshStandardMaterial).emissiveIntensity = glow; });
  },
});

describe("running a thing without a headset", () => {
  it("mounts with nothing on its badge, and puts something in the room", async () => {
    const { run, problems, scene } = world();
    const instance = run("bell", bell);
    expect(await instance.start()).toBe(true);
    expect(problems).toEqual([]);
    expect(scene.children).toContain(instance.root);
  });

  it("a moment from another person makes a sound here, and the glow fades over frames", async () => {
    const { run, deliver, problems } = world();
    const instance = run("bell", bell);
    await instance.start();
    const before = started;
    deliver({ type: "moment", instance: "bell", name: "ring", data: { v: 0.8 }, by: "baiwei2" } as never);
    expect(started - before).toBe(1);
    for (let i = 0; i < 90; i += 1) instance.frame(0.016, i * 0.016);
    expect(problems).toEqual([]);
  });

  it("disposes cleanly, and frames after that do nothing", async () => {
    const { run, problems } = world();
    const instance = run("bell", bell);
    await instance.start();
    instance.dispose();
    instance.frame(0.016, 1);
    expect(problems).toEqual([]);
    expect(instance.root.parent).toBeNull();
  });

  it("says why on the badge when setup throws (what you would have seen in the room)", async () => {
    const { run, problems } = world();
    const broken = run("broken", thing("item", { name: "Broken", setup(ctx) { (ctx.input as any).drag(new THREE.Object3D(), {}); } }));
    expect(await broken.start()).toBe(false);
    expect(problems[0]).toContain("did not start");
  });
});
