import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "../../../shared/space-wire";
import { moduleRoom } from "./module-room";
import { runModule, type ModuleRoom } from "./run-module";

const fakeRoom = (): ModuleRoom => ({ you: null, state: {}, set: () => undefined, emit: () => undefined, on: () => () => undefined, people: new Map(), others: () => [], ready: true, connected: true, guest: false });

function setup(module: Record<string, unknown>, extra: { exportName?: string | null; mode?: "item" | "model" | "full" } = {}) {
  const world = new THREE.Scene();
  const root = new THREE.Group();
  world.add(root);
  const problems: string[] = [];
  const run = runModule({
    url: "https://saha.ing/s/xr.instruments/~d1/pieces/drums.js",
    exportName: extra.exportName ?? null,
    id: "item-1",
    mode: extra.mode ?? "item",
    root,
    world,
    camera: new THREE.PerspectiveCamera(),
    renderer: {} as THREE.WebGLRenderer,
    room: fakeRoom(),
    onProblem: (text) => problems.push(text),
    importModule: async () => module,
  });
  return { run, root, world, problems };
}

describe("running a thing from a space in the room", () => {
  it("calls the default export with the room's own scene place, camera, renderer and three.js, and updates it every frame", async () => {
    const seen: Record<string, unknown> = {};
    const frames: number[] = [];
    const { run, root } = setup({
      default: (options: Record<string, unknown> & { scene: THREE.Group; THREE: typeof THREE; saha: { url: (path: string) => string; mode: string } }) => {
        Object.assign(seen, { scene: options.scene, THREE: options.THREE, mode: options.saha.mode, url: options.saha.url("models/drum.glb") });
        options.scene.add(new options.THREE.Mesh(new options.THREE.BoxGeometry(), new options.THREE.MeshStandardMaterial()));
        return { update: (dt: number) => frames.push(dt) };
      },
    });
    const running = await run;
    expect(seen.scene).toBe(root);
    expect(seen.THREE).toBe(THREE);
    expect(seen.mode).toBe("item");
    expect(seen.url).toBe("https://saha.ing/s/xr.instruments/~d1/pieces/models/drum.glb");
    running.update(0.016, 1);
    running.update(0.017, 1.017);
    expect(frames).toEqual([0.016, 0.017]);
    expect(root.children).toHaveLength(1);
    expect(running.failed).toBeNull();
  });

  it("calls a named factory the way a space's page does (Sill's createDrums)", async () => {
    let given: Record<string, unknown> = {};
    const { run } = setup({ createDrums: (options: Record<string, unknown>) => ((given = options), { update() {} }) }, { exportName: "createDrums" });
    await run;
    expect(given.at).toEqual([0, 0, 0]);
    expect(given.rotationY).toBe(0);
    expect(given.id).toBe("item-1");
    expect(typeof (given.room as ModuleRoom).emit).toBe("function");
  });

  it("takes everything away when it unloads, and gives the room its background and fog back", async () => {
    let disposed = false;
    const { run, root, world } = setup({
      default: ({ scene, saha }: { scene: THREE.Group; saha: { world: THREE.Scene } }) => {
        saha.world.background = new THREE.Color("#102030");
        saha.world.fog = new THREE.Fog("#102030", 1, 40);
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial()));
        return { dispose: () => (disposed = true) };
      },
    }, { mode: "full" });
    world.background = new THREE.Color("#0b0d12");
    const before = world.background;
    const running = await run;
    expect(world.fog).not.toBeNull();
    running.dispose();
    expect(disposed).toBe(true);
    expect(root.children).toHaveLength(0);
    expect(world.fog).toBeNull();
    // The background as it was when the thing started.
    expect(world.background).not.toBe(before);
  });

  it("says why a thing did not start, and leaves the room running", async () => {
    const missing = await setup({}).run;
    expect(missing.failed).toContain("default export");
    const wrongName = setup({ default: () => ({}) }, { exportName: "createTheremin" });
    expect((await wrongName.run).failed).toContain("createTheremin");
    const throws = setup({ default: () => { throw new Error("no canvas here"); } });
    expect((await throws.run).failed).toContain("no canvas here");
    expect(throws.problems[0]).toContain("Could not start");
  });

  it("stops calling an update that keeps throwing, once, and says so", async () => {
    let calls = 0;
    const { run, problems } = setup({ default: () => ({ update: () => { calls += 1; throw new Error("bad frame"); } }) });
    const running = await run;
    for (let i = 0; i < 50; i += 1) running.update(0.016, i);
    expect(calls).toBe(20);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bad frame");
  });

  it("hands a press to whatever the thing said it wants to hear, from anything inside it", async () => {
    const pressed: unknown[] = [];
    let drumHead: THREE.Mesh | null = null;
    const { run } = setup({
      default: ({ scene, saha }: { scene: THREE.Group; saha: { onPress: (object: THREE.Object3D, fn: (info: unknown) => void) => void } }) => {
        const drum = new THREE.Group();
        drumHead = new THREE.Mesh(new THREE.CircleGeometry(), new THREE.MeshBasicMaterial());
        drum.add(drumHead);
        scene.add(drum);
        saha.onPress(drum, (info) => pressed.push(info));
      },
    });
    const running = await run;
    expect(running.press(drumHead!, { point: null, by: { id: "baiwei2", name: "Baiwei" } })).toBe(true);
    expect(running.press(new THREE.Object3D(), { point: null, by: null })).toBe(false);
    expect(pressed).toEqual([{ point: null, by: { id: "baiwei2", name: "Baiwei" } }]);
  });
});

