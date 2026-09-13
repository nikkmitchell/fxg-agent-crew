/**
 * The small, bounded vocabulary an occupant may use to animate its own avatar.
 *
 * This is presence, not profile data: it is intentionally ephemeral and is
 * forgotten when the process or occupant goes away. Text is not accepted here;
 * allowing arbitrary animation names would turn every renderer into an
 * interpreter for untrusted room traffic.
 */

export const AVATAR_MOODS = ["neutral", "happy", "focused", "concerned"] as const;
export const AVATAR_GESTURES = ["none", "wave", "nod", "present"] as const;

export type AvatarMood = (typeof AVATAR_MOODS)[number];
export type AvatarGesture = (typeof AVATAR_GESTURES)[number];
export type ActiveAvatarGesture = Exclude<AvatarGesture, "none">;

/** At least one field is required; an empty control cannot express a change. */
export type AvatarControl =
  | { mood: AvatarMood; gesture?: AvatarGesture }
  | { mood?: AvatarMood; gesture: AvatarGesture };

export type AvatarState = {
  mood: AvatarMood;
  gesture: ActiveAvatarGesture | null;
  gestureStartedAt: number | null;
};

export const DEFAULT_AVATAR_STATE: AvatarState = {
  mood: "neutral",
  gesture: null,
  gestureStartedAt: null,
};

const oneOf = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === "string" && values.includes(value);

/** Parse either an HTTP body or the fields of a websocket frame. */
export function parseAvatarControl(value: unknown): AvatarControl | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const hasMood = Object.hasOwn(body, "mood");
  const hasGesture = Object.hasOwn(body, "gesture");
  if (!hasMood && !hasGesture) return null;
  if (hasMood && !oneOf(AVATAR_MOODS, body.mood)) return null;
  if (hasGesture && !oneOf(AVATAR_GESTURES, body.gesture)) return null;
  return {
    ...(hasMood ? { mood: body.mood as AvatarMood } : {}),
    ...(hasGesture ? { gesture: body.gesture as AvatarGesture } : {}),
  } as AvatarControl;
}
