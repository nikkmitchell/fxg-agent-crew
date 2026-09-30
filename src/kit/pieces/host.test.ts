import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PIECE_LIMITS } from "../../../shared/piece-wire";
import { PieceHost, type PieceHostOptions, type WorkerLike } from "./host";
import { PIECE_RUNTIME } from "./runtime-source";

/**
 * The runtime that ships (PIECE_RUNTIME), run in this process in place of a
 * worker, talking to a real PieceHost: what a piece does here is what it
 * does in a headset, minus the drawing on a screen.
 */
type Piece = (saha: any) => unknown;

function inProcess(piece: Piece | { notAFunction: true } | Error) {
  const workerListeners: Array<(event: { data: unknown }) => void> = [];
  let terminated = false;
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => {
      const copy = structuredClone(message);
      queueMicrotask(() => {
        if (!terminated) for (const listener of workerListeners) listener({ data: copy });
      });
    },
    terminate: () => {
      terminated = true;
    },
  };
  const self = {
    postMessage: (message: unknown) => {
      const copy = structuredClone(message);
      queueMicrotask(() => {
        if (!terminated) worker.onmessage?.({ data: copy });
      });
    },
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => workerListeners.push(listener),
  };
  const importPiece = async () => {
    if (piece instanceof Error) throw piece;
    return typeof piece === "function" ? { default: piece } : {};
  };
  new Function("self", "importPiece", PIECE_RUNTIME)(self, importPiece);
  return { worker, isTerminated: () => terminated };
}

const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

function host(piece: Piece | { notAFunction: true } | Error, extra: Partial<PieceHostOptions> = {}) {
  const shared: Array<[string, unknown]> = [];
  const moments: Array<[string, unknown]> = [];
  const problems: string[] = [];
  const logs: string[] = [];
  const sounds: unknown[] = [];
  let now = 0;
  const running = inProcess(piece);
  const pieceHost = new PieceHost({
    url: "https://saha.ing/s/xr.instruments/pieces/drums.js?v=d1",
    space: "xr.instruments",
    env: "room",
    you: { id: "Nikk2", name: "Nikk2" },
    share: { set: (k, v) => shared.push([k, v]), emit: (name, data) => moments.push([name, data]) },
    audio: { tone: (sound) => sounds.push(sound), sample: (url) => sounds.push(url) },
    onProblem: (text) => problems.push(text),
    onLog: (text) => logs.push(text),
    startWorker: () => running.worker,
    now: () => now,
    ...extra,
  });
  return { pieceHost, shared, moments, problems, logs, sounds, running, pass: (ms: number) => (now += ms) };
}

const meshes = (group: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found.push(child as THREE.Mesh);
  });
  return found;
};

