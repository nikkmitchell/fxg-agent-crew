import { describe, expect, it } from "vitest";
import {
  HOLD_MS,
  TAP_SLOP,
  carrying,
  stepGesture,
  type Gesture,
  type GestureOutcome,
  type PointerSource,
  type SurfaceEvent,
  type SurfaceHit,
} from "./surface-input.js";

/**
 * The gesture machine, driven by every device in turn.
 *
 * THE POINT OF THE WHOLE FILE is that a panel cannot tell which device it is
 * being touched by. So the central test here runs the identical script as a
 * mouse, a controller and a hand, and asserts the three outcomes are equal. If
 * that ever fails, "one room" has stopped being true.
 */

const hit = (u: number, v: number, panelId = "board"): SurfaceHit => ({ panelId, u, v });

/** Run a script and collect what came out. */
const run = (events: SurfaceEvent[]): { state: Gesture; outcomes: GestureOutcome[] } => {
  let state: Gesture = { kind: "idle" };
  const outcomes: GestureOutcome[] = [];
  for (const event of events) {
    const next = stepGesture(state, event);
    state = next.state;
    if (next.outcome) outcomes.push(next.outcome);
  }
  return { state, outcomes };
};

const dragScript = (source: PointerSource): SurfaceEvent[] => [
  { type: "down", source, hit: hit(0.2, 0.8), at: 0 },
  { type: "move", source, hit: hit(0.5, 0.5), at: 50 },
  { type: "up", source, hit: hit(0.7, 0.3), at: 90 },
];

describe("every device produces the same gesture", () => {
  it("a mouse, a controller and a hand all drag identically", () => {
    // If this fails, the two rooms have started to differ again.
    const results = (["mouse", "controller", "hand"] as const).map((source) => run(dragScript(source)).outcomes);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0]).toEqual([{ kind: "drop", from: hit(0.2, 0.8), over: hit(0.7, 0.3) }]);
  });

  it("a tap is a tap on all three", () => {
    const results = (["mouse", "controller", "hand"] as const).map((source) =>
      run([
        { type: "down", source, hit: hit(0.4, 0.4), at: 0 },
        { type: "up", source, hit: hit(0.4, 0.4), at: 40 },
      ]).outcomes,
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0]).toEqual([{ kind: "tap", hit: hit(0.4, 0.4) }]);
  });
});

describe("telling a tap from a drag", () => {
  it("a hand that jitters still taps", () => {
    // A tracked hand never holds perfectly still. With a zero threshold every
    // tap in a headset becomes a one-pixel drag: the card lifts, the person
    // lets go, it lands back with a flicker instead of opening.
    const jitter = TAP_SLOP / 2;
    const { outcomes } = run([
      { type: "down", source: "hand", hit: hit(0.4, 0.4), at: 0 },
      { type: "move", source: "hand", hit: hit(0.4 + jitter, 0.4 - jitter), at: 20 },
      { type: "up", source: "hand", hit: hit(0.4, 0.4), at: 60 },
    ]);
    expect(outcomes).toEqual([{ kind: "tap", hit: hit(0.4, 0.4) }]);
  });

  it("a real movement becomes a drag", () => {
    const { outcomes } = run([
      { type: "down", source: "hand", hit: hit(0.4, 0.4), at: 0 },
      { type: "move", source: "hand", hit: hit(0.4 + TAP_SLOP * 3, 0.4), at: 20 },
      { type: "up", source: "hand", hit: hit(0.9, 0.4), at: 60 },
    ]);
    expect(outcomes[0].kind).toBe("drop");
  });

  it("a deliberate press-and-hold picks up without moving at all", () => {
    // Otherwise picking up a card requires shaking it.
    const { outcomes } = run([
      { type: "down", source: "controller", hit: hit(0.4, 0.4), at: 0 },
      { type: "move", source: "controller", hit: hit(0.4, 0.4), at: HOLD_MS + 10 },
      { type: "up", source: "controller", hit: hit(0.4, 0.4), at: HOLD_MS + 50 },
    ]);
    expect(outcomes).toEqual([{ kind: "drop", from: hit(0.4, 0.4), over: hit(0.4, 0.4) }]);
  });
});

