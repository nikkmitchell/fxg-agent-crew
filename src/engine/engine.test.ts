import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EnvStack, type EnvState } from "./env";
import type { Host, QuestionHost, TransportEvent } from "./host";
import { Engine, ThingInstance } from "./instance";
import type { Ctx, Json, ThingDefinition } from "./types";

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

describe("a thing's life", () => {
  it("sets itself up on a root that is not in the room yet, and is attached only once that has worked", async () => {
    const { run, scene } = world();
    let parentDuringSetup: THREE.Object3D | null | undefined;
    const drums = run("drums", thing("item", {
      name: "Drums",
      setup(ctx) {
        parentDuringSetup = ctx.root.parent;
        ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      },
    }));
    expect(await drums.start()).toBe(true);
    expect(parentDuringSetup).toBeNull();
    expect(drums.root.parent).toBe(scene);
  });

  it("leaves nothing in the room, and says why, when setup throws", async () => {
    const { run, scene, problems } = world();
    const broken = run("broken", thing("item", { name: "Broken", setup() { throw new Error("no such file ./drums-math.js"); } }));
    expect(await broken.start()).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(problems[0]).toContain("Broken did not start: Error: no such file ./drums-math.js");
  });

  it("hands what one version saved to the next (a push)", async () => {
    const { run } = world();
    let given: unknown;
    const first = run("glass", thing("item", { name: "Glass", setup: () => ({ save: () => ({ sand: 0.4 }) }) }));
    await first.start();
    const next = run("glass", thing("item", { name: "Glass", setup(ctx) { given = ctx.hot.data; } }), { hot: first.save() });
    await next.start();
    first.dispose();
    expect(given).toEqual({ sand: 0.4 });
  });

  it("takes away everything it registered, frees what it drew, and puts the surroundings back", async () => {
    const { run, env } = world();
    const geometry = new THREE.BoxGeometry();
    let freed = false;
    geometry.addEventListener("dispose", () => (freed = true));
    let frames = 0;
    let disposed = false;
    const forest = run("forest", thing("environment", {
      name: "Forest",
      env: { background: "#2b2140", far: 200 },
      setup(ctx) {
        ctx.root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
        ctx.frame(() => (frames += 1));
        return { dispose: () => (disposed = true) };
      },
    }), { mode: "full", surround: true });
    await forest.start();
    forest.frame(0.016, 0);
    forest.dispose();
    forest.frame(0.016, 0.016);
    expect([frames, disposed, freed, forest.root.parent]).toEqual([1, true, true, null]);
    expect(env).toEqual([{ background: "#2b2140", far: 200 }, "undo"]);
  });

  it("only touches the surroundings while it fills them", async () => {
    const { run, env } = world();
    const model = run("forest", thing("environment", { name: "Forest", env: { background: "#000" }, setup(ctx) { ctx.env.set({ far: 500 }); } }), { mode: "model", surround: false });
    await model.start();
    expect(env).toEqual([]);
  });

  it("pauses a frame callback that keeps throwing, once, and says so", async () => {
    const { run, problems } = world();
    let calls = 0;
    const flaky = run("flaky", thing("item", { name: "Flaky", setup(ctx) { ctx.frame(() => { calls += 1; throw new Error("bad frame"); }); } }));
    await flaky.start();
    for (let i = 0; i < 40; i += 1) flaky.frame(0.016, i);
    expect(calls).toBe(20);
    expect(problems.filter((line) => line.includes("paused after 20 errors"))).toHaveLength(1);
  });
});

