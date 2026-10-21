import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import {
  AGENT_ANIMATION_FILES,
  agentAnimationSelection,
  agentAnimationState,
  animationVariant,
  createAgentAnimationPlayer,
  lockHorizontalHips,
  transitionClip,
  type AgentAnimationClip,
  type AgentAnimationSelection,
  type AgentAnimationState,
} from "./agent-animation";

const state = (changes: Partial<Parameters<typeof agentAnimationState>[0]> = {}) =>
  agentAnimationState({
    moving: false,
    speaking: false,
    attending: false,
    posture: "resting",
    reducedMotion: false,
    ...changes,
  });

describe("agent animation selection", () => {
  it("uses authored clips for locomotion, conversation, thought, and rest", () => {
    expect(state({ moving: true })).toBe("walking");
    expect(state({ speaking: true })).toBe("talking");
    expect(state({ posture: "thinking" })).toBe("thinking");
    expect(state({ attending: true })).toBe("listening");
    expect(state()).toBe("idle");
  });

  it("turns persistent agent choices into distinct authored states", () => {
    expect(state({ posture: "listening" })).toBe("listening");
    expect(state({ posture: "presenting" })).toBe("presenting");
    expect(state({ posture: "celebrating" })).toBe("celebrating");
    expect(state({ posture: "relaxed" })).toBe("relaxed");
    // An agent sitting a session out (Sill, 5479).
    expect(state({ posture: "meditating" })).toBe("meditating");
    expect(state({ posture: "sleeping" }), "lying down asleep, not standing idle").toBe("sleeping");
    expect(state({ speaking: true, posture: "presenting" })).toBe("presenting");
  });

  it("lets locomotion win over poses and speech", () => {
    expect(state({ moving: true, speaking: true, posture: "thinking" })).toBe("walking");
  });

  it("uses a non-oscillating idle frame when reduced motion is requested", () => {
    expect(state({ moving: true, speaking: true, reducedMotion: true })).toBe("idle");
  });

  it("uses authored starts and stops only at the locomotion boundary", () => {
    expect(transitionClip("idle", "walking")).toBe("walkStart");
    expect(transitionClip("walking", "thinking")).toBe("walkStop");
    expect(transitionClip("talking", "thinking")).toBeNull();
  });
});

describe("animation direction", () => {
  const selection = (changes: Partial<Parameters<typeof agentAnimationSelection>[0]> = {}) =>
    agentAnimationSelection({
      actorId: "Inkstone",
      moving: false,
      speaking: false,
      attending: false,
      mood: "neutral",
      posture: "resting",
      gesture: null,
      gestureStartedAt: null,
      reducedMotion: false,
      nowMs: 1_000,
      ...changes,
    });

  it("varies long poses deterministically and offsets actors", () => {
    expect(animationVariant("idle", "Inkstone", 1_000)).toBe(
      animationVariant("idle", "Inkstone", 1_000),
    );
    const observed = new Set(
      Array.from({ length: 20 }, (_, index) =>
        animationVariant("idle", "Inkstone", index * 30_000),
      ),
    );
    expect(observed.size).toBeGreaterThan(1);
  });

  it("maps mood to a gait without giving the clip ownership of room position", () => {
    expect(selection({ moving: true, mood: "focused" }).clip).toBe("walkingFast");
    expect(selection({ moving: true, mood: "concerned" }).clip).toBe("walkingSlow");
    expect(selection({ moving: true, mood: "neutral" }).clip).toBe("walking");
  });

  it("plays bounded gestures only while standing and keeps their event token", () => {
    expect(selection({ gesture: "shrug", gestureStartedAt: 42 })).toMatchObject({
      gestureClip: "gestureShrug",
      gestureToken: 42,
    });
    expect(selection({ moving: true, gesture: "wave", gestureStartedAt: 42 })).toMatchObject({
      gestureClip: null,
      gestureToken: null,
    });
  });
});

