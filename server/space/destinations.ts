import { STATIONS, deskFor, type Vec3 } from "../../shared/space-layout.js";

/**
 * Where an action puts the person who did it.
 *
 * A pure function of one audit row, on purpose: this is the piece that decides
 * what the room CLAIMS, and it has to be testable without a database, a socket
 * or a clock. Movement in this room is not decoration — an agent crossing the
 * floor is an audit row, and if this mapping lies then the room lies.
 *
 * The honest consequences, stated because they are easy to mistake for bugs:
 *
 * - The `audit` table starts at the cutover. The import wrote one summary row
 *   rather than replaying history, so on a fresh server nobody moves until
 *   somebody does something. That is correct: no invented motion.
 *
 * - Standing at your own desk means WE HAVE NO RECENT EVIDENCE OF ACTIVITY. It
 *   does not mean idle, and nothing here or in the UI may say that it does.
 */

export type AuditRow = {
  id: number;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
};

export type Destination = {
  at: Vec3;
  /**
   * Why they are there, in words, for the label above their head.
   *
   * Describes the ACTION, never its contents. "commented on a card" is safe to
   * put on a wall in a shared room; the comment itself is not.
   *
   * Null means we have no recent evidence — which is not idleness, and the UI
   * must not turn one into the other.
   */
  because: string | null;
};

/** A card was touched. The task board is on the far wall. */
const atTaskBoard = (because: string): Destination => ({ at: STATIONS.taskBoard.stand, because });
const atMoodBoard = (because: string): Destination => ({ at: STATIONS.moodBoard.stand, because });
const atPeople = (because: string): Destination => ({ at: STATIONS.people.stand, because });

/**
 * Map one row to a place to stand.
 *
 * Returns null for a row this room has nothing to say about, rather than a
 * default destination: sending someone to the task board because we did not
 * recognise their action would be an invention, and it is the kind that looks
 * completely normal.
 */
export function destinationFor(row: AuditRow): Destination | null {
  if (row.entity === "task") {
    switch (row.action) {
      case "comment":
        return atTaskBoard("commented on a card");
      case "transition":
        return atTaskBoard("moved a card");
      case "create":
        return atTaskBoard("wrote a new card");
      case "update":
        return atTaskBoard("edited a card");
      case "claim":
        return atTaskBoard("claimed a card");
      case "accept":
        return atTaskBoard("accepted a card");
      case "release":
        return atTaskBoard("let go of a card");
      default:
        return atTaskBoard("worked on a card");
    }
  }

  if (row.entity === "board" || row.entity === "board_item") {
    if (row.action === "add") return atMoodBoard("pinned something up");
    if (row.action === "remove") return atMoodBoard("took something down");
    if (row.action === "create") return atMoodBoard("started a mood board");
    return atMoodBoard("was at the mood boards");
  }

  if (row.entity === "membership" || row.entity === "ownership") {
    if (row.action === "grant") return atPeople("granted access");
    if (row.action === "revoke") return atPeople("ended a link");
    if (row.action === "accept") return atPeople("accepted a link");
    return atPeople("was sorting out who is who");
  }

  if (row.entity === "profile") {
    // Your own desk: this is about you, not about a shared surface.
    return { at: deskFor(row.actorId), because: "updated their profile" };
  }

  if (row.entity === "project") {
    // A project is the board's frame, so the board is where it happens.
    return atTaskBoard("started a project");
  }

  // Deliberately not a fallback destination. See above.
  return null;
}

/**
 * Where somebody stands when we know nothing recent about them.
 *
 * Their own desk, deterministically, so "Plumbline is at the third desk" stays
 * true across restarts. The sentence is null rather than "idle" — we have no
 * evidence they are idle, only an absence of evidence that they are not.
 */
export function restingPlace(actorId: string): Destination {
  return { at: deskFor(actorId), because: null };
}