describe("shared values and moments", () => {
  it("watch runs at once with what is kept (or the default), then on every change from anyone", async () => {
    const { run, deliver, sent } = world({}, { lamp: { lit: true } });
    const seen: unknown[] = [];
    const lamp = run("lamp", thing("item", {
      name: "Lamp",
      shared: { lit: false, colour: "#ffd27a" },
      setup(ctx) {
        ctx.state.watch(["lit", "colour"], (value) => seen.push(value));
        ctx.state.set("lit", false);
      },
    }));
    await lamp.start();
    deliver({ type: "value", instance: "lamp", key: "lit", value: true, by: "baiwei2" });
    deliver({ type: "value", instance: "other", key: "lit", value: false, by: "baiwei2" });
    expect(seen).toEqual([true, "#ffd27a", false, true]);
    expect(sent).toEqual([["set", "lamp", "lit", false]]);
  });

  it("a moment plays here first and once, goes out once, and others' arrive as theirs", async () => {
    const { run, deliver, sent } = world();
    const heard: unknown[] = [];
    let ctx!: Ctx;
    const drums = run("drums", thing("item", {
      name: "Drums",
      setup(c) {
        ctx = c;
        c.net.onMoment("hit", (data: { d: number }, info) => heard.push([data.d, info.mine, info.from?.name]));
      },
    }));
    await drums.start();
    ctx.net.moment("hit", { d: 2 });
    deliver({ type: "moment", instance: "drums", name: "hit", data: { d: 3 }, from: "baiwei2" });
    expect(heard).toEqual([[2, true, "nikk"], [3, false, "baiwei2"]]);
    expect(sent).toEqual([["moment", "drums", "hit", { d: 2 }]]);
  });
});

