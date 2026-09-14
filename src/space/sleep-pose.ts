/**
 * A sleeping agent lies down.
 *
 * Nikk: "sleeping agents should actually sleep like if the agent is not
 * connected and doing anything the best is if they lie down on the ground and
 * just sleep". It used to be a standing doze: head forward, eyes shut, still
 * on its feet.
 *
 * DONE AS A POSE OF THE WHOLE BODY, not a clip. None of the licensed clips is
 * lying down. Tipping the whole figure onto its back about its feet, then
 * sliding it so its hips are over the spot it was standing on, needs no
 * per-bone guesswork. The calm idle clip keeps playing underneath, so the
 * breathing and small shifts still read as someone asleep, not a statue on
 * its back.
 *
 * All in the model's own units, inside the body's facing and scale. The model
 * faces -Z (see `faceRoomYaw`); a quarter turn about +X brings its up axis to
 * +Z and its face to +Y, so it lies on its back with its head behind where it
 * stood.
 */

/** How far off the floor the spine rests, so the back does not sink into it. */
export const BACK_THICKNESS = 0.11;

/**
 * The tilt and offset for a body that is `lie` of the way down (0 standing,
 * 1 flat), whose hips are `hipHeight` above its feet when standing.
 */
export function lyingPose(lie: number, hipHeight: number): { rotationX: number; y: number; z: number } {
  const t = Math.max(0, Math.min(1, lie));
  // Eased so it settles onto the floor rather than toppling at constant speed.
  const eased = t * t * (3 - 2 * t);
  const rotationX = (Math.PI / 2) * eased;
  return {
    rotationX,
    // Lifted only as the body tips, so nothing rises before it starts to fall.
    y: BACK_THICKNESS * Math.sin(rotationX) ** 2,
    z: -hipHeight * eased,
  };
}

/** Whether this person should be lying down right now. */
export function shouldLieDown(person: { kind: string | null; moving: boolean; avatar: { posture: string } }): boolean {
  return person.kind === "agent" && !person.moving && person.avatar.posture === "sleeping";
}