describe("a thing's room: its copies in this saha.ing room, over the room socket", () => {
  const wire = () => {
    const sent: ClientMessage[] = [];
    const listeners = new Set<(message: ServerMessage) => void>();
    return {
      sent,
      deliver: (message: ServerMessage) => listeners.forEach((listener) => listener(message)),
      send: (message: ClientMessage) => sent.push(message),
      subscribe: (listener: (message: ServerMessage) => void) => (listeners.add(listener), () => listeners.delete(listener)),
    };
  };

  it("sends a moment to the others, and hears theirs, for this item only", () => {
    const socket = wire();
    const room = moduleRoom({ item: "drums-1", you: { id: "Nikk2", name: "Nikk2" }, send: socket.send, subscribe: socket.subscribe });
    const heard: unknown[] = [];
    room.on("event", ((name: string, data: unknown, from: string) => heard.push([name, data, from])) as never);
    room.emit("hit", { drum: 1 });
    expect(socket.sent).toEqual([{ type: "moduleEvent", item: "drums-1", name: "hit", data: { drum: 1 } }]);
    socket.deliver({ type: "moduleEvent", item: "drums-1", name: "hit", data: { drum: 3 }, from: "baiwei2" });
    socket.deliver({ type: "moduleEvent", item: "drums-2", name: "hit", data: { drum: 9 }, from: "baiwei2" });
    expect(heard).toEqual([["hit", { drum: 3 }, "baiwei2"]]);
  });

  it("changes a value here at once, and takes everyone else's", () => {
    const socket = wire();
    const room = moduleRoom({ item: "garden", you: { id: "Nikk2", name: "Nikk2" }, send: socket.send, subscribe: socket.subscribe, state: { raked: 3 } });
    const changes: unknown[] = [];
    room.on("state", ((key: string, value: unknown, by: string) => changes.push([key, value, by])) as never);
    room.set("raked", 4);
    expect(room.state).toEqual({ raked: 4 });
    expect(socket.sent).toEqual([{ type: "moduleState", item: "garden", key: "raked", value: 4 }]);
    socket.deliver({ type: "moduleState", item: "garden", key: "stone", value: "moved", by: "baiwei2" });
    socket.deliver({ type: "moduleState", item: "garden", key: "raked", value: null, by: "baiwei2" });
    expect(room.state).toEqual({ stone: "moved" });
    expect(changes).toEqual([["raked", 4, "Nikk2"], ["stone", "moved", "baiwei2"], ["raked", null, "baiwei2"]]);
    room.close();
    socket.deliver({ type: "moduleState", item: "garden", key: "late", value: 1, by: "baiwei2" });
    expect(room.state).toEqual({ stone: "moved" });
  });
});