describe("a space: things composed, in scenes, with a script", () => {
  const drums = thing("item", {
    name: "Drums",
    setup(ctx) {
      ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      return { api: { hit: () => ctx.net.moment("hit", { d: 0 }) } };
    },
  });
  const stone = thing("item", { name: "Stone", setup(ctx) { ctx.root.add(new THREE.Object3D()); } });

  it("mounts its parts where it says, with their own ids, and hears their moments", async () => {
    const { run, sent } = world({ drums, stone });
    const heard: unknown[] = [];
    const concert = run("concert", thing("space", {
      name: "Concert",
      things: { drums: { ref: "drums", at: [0, 0, -1.3], turn: 90 }, stone: { ref: "stone", at: [0, 0, 1.2] } },
      setup(ctx) {
        ctx.things.drums.onMoment("hit", (data: { d: number }, info) => heard.push([data.d, info.mine]));
        (ctx.things.drums.api.hit as () => void)();
      },
    }));
    expect(await concert.start()).toBe(true);
    const holder = concert.root.getObjectByName("part drums")!;
    expect(holder.position.z).toBeCloseTo(-1.3);
    expect(holder.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(holder.children[0].name).toBe("thing concert/drums");
    expect(heard).toEqual([[0, true]]);
    expect(sent).toEqual([["moment", "concert/drums", "hit", { d: 0 }]]);
  });

  it("follows its shared scene: each scene's parts, and only those", async () => {
    const { run, deliver } = world({ drums, stone });
    const concert = run("concert", thing("space", {
      name: "Concert",
      scenes: { list: ["arrival", "concert"], initial: "arrival" },
      things: { stone: { ref: "stone", in: ["arrival"] }, drums: { ref: "drums", in: ["concert"] } },
    }));
    await concert.start();
    const mounted = () => ["stone", "drums"].filter((key) => (concert.root.getObjectByName(`part ${key}`)?.children.length ?? 0) > 0);
    expect(mounted()).toEqual(["stone"]);
    deliver({ type: "value", instance: "concert", key: "scene", value: "concert", by: "baiwei2" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mounted()).toEqual(["drums"]);
  });

  it("says which part could not be found, and starts the rest", async () => {
    const { run, problems } = world({ drums });
    const concert = run("concert", thing("space", { name: "Concert", things: { drums: { ref: "drums" }, harp: { ref: "harp" } } }));
    expect(await concert.start()).toBe(true);
    expect(problems).toEqual(["concert: harp: nothing called harp to bring in."]);
  });
});

describe("input, in the thing's own frame", () => {
  it("hears a ray press with the point in local metres, and ignores a poke when told to", async () => {
    const { run } = world();
    const presses: unknown[] = [];
    let skin!: THREE.Mesh;
    const drums = run("drums", thing("item", {
      name: "Drums",
      setup(ctx) {
        skin = new THREE.Mesh(new THREE.CircleGeometry(0.2), new THREE.MeshBasicMaterial());
        ctx.root.add(skin);
        ctx.input.press(skin, (e) => presses.push([e.pointer, e.hand, e.point.toArray().map((n) => Math.round(n * 100) / 100)]), { poke: false });
      },
    }), { parent: (() => { const g = new THREE.Group(); g.position.set(2, 0, 0); g.updateMatrixWorld(true); return g; })() });
    await drums.start();
    drums.root.updateMatrixWorld(true);
    // As @pmndrs/pointer-events calls them: a down and an up of one pointer, however long apart.
    const listeners = (skin as unknown as { _listeners: Record<string, Array<(e: unknown) => void>> })._listeners;
    const press = (event: Record<string, unknown>) => {
      listeners.pointerdown[0]({ ...event, stopPropagation: () => undefined });
      listeners.pointerup[0]({ ...event, stopPropagation: () => undefined });
    };
    press({ pointerId: 1, pointerType: "touch", point: new THREE.Vector3(2, 0, 0) });
    press({ pointerId: 2, pointerType: "ray", point: new THREE.Vector3(2.1, 0, 0), pointerState: { inputSource: { handedness: "right" } } });
    expect(presses).toEqual([["ray", "right", [0.1, 0, 0]]]);
  });

  it("feels a strike from a hand coming down through a surface, by world speed, in a turned and scaled thing", async () => {
    const { run, engine } = world();
    const strikes: number[] = [];
    const parent = new THREE.Group();
    parent.position.set(1, 0.8, 0);
    parent.rotation.y = Math.PI / 2;
    parent.scale.setScalar(2);
    parent.updateMatrixWorld(true);
    const drums = run("drums", thing("item", {
      name: "Drums",
      setup(ctx) {
        const skin = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        skin.rotation.x = -Math.PI / 2;
        ctx.root.add(skin);
        ctx.input.strike(skin, (e) => strikes.push(Math.round(e.strength * 100) / 100));
      },
    }), { parent });
    await drums.start();
    drums.root.updateMatrixWorld(true);
    const at = (y: number) => ({
      session: { inputSources: [{ handedness: "right", gripSpace: {} }] },
      getPose: () => ({ transform: { matrix: new THREE.Matrix4().makeTranslation(1, y, 0).toArray() } }),
    }) as unknown as XRFrame;
    // From 5 cm above the skin to 5 cm below it in a sixtieth of a second: 6 m/s.
    engine.frame({ frame: at(0.85), referenceSpace: {} as XRReferenceSpace });
    drums.frame(1 / 60, 0);
    engine.frame({ frame: at(0.75), referenceSpace: {} as XRReferenceSpace });
    drums.frame(1 / 60, 1 / 60);
    // Still below it: not again until the hand has lifted clear.
    engine.frame({ frame: at(0.74), referenceSpace: {} as XRReferenceSpace });
    drums.frame(1 / 60, 2 / 60);
    expect(strikes).toEqual([1]);
  });
});

describe("questions (ctx.questions, Mica 7319)", () => {
  const asker = (capture: { ctx?: Ctx }) => thing("item", { name: "Lectern", setup(ctx) { capture.ctx = ctx; } });

  it("asks through the host's panel, and taking the thing away closes it: never a stale Send", async () => {
    const { host, run } = world();
    const asked: Array<{ instance: string; prompt?: string; near?: THREE.Object3D }> = [];
    let closed = 0;
    (host as { questions?: QuestionHost }).questions = {
      ask: (instance, options) => {
        asked.push({ instance, ...options });
        return { result: new Promise(() => undefined), close: () => void closed++ };
      },
      list: async () => [],
    };
    const capture: { ctx?: Ctx } = {};
    const lectern = run("library/lectern", asker(capture));
    await lectern.start();
    const pad = new THREE.Object3D();
    void capture.ctx!.questions.ask({ prompt: "Ask the Library", near: pad });
    expect(asked).toEqual([{ instance: "library/lectern", prompt: "Ask the Library", near: pad }]);
    expect(closed).toBe(0);
    lectern.dispose();
    expect(closed).toBe(1);
    // Gone is gone: a later ask is answered here, without opening anything.
    expect(await capture.ctx!.questions.ask()).toMatchObject({ ok: false, why: "removed" });
    expect(asked).toHaveLength(1);
  });

  it("says plainly when the page has no room to ask in", async () => {
    const { run } = world();
    const capture: { ctx?: Ctx } = {};
    await run("lectern", asker(capture)).start();
    expect(await capture.ctx!.questions.ask()).toMatchObject({ ok: false, why: "not-here" });
    await expect(capture.ctx!.questions.list()).rejects.toMatchObject({ why: "not-here" });
  });
});
