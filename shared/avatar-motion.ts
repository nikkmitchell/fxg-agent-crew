/**
 * The small, bounded vocabulary an occupant may use to animate its own avatar.
 *
 * This is presence, not profile data: it is intentionally ephemeral and is
 * forgotten when the process or occupant goes away. Text is not accepted here;
 * allowing arbitrary animation names would turn every renderer into an
 * interpreter for untrusted room traffic.
 */

export const AVATAR_MOODS = ["neutral", "happy", "focused", "concerned"] as const;
export const AVATAR_GESTURES = [
  "none",
  "wave",
  "nod",
  "present",
  "clap",
  "shrug",
  "disagree",
] as const;

/**
 * WHAT AN AGENT IS DOING WITH ITSELF, as opposed to how it feels or what it
 * just gestured.
 *
 * A mood is a face and a gesture is a moment; this is a posture, and it lasts.
 * Nikk wanted the room to be inhabited rather than lined with statues: "if
 * you're working you can just put on a thinking animation if you're sleeping
 * put on a sleeping animation... or I even better, a meditation animation".
 *
 * SLEEPING RATHER THAN MEDITATING, and that is a retreat. Meditating was a
 * cross-legged sit, and posing a seated body by hand — hips dropped, thighs
 * out, shins crossed — produced something Nikk described as "very weird" and a
 * screenshot proved was a crumple: legs splayed, one ankle nine centimetres
 * below the floor. A sit is a whole-body pose and it needs a real animation
 * clip, not four Euler angles I guessed at. So this is a standing doze — the
 * rest pose, head bowed, eyes closed, breathing slowed — which is a small
 * deviation from a stance that already looks right and therefore cannot come
 * out looking broken. A proper sitting animation needs `@pixiv/three-vrm-
 * animation` and a licensed .vrma, which is a piece of work of its own.
 *
 * SINCE THEN: a sleeping agent lies down on its back, posed as a whole body
 * rather than joint by joint (src/space/sleep-pose.ts). The standing doze
 * remains as the procedural fallback when the model's clips cannot load.
 *
 * SET FROM THE AUDIT TRAIL, NOT DECLARED. An agent that has just written to the
 * board is thinking because it just did something, and one that has done
 * nothing for a while is at rest because it has done nothing for a while. Both
 * are facts the room already holds. An agent may still say so itself — some
 * know they are about to be busy — but nobody has to remember to.
 */
export const AVATAR_POSTURES = [
  "resting",
  "thinking",
  "sleeping",
  "listening",
  "presenting",
  "celebrating",
  "relaxed",
] as const;

export type AvatarMood = (typeof AVATAR_MOODS)[number];
export type AvatarGesture = (typeof AVATAR_GESTURES)[number];
export type AvatarPosture = (typeof AVATAR_POSTURES)[number];
export type ActiveAvatarGesture = Exclude<AvatarGesture, "none">;

/** At least one field is required; an empty control cannot express a change. */
export type AvatarControl =
  | { mood: AvatarMood; gesture?: AvatarGesture; posture?: AvatarPosture }
  | { mood?: AvatarMood; gesture: AvatarGesture; posture?: AvatarPosture }
  | { mood?: AvatarMood; gesture?: AvatarGesture; posture: AvatarPosture };

export type AvatarState = {
  mood: AvatarMood;
  gesture: ActiveAvatarGesture | null;
  gestureStartedAt: number | null;
  /**
   * Held until something changes it, unlike a gesture, which expires. A
   * posture is what somebody is doing, and people go on doing things.
   */
  posture: AvatarPosture;
};

export const DEFAULT_AVATAR_STATE: AvatarState = {
  mood: "neutral",
  gesture: null,
  gestureStartedAt: null,
  posture: "resting",
};

const oneOf = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === "string" && values.includes(value);

/** Parse either an HTTP body or the fields of a websocket frame. */
export function parseAvatarControl(value: unknown): AvatarControl | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const hasMood = Object.hasOwn(body, "mood");
  const hasGesture = Object.hasOwn(body, "gesture");
  const hasPosture = Object.hasOwn(body, "posture");
  if (!hasMood && !hasGesture && !hasPosture) return null;
  if (hasMood && !oneOf(AVATAR_MOODS, body.mood)) return null;
  if (hasGesture && !oneOf(AVATAR_GESTURES, body.gesture)) return null;
  if (hasPosture && !oneOf(AVATAR_POSTURES, body.posture)) return null;
  return {
    ...(hasMood ? { mood: body.mood as AvatarMood } : {}),
    ...(hasGesture ? { gesture: body.gesture as AvatarGesture } : {}),
    ...(hasPosture ? { posture: body.posture as AvatarPosture } : {}),
  } as AvatarControl;
}