describe("a live piece, hosted", () => {
  it("draws what it adds, where it says, in its colour", async () => {
    const { pieceHost } = host((saha) => {
      saha.add({ shape: "cylinder", size: [0.18, 0.12], color: "#a0522d", at: [0, 0.06, 0] });
      saha.add({ shape: "sphere", size: [0.05], at: [0.3, 0.1, 0] });
    });
    await settle();
    const drawn = meshes(pieceHost.group);
    expect(drawn).toHaveLength(2);
    expect((drawn[0].material as THREE.MeshStandardMaterial).color.getHexString()).toBe("a0522d");
    expect(drawn[0].parent!.position.toArray()).toEqual([0, 0.06, 0]);
    expect(pieceHost.ready).toBe(true);
  });

  it("hears a press on a pressable part, and answers it; other parts let the pointer through", async () => {
    const { pieceHost, moments } = host((saha) => {
      const drum = saha.add({ shape: "cylinder", size: [0.18, 0.12], pressable: true });
      saha.add({ shape: "box", at: [1, 0, 0] });
      drum.on("press", (info: { by: { name: string } }) => {
        drum.set({ color: "#ffcc00" });
        saha.emit("hit", { by: info.by.name });
      });
    });
    await settle();
    const [drum, block] = meshes(pieceHost.group);
    const hits: THREE.Intersection[] = [];
    block.raycast(new THREE.Raycaster(new THREE.Vector3(1, 0, 5), new THREE.Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(0);
    expect(pieceHost.pressables()).toHaveLength(1);
    expect(pieceHost.press(drum, { id: "baiwei2", name: "Baiwei" }, "right")).toBe(true);
    expect(pieceHost.press(block, null, "right")).toBe(false);
    await settle();
    expect((drum.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("ffcc00");
    expect(moments).toEqual([["hit", { by: "Baiwei" }]]);
  });

  it("shares values and moments through the page, and hears everyone else's", async () => {
    const { pieceHost, shared, moments } = host((saha) => {
      saha.on("state", (key: string, value: unknown, by: string) => saha.add({ text: `${key}=${JSON.stringify(value)} by ${by}` }));
      saha.on("event", (name: string, _data: unknown, from: string) => {
        if (from !== saha.you.id) saha.set("heard", name);
      });
    }, { makeText: (words) => Object.assign(new THREE.Object3D(), { name: words }) });
    await settle();
    pieceHost.receiveEvent("hit", { hz: 110 }, "baiwei2");
    pieceHost.receiveState("tempo", 90, "baiwei2");
    await settle();
    expect(shared).toEqual([["heard", "hit"]]);
    expect(moments).toEqual([]);
    const words: string[] = [];
    pieceHost.group.traverse((child) => { if (child.name.includes("=")) words.push(child.name); });
    expect(words).toContain("heard=\"hit\" by Nikk2");
    expect(words).toContain("tempo=90 by baiwei2");
  });

  it("plays sounds within the budget, and only its own space's samples", async () => {
    const { pieceHost, sounds } = host((saha) => {
      for (let i = 0; i < 50; i += 1) saha.sound({ tone: 220 });
      saha.sound({ url: "hit.ogg" });
    });
    await settle(40);
    expect(sounds.filter((sound) => typeof sound === "object")).toHaveLength(PIECE_LIMITS.soundsPerSecond);
    expect(pieceHost.ready).toBe(true);
  });

  it("moves a part smoothly with tween, and spins one without sending anything", async () => {
    const { pieceHost, pass } = host((saha) => {
      saha.add({ shape: "box", at: [0, 0, 0] }).tween({ at: [1, 0, 0] }, 1000);
      saha.add({ shape: "box", spin: 2 });
    });
    await settle();
    const [moving, spinning] = pieceHost.group.children;
    pass(500);
    pieceHost.tick(0.5);
    expect(moving.position.x).toBeCloseTo(0.5, 5);
    pass(600);
    pieceHost.tick(0.5);
    expect(moving.position.x).toBe(1);
    expect(spinning.rotation.y).toBeCloseTo(2, 5);
  });

  it("removes a part and everything standing on it", async () => {
    const { pieceHost } = host((saha) => {
      const table = saha.add({ shape: "box", size: [1, 0.05, 0.5] });
      table.add({ shape: "sphere", at: [0, 0.1, 0] });
      setTimeout(() => table.remove(), 0);
    });
    await settle();
    expect(meshes(pieceHost.group)).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await settle();
    expect(meshes(pieceHost.group)).toHaveLength(0);
  });

  it("keeps to its limits: parts, and messages a second", async () => {
    const { pieceHost, problems } = host((saha) => {
      for (let i = 0; i < PIECE_LIMITS.perSecond + 10; i += 1) saha.add({ shape: "box" });
    });
    await settle(60);
    expect(meshes(pieceHost.group).length).toBeLessThanOrEqual(PIECE_LIMITS.nodes);
    expect(problems.some((text) => text.includes("messages a second"))).toBe(true);
  });

  it("says why a piece did not start, and keeps the room going", async () => {
    const wrong = host({ notAFunction: true });
    await settle();
    expect(wrong.problems[0]).toContain("export default function (saha)");
    const broken = host(new Error("SyntaxError: nope"));
    await settle();
    expect(broken.problems[0]).toContain("nope");
  });

  it("reports a handler that throws, and carries on", async () => {
    const { pieceHost, logs, moments } = host((saha) => {
      const drum = saha.add({ shape: "box", pressable: true });
      drum.on("press", () => { throw new Error("oops"); });
      drum.on("press", () => saha.emit("still", 1));
    });
    await settle();
    pieceHost.press(meshes(pieceHost.group)[0], null, "pointer");
    await settle();
    expect(logs[0]).toContain("oops");
    expect(moments).toEqual([["still", 1]]);
  });

  it("is stopped, and everything it drew taken away, when it stops answering", async () => {
    const { pieceHost, running, problems, pass } = host((saha) => {
      saha.add({ shape: "box" });
    });
    await settle();
    const room = new THREE.Scene();
    room.add(pieceHost.group);
    pass(1000);
    pieceHost.tick(0.016);
    await settle();
    // It answered that ping: still going.
    pass(1000);
    pieceHost.tick(0.016);
    expect(pieceHost.running).toBe(true);
    // Now nothing answers (a piece stuck in a loop would be like this).
    running.worker.terminate();
    pass(PIECE_LIMITS.silentMs + 1);
    pieceHost.tick(0.016);
    expect(pieceHost.running).toBe(false);
    expect(room.children).toHaveLength(0);
    expect(problems.at(-1)).toContain("stopped answering");
  });
});
