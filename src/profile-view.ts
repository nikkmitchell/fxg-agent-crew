import { voiceFor } from "../shared/voice-choice";

/**
 * The decisions the profiles page makes, lifted out of the page.
 *
 * WHY THESE EXIST SEPARATELY, and it is not a style preference. Every one of
 * them was a bug first:
 *
 *   `taken` is an ARRAY of pairs and I read it as a map keyed by actor, so
 *   every lookup returned undefined and every profile fell back to the VIEWER's
 *   voice. Nikk saw one voice on the whole room and said so: "in profile all
 *   voices are the same".
 *
 *   The same wrong shape made the picker's taken-check compare an object to a
 *   string, so no voice ever showed as held.
 *
 *   The body catalogue keys its list under `avatars`; I read `bodies`, got an
 *   empty array, and silently fell back to the 15 bundled bodies while the page
 *   still claimed 301.
 *
 * There is no renderer in this suite — see Identity.test.tsx, which says so and
 * tests its derivation for the same reason. A component test would not have
 * caught any of the above anyway: they are not rendering faults, they are
 * questions about a payload, answered wrongly. This is where they can be asked
 * in a test.
 */

export type VoiceHolding = { actorId: string; voice: string };
export type BodyHolding = { actorId: string; body: string };
export type OwnershipLink = { agentActorId: string; ownerActorId: string; state: string };
export type ProjectMembership = { projectId: string; actorId: string; active: boolean };

/**
 * The voice an actor speaks in: their own choice, else the one derived from
 * their name — the same rule the server applies, so the page and the room agree.
 *
 * NEVER THE VIEWER'S. That was the bug, and it is the one thing these tests
 * exist to keep fixed.
 */
export function voiceOfActor(actorId: string, taken: readonly VoiceHolding[] | undefined): string {
  return taken?.find((t) => t.actorId === actorId)?.voice ?? voiceFor(actorId).id;
}

/** Whether that voice was chosen, or merely fell out of their name. */
export function voiceWasChosen(actorId: string, taken: readonly VoiceHolding[] | undefined): boolean {
  return Boolean(taken?.some((t) => t.actorId === actorId));
}

/** Who holds a given voice, so a picker can say whose it is rather than "unavailable". */
export function holderOfVoice(voiceId: string, taken: readonly VoiceHolding[] | undefined): string | null {
  return taken?.find((t) => t.voice === voiceId)?.actorId ?? null;
}

/** The body an actor wears, or null when they have not chosen — a real state. */
export function bodyOfActor(actorId: string, chosen: readonly BodyHolding[] | undefined): string | null {
  return chosen?.find((c) => c.actorId === actorId)?.body ?? null;
}

/**
 * Letters and digits only, so a stored slug ("chillpenguin") and a catalogue
 * name ("ChillPenguin") match without either having to be authoritative.
 */
export const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The body list, wherever the catalogue happens to keep it. */
export function bodiesFromCatalogue(payload: unknown): { name: string; thumbnail?: string; collection?: string }[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["avatars", "bodies"]) {
      if (Array.isArray(record[key])) return record[key] as { name: string }[];
    }
  }
  return [];
}

/**
 * Ownership and membership, kept apart.
 *
 * OPERATING AN AGENT GRANTS NO PROJECT AUTHORITY. Ownership is lineage —
 * who is answerable for this instrument — and membership is permission. The
 * schema keeps them in separate tables that nothing joins; returning them as
 * one list here would quietly assert what the database refuses to.
 */
export function standingOf(
  actorId: string,
  ownerships: readonly OwnershipLink[],
  memberships: readonly ProjectMembership[],
) {
  const live = (o: OwnershipLink) => o.state !== "revoked";
  return {
    operatedBy: ownerships.filter((o) => live(o) && o.agentActorId === actorId),
    operates: ownerships.filter((o) => live(o) && o.ownerActorId === actorId),
    projects: memberships.filter((m) => m.actorId === actorId && m.active).map((m) => m.projectId),
  };
}