describe("room-owned locomotion", () => {
  it("removes horizontal travel from a VRMA hips track but preserves its bounce", () => {
    const track = new THREE.VectorKeyframeTrack(
      "Normalized_hips.position",
      [0, 1, 2],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    const clip = lockHorizontalHips(new THREE.AnimationClip("walk", 2, [track]));
    expect(Array.from(clip.tracks[0].values)).toEqual([1, 2, 3, 1, 5, 3, 1, 8, 3]);
    expect(Array.from(track.values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("licensed VRMA assets", () => {
  it.each(Object.values(AGENT_ANIMATION_FILES))("ships %s with the VRM animation extension", (file) => {
    const bytes = readFileSync(new URL(`../../public/animations/${file}`, import.meta.url));
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.includes(Buffer.from("VRMC_vrm_animation"))).toBe(true);
  });

  it("ships the upstream attribution beside the assets", () => {
    const notice = readFileSync(
      new URL("../../public/animations/NOTICE.md", import.meta.url),
      "utf8",
    );
    expect(notice).toContain("Overte");
    expect(notice).toContain("Apache License");
  });
});

/**
 * A FIGURE MOVES AS SOON AS ITS IDLE ARRIVES (Kerf, 2026-10-22). The player
 * waited for all 24 clips, about a minute on saha.ing's link, and lost all
 * authored motion when any one failed. These drive the real player with a
 * stand-in body (one bone) and clips handed over one at a time.
 */
describe("clips that arrive one at a time", () => {
  const ANGLES: Partial<Record<AgentAnimationClip, number>> = { idle: 0.1, thinking: 0.5, walking: 0.9, talking: 1.3 };
  const clipOf = (key: AgentAnimationClip) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ANGLES[key] ?? 2);
    return new THREE.AnimationClip(key, 1, [new THREE.QuaternionKeyframeTrack("hips.quaternion", [0, 1], [...q.toArray(), ...q.toArray()])]);
  };
  const setUp = (fails: AgentAnimationClip[] = []) => {
    const scene = new THREE.Object3D();
    const hips = new THREE.Object3D();
    hips.name = "hips";
    scene.add(hips);
    const waiting = new Map<AgentAnimationClip, { give: () => void }>();
    const asked: AgentAnimationClip[] = [];
    const clipFor = (key: AgentAnimationClip) => {
      asked.push(key);
      if (key === "idle") return Promise.resolve(clipOf(key));
      return new Promise<THREE.AnimationClip>((resolve, reject) => {
        waiting.set(key, { give: () => (fails.includes(key) ? reject(new Error(`${key} did not arrive`)) : resolve(clipOf(key))) });
      });
    };
    const give = async (...keys: AgentAnimationClip[]) => {
      for (const key of keys) waiting.get(key)?.give();
      await new Promise((settle) => setTimeout(settle, 0));
    };
    const turn = () => 2 * Math.atan2(hips.quaternion.y, hips.quaternion.w);
    return { body: { scene, lookAt: null } as unknown as VRM, clipFor, give, asked, turn };
  };
  const select = (state: AgentAnimationState, clip: AgentAnimationClip, gestureClip: AgentAnimationClip | null = null, gestureToken: number | null = null) =>
    ({ state, clip, gestureClip, gestureToken });
  const play = (player: Awaited<ReturnType<typeof createAgentAnimationPlayer>>, selection: AgentAnimationSelection) => {
    for (let frame = 0; frame < 4; frame += 1) player.update(0.25, selection, false);
  };

  it("starts on idle while everything else is still coming, then plays the clip asked for when it arrives", async () => {
    const { body, clipFor, give, asked, turn } = setUp();
    const player = await createAgentAnimationPlayer(body, clipFor);
    expect(asked.slice(0, 4), "idle alone first, then the walk").toEqual(["idle", "walking", "walkStart", "walkStop"]);
    play(player, select("thinking", "thinking"));
    expect(turn(), "a stand-in from what has arrived, not the rest pose").toBeCloseTo(ANGLES.idle!, 3);
    await give("walking", "walkStart", "walkStop");
    await give("thinking");
    play(player, select("thinking", "thinking"));
    expect(turn()).toBeCloseTo(ANGLES.thinking!, 3);
    player.dispose();
  });

  it("walks without waiting for a walk start still on its way", async () => {
    const { body, clipFor, give, turn } = setUp();
    const player = await createAgentAnimationPlayer(body, clipFor);
    play(player, select("idle", "idle"));
    await give("walking");
    play(player, select("walking", "walking"));
    expect(turn()).toBeCloseTo(ANGLES.walking!, 3);
    player.dispose();
  });

  it("loses only the clip that fails to arrive", async () => {
    const { body, clipFor, give, turn } = setUp(["gestureWave", "walkStart"]);
    const player = await createAgentAnimationPlayer(body, clipFor);
    await give("walking", "walkStart", "walkStop");
    await give("talking", "thinking", "listening");
    play(player, select("talking", "talking", "gestureWave", 1));
    expect(turn(), "talking carries on; the wave is simply not played").toBeCloseTo(ANGLES.talking!, 3);
    player.dispose();
  });

  it("adds nothing after it is put away", async () => {
    const { body, clipFor, give } = setUp();
    const player = await createAgentAnimationPlayer(body, clipFor);
    player.dispose();
    await expect(give("walking", "walkStart", "walkStop")).resolves.toBeUndefined();
  });
});
