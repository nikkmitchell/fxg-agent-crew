import { DEFAULT_AVATAR_STATE, type AvatarState } from "../../shared/avatar-motion";

export type Rotation = { x: number; y: number; z: number };

export type AgentMotionFrame = {
  head: Rotation;
  chest: Rotation;
  leftUpperArm: Rotation;
  leftLowerArm: Rotation;
  rightUpperArm: Rotation;
  rightLowerArm: Rotation;
  leftUpperLeg: Rotation;
  leftLowerLeg: Rotation;
  rightUpperLeg: Rotation;
  rightLowerLeg: Rotation;
  expressions: { blink: number; aa: number; happy: number; sad: number; relaxed: number };
  /**
   * How far to lower the whole body, in metres at the model's own scale.
   *
   * Needed for sitting: a cross-legged figure's hips are near the floor, and
   * rotating the legs alone leaves it standing with its knees bent in the air.
   * Zero for every standing posture, which is nearly all of them.
   */
  rootDrop: number;
};

const rotation = (x = 0, y = 0, z = 0): Rotation => ({ x, y, z });
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Stable phase offsets keep a crowd from breathing and blinking in lockstep. */
function phaseOf(actorId: string): number {
  const hash = [...actorId].reduce(
    (value, character) => Math.imul(value ^ character.charCodeAt(0), 16_777_619) >>> 0,
    2_166_136_261,
  );
  return (hash % 10_000) / 10_000;
}

/**
 * A deterministic animation frame for an untracked agent.
 *
 * No randomness and no mutable clock live here, which makes the behaviour
 * cheap for every renderer and exactly testable. Reduced motion removes idle
 * sway and repeated gesture oscillation while retaining a readable static pose.
 */
