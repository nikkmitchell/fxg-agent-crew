import { describe, expect, it } from "vitest";
import { AGENT_SCREEN, SCREEN_ROW, agentScreenPose, agentScreenShown, captureSize, screenLabel, screenPlacement, screenSize } from "./screens";

describe("where shared screens hang", () => {
  it("puts a single screen straight ahead", () => {
    const one = screenPlacement(0, 1);
    expect(one.position.x).toBeCloseTo(0, 6);
    expect(one.rotationY).toBeCloseTo(0, 6);
  });

  it("keeps every screen clear of the panels beneath it", () => {
    // Panels are 2.5 m tall centred at 1.65 m: top edge 2.9 m. A screen that
    // covered a board would trade one piece of information for another.
    const bottom = SCREEN_ROW.y - SCREEN_ROW.maxHeight / 2;
    expect(bottom).toBeGreaterThan(2.9);
  });

  it("keeps neighbouring screens from overlapping, however many people share", () => {
    for (const count of [2, 3, 6, 10]) {
      for (let i = 0; i + 1 < count; i += 1) {
        const a = screenPlacement(i, count).position;
        const b = screenPlacement(i + 1, count).position;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i} of ${count}`).toBeGreaterThan(SCREEN_ROW.width);
      }
    }
  });

  it("turns every screen to face the middle of the room", () => {
    // A plane faces +z rotated by rotationY; its normal must point at the focus.
    for (let i = 0; i < 5; i += 1) {
      const { position, rotationY } = screenPlacement(i, 5);
      const normal = { x: Math.sin(rotationY), z: Math.cos(rotationY) };
      const toFocus = { x: SCREEN_ROW.focus.x - position.x, z: SCREEN_ROW.focus.z - position.z };
      const length = Math.hypot(toFocus.x, toFocus.z);
      expect(normal.x * (toFocus.x / length) + normal.z * (toFocus.z / length)).toBeCloseTo(1, 6);
    }
  });
});

describe("the shape of a shared screen", () => {
  it("never stretches the picture", () => {
    for (const [w, h] of [[1280, 720], [1280, 800], [720, 1280], [3440, 1440], [800, 800]]) {
      const size = screenSize(w, h);
      expect(size.width / size.height).toBeCloseTo(w / h, 6);
      expect(size.width).toBeLessThanOrEqual(SCREEN_ROW.width + 1e-9);
      expect(size.height).toBeLessThanOrEqual(SCREEN_ROW.maxHeight + 1e-9);
    }
  });

  it("captures inside 1280x720 without stretching or enlarging", () => {
    expect(captureSize(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(captureSize(2560, 1600)).toEqual({ width: 1152, height: 720 });
    expect(captureSize(640, 480)).toEqual({ width: 640, height: 480 });
    const tall = captureSize(1080, 1920);
    expect(tall.height).toBe(720);
    expect(tall.width / tall.height).toBeCloseTo(1080 / 1920, 2);
  });
});

describe("how a screen is named in the room", () => {
  it("names the owner alone when they shared it themselves", () => {
    expect(screenLabel({ actorId: "Sill", sharedBy: null })).toBe("Sill's screen");
    expect(screenLabel({ actorId: "Sill", sharedBy: "sill" })).toBe("Sill's screen");
  });

  it("names both when somebody shared it for them", () => {
    expect(screenLabel({ actorId: "Sill", sharedBy: "Nikk2" })).toBe("Sill's screen · shared by Nikk2");
  });
});

describe("an agent's own screen", () => {
  const person = (over: Record<string, unknown> = {}) => ({
    moving: false, because: null, attending: null, avatar: { posture: "thinking" }, ...over,
  });

  it("shows while the agent is working at its own space", () => {
    expect(agentScreenShown(person())).toBe(true);
  });

  it("goes away while the agent walks", () => {
    expect(agentScreenShown(person({ moving: true }))).toBe(false);
  });

  it("goes away while the agent is at a board, and comes back when it returns", () => {
    // Nikk: "their screen can disappear if they go walk to the mood board or
    // walk to the job board... once they finish... they reopen their screen".
    expect(agentScreenShown(person({ because: "commented on a card" }))).toBe(false);
    expect(agentScreenShown(person({ because: "was considering the mood board" }))).toBe(false);
    expect(agentScreenShown(person({ because: null }))).toBe(true);
  });

  it("does not show over an agent that has gone quiet, even if its share is still running", () => {
    // Nikk: "it usually doesn't appear unless they're working on something".
    expect(agentScreenShown(person({ avatar: { posture: "sleeping" } }))).toBe(false);
  });

  it("shows while an agent has said it is composing a reply", () => {
    expect(agentScreenShown(person({ avatar: { posture: "sleeping" }, attending: { utteranceId: 4 } }))).toBe(true);
  });

  it("sits in front of the agent, whichever way it faces", () => {
    // Facing 0 looks toward -Z; the screen must be on that side of the agent.
    const ahead = agentScreenPose({ x: 1, z: 1 }, 0).position;
    expect(ahead.z).toBeLessThan(1);
    expect(ahead.x).toBeCloseTo(1, 6);
    for (const facing of [0, 1, -2, Math.PI]) {
      const { position } = agentScreenPose({ x: 2, z: -3 }, facing);
      expect(Math.hypot(position.x - 2, position.z + 3)).toBeCloseTo(AGENT_SCREEN.ahead, 6);
      // And along the direction presence.ts's facingToward means by `facing`.
      const target = { x: 2 - Math.sin(facing), z: -3 - Math.cos(facing) };
      const expected = Math.atan2(2 - target.x, -3 - target.z);
      expect(Math.cos(expected - facing)).toBeCloseTo(1, 6);
    }
  });

  it("is a personal monitor, smaller than a wall screen, and never stretched", () => {
    const size = screenSize(1920, 1080, AGENT_SCREEN);
    expect(size.width).toBeLessThanOrEqual(AGENT_SCREEN.width + 1e-9);
    expect(size.width / size.height).toBeCloseTo(1920 / 1080, 6);
    expect(AGENT_SCREEN.width).toBeLessThan(SCREEN_ROW.width);
  });
});
