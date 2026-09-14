import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  AGENT_ANIMATION_FILES,
  agentAnimationSelection,
  agentAnimationState,
  animationVariant,
  lockHorizontalHips,
  transitionClip,
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
