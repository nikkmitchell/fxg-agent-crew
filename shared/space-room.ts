/**
 * Which room a piece of the space belongs to.
 *
 * Nikk: "the saha.ing room is the dev group for making saha.ing... we need to
 * let new users create their own new rooms... new users or even old users who
 * are working on a different project will only see that".
 *
 * WHAT A ROOM OWNS, and what it does not, is the decision this file exists to
 * keep in one place:
 *
 *   the room's   where you stand, how you appear, what is on the walls, what
 *                was said aloud. Walk into another room and all of it differs.
 *   yours        your body, your voice, your profile, your memories. They
 *                follow you in, because they are you and not furniture.
 */

/**
 * Where the space puts anything that has not said which room it is in.
 *
 * DELIBERATELY `saha.ing` AND NOT `lobby`, for now. Every row in the database
 * was made by somebody standing in the development room, and migration 27
 * backfilled them there. Defaulting new sessions anywhere else would show the
 * people who built this an empty space and a room full of nobody, while their
 * own furniture sat somewhere they were not.
 *
 * `lobby` is the right default for JOINING — it is what the onboarding tells a
 * new agent when nobody named a room — and it becomes the default here too the
 * moment the site asks which room to stand in. One line, changed then rather
 * than now, so the two halves cannot disagree in between.
 */
export const DEFAULT_SPACE_ROOM = "saha.ing";

/** The public room everybody starts in. Named here so nothing spells it twice. */
export const LOBBY_ROOM = "lobby";

/**
 * The key a room name is stored and compared under.
 *
 * FOLDED, for the reason actor ids are folded: this project has already been
 * bitten by two spellings of one name behaving as two different things — a
 * manager revoked `Nightjar` and `nightjar` walked straight back in, because
 * the row was keyed on the spelling. A room is worse, because nothing would
 * throw: `Lobby` and `lobby` would simply be two rooms, each looking correct
 * and empty, and the people in them would not see each other with no error
 * anywhere to explain it.
 *
 * Trimmed too, because a name arriving from a query string or a paste is the
 * usual way a stray space gets in.
 */
export const roomKey = (room: string): string => room.trim().toLowerCase();

/**
 * Whether a room name is one we will store.
 *
 * A room comes from WebHarness, which has its own rules; this is only a guard
 * against the empty string and the absurd, so that a missing value becomes an
 * obvious refusal rather than a row under `''` that nobody can ever reach.
 */
export const isRoomName = (room: unknown): room is string =>
  typeof room === "string" && roomKey(room).length > 0 && room.trim().length <= 200;
