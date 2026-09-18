import type { Pose, WirePerson } from "./space-wire.js";

/**
 * How long each person has been still, and who a viewer has asked not to see.
 *
 * Nikk, in the room: "can you have in settings an option to hide avatars that
 * have not moved in more than 5 minutes (though don't hide them
 * automatically)".
 *
 * WORKED OUT ON THE SERVER, which has been watching all along. A browser that
 * kept its own count would know nothing for the first five minutes after it
 * opened, so the setting would do nothing at exactly the moment somebody
 * arrives and looks round the room.
 *
 * MOVING MEANS WHAT A WATCHER WOULD CALL MOVING: where they stand, which way
 * they face, a tracked head or hand, and a gesture. Posture and mood are left
 * out on purpose. The room settles an idle agent's posture by itself — it lies
 * down after five minutes of doing nothing — and counting that as movement
 * would keep the very figures this setting is for on screen for five minutes
 * more.
 *
 * NEVER HIDDEN BY DEFAULT, and it never hides you. The preference is off until
 * a viewer turns it on, in their own browser, and it hides nobody for anybody
 * else. See room-preferences.ts.
 */
export const STILL_AFTER_MS = 5 * 60_000;

type Seen = Pick<WirePerson, "actorId" | "at" | "facing" | "head" | "hands" | "avatar" | "moving">;

/** A centimetre, or a hundredth of a radian: finer than anybody watching could see. */
const fine = (value: number) => Math.round(value * 100);

const poseOf = (pose: Pose | null): string =>
  pose ? [pose.p.x, pose.p.y, pose.p.z, pose.q.x, pose.q.y, pose.q.z, pose.q.w].map(fine).join(",") : "-";

/**
 * What a person looks like, to the precision a watcher could notice.
 *
 * Rounded so that the same position serialised with a different last digit is
 * not movement. A new gesture counts even when it is the same gesture again,
 * because it starts at a new time.
 */
export function motionSignature(person: Omit<Seen, "actorId" | "moving">): string {
  return [
    [person.at.x, person.at.y, person.at.z].map(fine).join(","),
    fine(person.facing),
    poseOf(person.head),
    poseOf(person.hands.left),
    poseOf(person.hands.right),
    person.avatar.gesture ?? "-",
    person.avatar.gestureStartedAt ?? "-",
  ].join("|");
}

export class Stillness {
  private readonly last = new Map<string, { signature: string; since: number }>();

  /**
   * Record how everybody looks now, and say how long each has looked like it.
   *
   * SOMEBODY SEEN FOR THE FIRST TIME HAS JUST MOVED, as far as this can say.
   * After a restart the server has not been watching anybody, and claiming
   * they had been still would hide people on the strength of nothing. Five
   * minutes of watching is what it takes to know.
   *
   * Anybody no longer present is forgotten, so somebody who leaves and comes
   * back arrives moving, which is what arriving is.
   */
  observe(people: readonly Seen[], now: number): Map<string, number> {
    const stillFor = new Map<string, number>();
    const present = new Set<string>();
    for (const person of people) {
      present.add(person.actorId);
      const signature = motionSignature(person);
      const seen = this.last.get(person.actorId);
      if (!seen || seen.signature !== signature || person.moving) {
        this.last.set(person.actorId, { signature, since: now });
        stillFor.set(person.actorId, 0);
      } else {
        stillFor.set(person.actorId, Math.max(0, now - seen.since));
      }
    }
    for (const actorId of [...this.last.keys()]) {
      if (!present.has(actorId)) this.last.delete(actorId);
    }
    return stillFor;
  }
}

/**
 * Whether a viewer who asked should stop seeing this person.
 *
 * NOT KNOWN IS NOT STILL. A server older than this sends no `stillForMs`, and
 * hiding somebody because a number is missing would be claiming they have not
 * moved when nobody measured it.
 */
export function isStill(person: { stillForMs?: number }): boolean {
  return typeof person.stillForMs === "number" && person.stillForMs >= STILL_AFTER_MS;
}

/** Everybody the setting would hide right now: never the viewer, compared the way the room compares names. */
export function hiddenAsStill(
  people: readonly { actorId: string; stillForMs?: number }[],
  you: string | null,
): string[] {
  const me = (you ?? "").trim().toLowerCase();
  return people
    .filter((person) => person.actorId.trim().toLowerCase() !== me && isStill(person))
    .map((person) => person.actorId);
}
