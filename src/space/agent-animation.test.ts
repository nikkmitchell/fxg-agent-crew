import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  AGENT_ANIMATION_FILES,
  agentAnimationState,
  lockHorizontalHips,
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
    expect(state({ attending: true })).toBe("thinking");
    expect(state()).toBe("idle");
  });

  it("lets locomotion win over poses and speech", () => {
    expect(state({ moving: true, speaking: true, posture: "thinking" })).toBe("walking");
  });

  it("uses a non-oscillating idle frame when reduced motion is requested", () => {
    expect(state({ moving: true, speaking: true, reducedMotion: true })).toBe("idle");
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
