/**
 * Who places the call.
 *
 * Both ends of a pair learn about each other in the same instant, and two
 * simultaneous offers collapse the connection — so exactly one side must dial.
 * The rule is the lower actor id, which is arbitrary and is the point: it is
 * the same answer on both machines without either asking the other.
 *
 * THIS IS ITS OWN FILE BECAUSE IT WAS WRONG IN PRODUCTION and the failure was
 * invisible. Nikk opened a microphone, then Bai Wei opened hers; "baiwei2"
 * sorts below "nikk2" so Bai Wei was the caller, but switching on only
 * ANNOUNCED and never dialled, and Nikk correctly declined because his id was
 * higher. Nobody called. They stood two metres apart in silence with no error
 * anywhere, because nothing had failed — nothing had been attempted.
 *
 * A rule with two halves that must agree is a rule worth testing on its own.
 */

/** Should I dial them, or wait for them to dial me? */
export function shouldCall(me: string, them: string): boolean {
  // Never yourself: a second tab of your own is still you, and calling it puts
  // your own microphone into your own ears.
  if (me === them) return false;
  return me < them;
}

/**
 * Everyone I must dial right now, given who is already talking.
 *
 * Used in BOTH directions, which is the fix: when somebody announces, and when
 * I switch my own microphone on. Leaving it out of the second was the deadlock.
 */
export function callList(me: string, others: readonly string[]): string[] {
  return others.filter((them) => shouldCall(me, them));
}

/**
 * Who dials once LISTENING no longer needs a microphone.
 *
 * Nikk: "fix voice chat so users can actually chat naturally through the
 * app". You could only hear people after opening your own microphone, so a
 * room where one person was talking sounded empty to everyone who had not
 * thought to open theirs. Now everybody in the room hears whoever is talking.
 *
 * A listener never dials — it has nothing to send and does not announce
 * itself. Somebody talking dials every listener, and two people talking fall
 * back to the lower-id rule above. Compared case-insensitively, since the room
 * and the chat spell the same person differently.
 */
export function shouldDial(me: string, them: string, meTalking: boolean, themTalking: boolean): boolean {
  const a = me.trim().toLowerCase();
  const b = them.trim().toLowerCase();
  if (a === b) return false;
  if (!meTalking) return false;
  if (!themTalking) return true;
  return shouldCall(a, b);
}