export function agentMotionFrame({
  actorId,
  avatar = DEFAULT_AVATAR_STATE,
  attending,
  speaking,
  moving,
  nowMs,
  reducedMotion,
}: {
  actorId: string;
  avatar?: AvatarState;
  attending: boolean;
  speaking: boolean;
  moving: boolean;
  nowMs: number;
  reducedMotion: boolean;
}): AgentMotionFrame {
  const phase = phaseOf(actorId) * Math.PI * 2;
  const seconds = nowMs / 1_000;
  const breath = reducedMotion ? 0 : Math.sin(seconds * 1.35 + phase) * 0.025;
  const look = reducedMotion ? 0 : Math.sin(seconds * 0.42 + phase) * 0.035;
  const blinkCycle = ((nowMs + phaseOf(actorId) * 3_700) % 3_700) / 3_700;
  const blink = reducedMotion || blinkCycle < 0.92
    ? 0
    : Math.sin(((blinkCycle - 0.92) / 0.08) * Math.PI);

  const frame: AgentMotionFrame = {
    head: rotation(attending ? 0.1 : 0, look, attending ? -0.06 : 0),
    chest: rotation(breath, 0, look * 0.35),
    // VRM normalized rest is a T-pose. These mirrored Z rotations lower both
    // arms into a relaxed stance instead of pretending they are tracked.
    leftUpperArm: rotation(0.08, 0, 1.22),
    leftLowerArm: rotation(0, 0, 0.12),
    rightUpperArm: rotation(0.08, 0, -1.22),
    rightLowerArm: rotation(0, 0, -0.12),
    leftUpperLeg: rotation(),
    leftLowerLeg: rotation(),
    rightUpperLeg: rotation(),
    rightLowerLeg: rotation(),
    rootDrop: 0,
    expressions: {
      blink,
      aa: speaking
        ? reducedMotion ? 0.22 : 0.12 + Math.abs(Math.sin(seconds * 10.5 + phase)) * 0.48
        : 0,
      happy: avatar.mood === "happy" ? 0.55 : 0,
      sad: avatar.mood === "concerned" ? 0.28 : 0,
      relaxed: avatar.mood === "focused" ? 0.22 : avatar.mood === "neutral" ? 0.08 : 0,
    },
  };

  if (moving && !reducedMotion) {
    const gait = Math.sin(seconds * 7.5 + phase);
    const leftForward = gait * 0.42;
    const rightForward = -leftForward;
    frame.leftUpperLeg = rotation(leftForward, 0, 0);
    frame.rightUpperLeg = rotation(rightForward, 0, 0);
    // A knee bends on the trailing half of its stride rather than backwards
    // through the joint. The opposite signs reflect the normalized leg axes.
    frame.leftLowerLeg = rotation(Math.max(0, -gait) * 0.5, 0, 0);
    frame.rightLowerLeg = rotation(Math.max(0, gait) * 0.5, 0, 0);
    if (!attending && !speaking && !avatar.gesture) {
      frame.leftUpperArm.x += rightForward * 0.32;
      frame.rightUpperArm.x += leftForward * 0.32;
    }
  }

  /**
   * POSTURE — what the agent is doing with itself while it stands there.
   *
   * Applied only when still: you cannot meditate across a room, and a walking
   * figure already has a gait. Attending, speaking and gestures come after
   * this and win, because those are responses to somebody and a posture is
   * merely what you were doing until they arrived.
   */
  if (!moving && avatar.posture === "meditating") {
    // Sitting cross-legged. The hips drop nearly to the floor, the thighs
    // rotate out and forward, and the knees fold. The arms come to rest on
    // them. It is an invention — no agent has legs anybody measured — but an
    // agent is declared as an agent, so nothing here is pretending to be
    // tracked.
    frame.rootDrop = 0.52;
    frame.leftUpperLeg = rotation(-1.32, 0.32, 0.62);
    frame.rightUpperLeg = rotation(-1.32, -0.32, -0.62);
    frame.leftLowerLeg = rotation(1.62, 0, 0);
    frame.rightLowerLeg = rotation(1.62, 0, 0);
    frame.leftUpperArm = rotation(0.34, 0, 1.16);
    frame.leftLowerArm = rotation(-0.3, 0, 0.34);
    frame.rightUpperArm = rotation(0.34, 0, -1.16);
    frame.rightLowerArm = rotation(-0.3, 0, -0.34);
    // The head settles, and the breath slows — that is most of what reads as
    // meditating rather than sitting.
    frame.head.x += 0.16;
    frame.chest.x = reducedMotion ? 0 : Math.sin(seconds * 0.55 + phase) * 0.04;
    frame.expressions.blink = reducedMotion ? 0 : Math.min(1, frame.expressions.blink + 0.55);
    frame.expressions.relaxed = Math.max(frame.expressions.relaxed, 0.4);
  } else if (!moving && avatar.posture === "thinking") {
    // A hand to the chin. The other arm folds across, which is what an arm
    // does when the first one is busy holding your face up.
    frame.rightUpperArm = rotation(-0.62, 0.22, -0.62);
    frame.rightLowerArm = rotation(-0.5, 0, 1.34);
    frame.leftUpperArm = rotation(0.22, 0, 1.02);
    frame.leftLowerArm = rotation(-0.42, 0, 0.72);
    frame.head.x += 0.1;
    frame.head.z += 0.08;
    frame.expressions.relaxed = Math.max(frame.expressions.relaxed, 0.18);
  }

  if (attending) {
    frame.rightUpperArm = rotation(-0.38, 0.08, -0.78);
    frame.rightLowerArm = rotation(-0.18, 0, 0.92);
  } else if (speaking) {
    const emphasis = reducedMotion ? 0 : Math.sin(seconds * 2.7 + phase) * 0.12;
    frame.leftUpperArm = rotation(-0.18, 0, 0.92 + emphasis);
    frame.rightUpperArm = rotation(-0.18, 0, -0.92 - emphasis);
  }

  const age = avatar.gestureStartedAt === null ? 0 : Math.max(0, nowMs - avatar.gestureStartedAt);
  const progress = clamp01(age / 5_000);
  if (avatar.gesture === "wave") {
    frame.rightUpperArm = rotation(-0.15, 0, -0.22);
    frame.rightLowerArm = rotation(0, 0, reducedMotion ? 1.05 : 0.95 + Math.sin(progress * Math.PI * 8) * 0.28);
  } else if (avatar.gesture === "nod") {
    frame.head.x += reducedMotion ? 0.12 : Math.sin(progress * Math.PI * 6) * 0.18;
  } else if (avatar.gesture === "present") {
    frame.leftUpperArm = rotation(-0.5, 0, 0.82);
    frame.leftLowerArm = rotation(-0.22, 0, 0.45);
    frame.rightUpperArm = rotation(-0.5, 0, -0.82);
    frame.rightLowerArm = rotation(-0.22, 0, -0.45);
  }

  return frame;
}
