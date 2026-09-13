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
