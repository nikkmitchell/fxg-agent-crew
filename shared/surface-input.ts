/**
 * One pointer, three devices.
 *
 * THIS FILE IS THE WHOLE "ONE ROOM" CLAIM, in about a hundred lines. Today the
 * desktop drives panels with DOM events and a headset drives them with XR
 * controller rays, which is why every interaction exists twice and why the two
 * rooms can differ. A panel that receives one kind of event cannot tell which
 * device produced it, and then there is nothing left to write twice.
 *
 * NO THREE.JS HERE ON PURPOSE. The adapter that turns a mouse move or an XR
 * controller into `SurfaceEvent` lives in the component layer where three lives;
 * the STATE MACHINE — what counts as a press, a drag, a drop, a cancel — is
 * here, pure, and tested. That machine is the part with the bugs in it: a drag
 * that never ends, a press that becomes a drag because a hand shook, a drop
 * onto the thing the pointer left rather than the thing it landed on.
 */

/** Where a ray met a panel. u,v are three.js's convention: v is 0 at the BOTTOM. */
export type SurfaceHit = {
  panelId: string;
  u: number;
  v: number;
};

export type PointerSource = "mouse" | "controller" | "hand";

export type SurfaceEvent =
  | { type: "down"; source: PointerSource; hit: SurfaceHit; at: number }
  | { type: "move"; source: PointerSource; hit: SurfaceHit | null; at: number }
  | { type: "up"; source: PointerSource; hit: SurfaceHit | null; at: number }
  /** The device went away mid-gesture: controller lost, hand untracked, window blurred. */
  | { type: "cancel"; source: PointerSource; at: number };

export type Gesture =
  | { kind: "idle" }
  | { kind: "pressing"; source: PointerSource; from: SurfaceHit; at: number }
  | { kind: "dragging"; source: PointerSource; from: SurfaceHit; over: SurfaceHit | null };

export type GestureOutcome =
  /** A deliberate press that never became a drag. */
  | { kind: "tap"; hit: SurfaceHit }
  /** A drag that ended somewhere. `over` null means it ended off every panel. */
  | { kind: "drop"; from: SurfaceHit; over: SurfaceHit | null }
  /** The gesture was abandoned; put everything back. */
  | { kind: "cancelled"; from: SurfaceHit };

/**
 * HOW FAR A POINTER MAY WANDER AND STILL BE A TAP, in uv.
 *
 * Not zero, and the reason is hands. A tracked hand jitters by a couple of
 * millimetres constantly, so a zero threshold turns every tap in a headset into
 * a one-pixel drag — the card lifts, the person lets go, and it lands back with
 * a flicker instead of opening. A mouse never needs this and is not harmed by
 * it.
 */
export const TAP_SLOP = 0.012;

/**
 * HOW LONG A PRESS MAY REST BEFORE IT IS A DRAG REGARDLESS of movement.
 *
 * A deliberate press-and-hold on a card should pick it up even if the hand is
 * perfectly still, or picking up a card would require shaking.
 */
export const HOLD_MS = 220;

const distance = (a: SurfaceHit, b: SurfaceHit) => Math.hypot(a.u - b.u, a.v - b.v);

/**
 * Advance the gesture.
 *
 * Returns the next state and, when a gesture ends, what it was. Pure: the same
 * events always give the same answer, which is what lets a test drive a
 * controller and a hand through identical motions and assert they agree.
 */
export function stepGesture(
  state: Gesture,
  event: SurfaceEvent,
): { state: Gesture; outcome: GestureOutcome | null } {
  // A SECOND DEVICE DOES NOT INTERRUPT THE FIRST. Two hands are tracked at once
  // in a headset, and the idle one still emits moves; without this, the resting
  // hand steals the card the other is carrying.
  if (state.kind !== "idle" && "source" in event && event.source !== state.source) {
    return { state, outcome: null };
  }

  switch (event.type) {
    case "down":
      // Ignore a second press while one is live rather than restarting: a
      // controller that double-fires should not drop what it is holding.
      if (state.kind !== "idle") return { state, outcome: null };
      return { state: { kind: "pressing", source: event.source, from: event.hit, at: event.at }, outcome: null };

    case "move": {
      if (state.kind === "pressing") {
        const moved = event.hit ? distance(state.from, event.hit) > TAP_SLOP : true;
        const held = event.at - state.at >= HOLD_MS;
        if (!moved && !held) return { state, outcome: null };
        return { state: { kind: "dragging", source: state.source, from: state.from, over: event.hit }, outcome: null };
      }
      if (state.kind === "dragging") {
        return { state: { ...state, over: event.hit }, outcome: null };
      }
      return { state, outcome: null };
    }

    case "up": {
      if (state.kind === "pressing") {
        // A press that ends where it began is a tap — even if the pointer left
        // the panel and came back, which a shaky hand does.
        return { state: { kind: "idle" }, outcome: { kind: "tap", hit: state.from } };
      }
      if (state.kind === "dragging") {
        // THE DROP IS WHERE IT LANDED, not where it last moved. If the release
        // reports no hit, the card was let go off every panel, and that is a
        // real answer — it is how a card is pulled off the board.
        return { state: { kind: "idle" }, outcome: { kind: "drop", from: state.from, over: event.hit ?? state.over } };
      }
      return { state: { kind: "idle" }, outcome: null };
    }

    case "cancel": {
      if (state.kind === "idle") return { state, outcome: null };
      return { state: { kind: "idle" }, outcome: { kind: "cancelled", from: state.from } };
    }
  }
}

/** Whether a gesture is carrying something, for the renderer to lift it. */
export const carrying = (state: Gesture): SurfaceHit | null =>
  state.kind === "dragging" ? state.from : null;
