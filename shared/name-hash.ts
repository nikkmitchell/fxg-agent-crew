/**
 * FNV-1a over a string: how the room turns a name into "always the same one".
 * Your voice when you have not chosen (voice-choice), your desk (space-layout),
 * where you like to stand (standing-room), which side you walk on
 * (walk-beside), your avatar's colours (src/avatar), and when you breathe,
 * blink, idle and wander (agent-motion, agent-animation, agent-voice,
 * server/space/social-motion).
 *
 * ONE COPY, because each of those had its own and they must agree: change one
 * and somebody's desk and voice stop matching what everybody else's browser
 * works out. Callers fold the name first when case should not matter
 * (actorKey); this hashes exactly what it is given. Iterates by code point and
 * takes the first UTF-16 unit of each, as every copy did, so no output changed.
 */
export function nameHash(text: string): number {
  let hash = 2_166_136_261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return hash;
}

/**
 * The older, smaller hash behind the room's name colours: a person's colour in
 * a space (space-kit colorFor), their light ribbon's hue (LightRibbons hueOf,
 * the same hue as colorFor on purpose), and a room's door colour in the lobby
 * (lobby-panels). Case folded. Kept apart from nameHash because switching
 * would repaint everybody; three copies of it became this one.
 */
export function colourHash(text: string): number {
  let hash = 0;
  for (const character of text.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}
