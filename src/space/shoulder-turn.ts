/**
 * How far a head may be turned before the body has to come with it.
 *
 * A person who looks over their shoulder turns their head; a person who looks
 * behind them turns round. The room drew only the first: facing came from where
 * somebody was walking, so a standing person could rotate their head a full
 * turn while their shoulders stayed pointing at the wall. Nikk: "when turning
 * around, the body never moves, but it should... if head turns past 90 degrees
 * then body should rotate so head doesn't move past 90 degrees."
 *
 * NOT FROM three-vrm, and it is worth being straight about that. VRMLookAt aims
 * the eyes and head at a target; nothing in the library turns a torso to follow
 * a head, so there was nothing to reuse. This is the whole of what was added.
 *
 * NINETY DEGREES IS GENEROUS ON PURPOSE. A real neck manages about seventy each
 * way, and picking the anatomical number would mean the body creeping round
 * constantly in response to ordinary glances. This only moves when somebody
 * really has turned to look behind them.
 */
export const SHOULDER_LIMIT = Math.PI / 2;

/** The same angle, wrapped to (-π, π]. */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  const wrapped = ((radians % turn) + turn) % turn;
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

/**
 * Where the body should face, given where it would face on its own and where
 * the head is actually looking.
 *
 * Returns `bodyYaw` untouched while the head is within `limit` of it — which is
 * most of the time, and is what keeps the shoulders still while somebody
 * glances about. Past that the body is turned just enough to bring the head
 * back to the limit, and no further: it follows, rather than snapping to face
 * wherever the head went.
 */
export function shoulderYaw(bodyYaw: number, headYaw: number, limit = SHOULDER_LIMIT): number {
  const gap = wrapAngle(headYaw - bodyYaw);
  if (Math.abs(gap) <= limit) return bodyYaw;
  return wrapAngle(bodyYaw + (gap > 0 ? gap - limit : gap + limit));
}