describe("where a drop lands", () => {
  it("uses the release point, not the last move", () => {
    // Dropping onto the thing the pointer LEFT rather than the thing it landed
    // on is the classic version of this bug.
    const { outcomes } = run([
      { type: "down", source: "mouse", hit: hit(0.1, 0.5), at: 0 },
      { type: "move", source: "mouse", hit: hit(0.5, 0.5), at: 20 },
      { type: "up", source: "mouse", hit: hit(0.9, 0.5, "other"), at: 40 },
    ]);
    expect(outcomes).toEqual([{ kind: "drop", from: hit(0.1, 0.5), over: hit(0.9, 0.5, "other") }]);
  });

  it("a release off every panel is a real answer, not a failure", () => {
    // It is how a card gets pulled off the board into its own panel.
    const { outcomes } = run([
      { type: "down", source: "mouse", hit: hit(0.1, 0.5), at: 0 },
      { type: "move", source: "mouse", hit: hit(0.5, 0.5), at: 20 },
      { type: "move", source: "mouse", hit: null, at: 30 },
      { type: "up", source: "mouse", hit: null, at: 40 },
    ]);
    expect(outcomes).toEqual([{ kind: "drop", from: hit(0.1, 0.5), over: null }]);
  });

  it("leaving the panel mid-drag starts a drag rather than ending it", () => {
    const { state } = run([
      { type: "down", source: "mouse", hit: hit(0.1, 0.5), at: 0 },
      { type: "move", source: "mouse", hit: null, at: 20 },
    ]);
    expect(state.kind).toBe("dragging");
  });
});

describe("gestures that go wrong", () => {
  it("a lost controller puts the card back rather than dropping it somewhere", () => {
    const { state, outcomes } = run([
      { type: "down", source: "controller", hit: hit(0.2, 0.2), at: 0 },
      { type: "move", source: "controller", hit: hit(0.6, 0.6), at: 20 },
      { type: "cancel", source: "controller", at: 30 },
    ]);
    expect(outcomes).toEqual([{ kind: "cancelled", from: hit(0.2, 0.2) }]);
    expect(state.kind).toBe("idle");
  });

  it("the OTHER hand cannot steal a card the first is carrying", () => {
    // Both hands are tracked at once, and the idle one still emits moves.
    // Without this the resting hand takes over mid-drag.
    const { outcomes } = run([
      { type: "down", source: "hand", hit: hit(0.2, 0.2), at: 0 },
      { type: "move", source: "hand", hit: hit(0.6, 0.6), at: 20 },
      { type: "move", source: "controller", hit: hit(0.9, 0.9), at: 25 },
      { type: "up", source: "controller", hit: hit(0.9, 0.9), at: 30 },
      { type: "up", source: "hand", hit: hit(0.6, 0.6), at: 40 },
    ]);
    expect(outcomes).toEqual([{ kind: "drop", from: hit(0.2, 0.2), over: hit(0.6, 0.6) }]);
  });

  it("a double-fired press does not drop what is held", () => {
    const { outcomes, state } = run([
      { type: "down", source: "controller", hit: hit(0.2, 0.2), at: 0 },
      { type: "down", source: "controller", hit: hit(0.2, 0.2), at: 5 },
      { type: "move", source: "controller", hit: hit(0.8, 0.8), at: 20 },
      { type: "up", source: "controller", hit: hit(0.8, 0.8), at: 30 },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(state.kind).toBe("idle");
  });

  it("a release with nothing held does nothing at all", () => {
    expect(run([{ type: "up", source: "mouse", hit: hit(0.5, 0.5), at: 0 }]).outcomes).toEqual([]);
  });

  it("a cancel with nothing held does nothing at all", () => {
    expect(run([{ type: "cancel", source: "hand", at: 0 }]).outcomes).toEqual([]);
  });
});

describe("what the renderer asks", () => {
  it("says which card is in the air, and nothing while merely pressing", () => {
    let state: Gesture = { kind: "idle" };
    state = stepGesture(state, { type: "down", source: "hand", hit: hit(0.3, 0.3), at: 0 }).state;
    expect(carrying(state)).toBeNull();
    state = stepGesture(state, { type: "move", source: "hand", hit: hit(0.8, 0.8), at: 20 }).state;
    expect(carrying(state)).toEqual(hit(0.3, 0.3));
    state = stepGesture(state, { type: "up", source: "hand", hit: hit(0.8, 0.8), at: 30 }).state;
    expect(carrying(state)).toBeNull();
  });
});
