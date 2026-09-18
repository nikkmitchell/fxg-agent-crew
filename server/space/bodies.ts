import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { actorKey } from "../../shared/space-layout.js";
import { bodiesOnHand, bodyKey, chooseBody, type BodyOnHand } from "../../shared/avatar-choice.js";

/** The catalogue as the body routes see it: a lookup by `bodyKey`, and how many bodies it knows. */
export type CatalogueLookup = ((key: string) => { name: string } | null) & { size: () => number };

/**
 * WHAT CAN ACTUALLY BE WORN, worked out from the same lookup chooseBody is
 * given rather than written as prose.
 *
 * The prose this replaces said the other 285 "need their file fetching first,
 * which is not built yet" for a day after they were built. Nightjar, the first
 * agent to read it cold, very nearly believed fifteen and never tried the rest.
 * Nothing errors when a note is stale, so nothing corrects the belief. A
 * sentence computed from the facts behind the behaviour cannot outlive it.
 *
 * `wearable` is how many distinct names PUT /bff/space/body accepts: every
 * catalogue body, plus any body on hand that the catalogue does not list.
 */
export function describeWardrobe(
  onHand: readonly BodyOnHand[],
  catalogue: CatalogueLookup | undefined,
): { wearable: number; note: string } {
  if (!catalogue) {
    return {
      wearable: onHand.length,
      note:
        "onHand is everything that can be worn here. This server cannot read the catalogue, so it cannot " +
        "tell whether any other name is a real body.",
    };
  }
  const listed = catalogue.size();
  const unlisted = onHand.filter((one) => !catalogue(bodyKey(one.catalogue ?? one.slug))).length;
  return {
    wearable: listed + unlisted,
    note:
      `Any of the ${listed} bodies in the catalogue can be worn` +
      (unlisted > 0 ? `, and so can the ${unlisted} on hand that it does not list` : "") +
      `: PUT /bff/space/body { "body": "<name>" }. onHand is not a limit. It is the ${onHand.length} whose ` +
      "files ship with the site; any other body's file is fetched the first time a browser asks for it.",
  };
}

/**
 * Which body each actor wears, chosen by that actor.
 *
 * STORED, like homes and unlike presence: it is a decision somebody made, and
 * it should still be true tomorrow. Without a row an actor wears whatever the
 * repo map in src/space/vrm-model.ts says, exactly as before — see the note on
 * migration 22 for why that fallback is the safety property rather than a
 * leftover.
 *
 * NOTHING HERE ANNOUNCES A CHANGE, and that is not an omission. The hub reads
 * this table on every snapshot, so a new choice is on the wire within one tick
 * and every browser already in the room swaps the model without a reload. A
 * broadcast beside that would be a second path to the same fact — the kind
 * that drifts and leaves one client drawing a body nobody wears any more.
 */
export class AgentBodies {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /** The slug this actor has chosen, or null if they have not. */
  get(actorId: string): string | null {
    const row = this.database
      .prepare("SELECT body FROM agent_bodies WHERE actor_key = ?")
      .get(actorKey(actorId)) as { body: string } | undefined;
    return row?.body ?? null;
  }

  set(actorId: string, body: string, setBy: string): void {
    this.database
      .prepare(
        `INSERT INTO agent_bodies (actor_key, actor_id, body, set_by, set_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (actor_key) DO UPDATE SET actor_id = excluded.actor_id, body = excluded.body,
           set_by = excluded.set_by, set_at = excluded.set_at`,
      )
      .run(actorKey(actorId), actorId, body, setBy, new Date(this.now()).toISOString());
  }

  /**
   * Forget this actor's choice, putting them back on the repo map.
   *
   * Worth having rather than only ever overwriting: "I no longer want to have
   * chosen" is a real thing to want, and expressing it by picking whatever the
   * map would have said would freeze today's default into a choice.
   */
  clear(actorId: string): void {
    this.database.prepare("DELETE FROM agent_bodies WHERE actor_key = ?").run(actorKey(actorId));
  }

  all(): { actorId: string; body: string; setBy: string; setAt: string }[] {
    return this.database
      .prepare(
        "SELECT actor_id AS actorId, body, set_by AS setBy, set_at AS setAt FROM agent_bodies ORDER BY actor_id",
      )
      .all() as { actorId: string; body: string; setBy: string; setAt: string }[];
  }
}

export function registerBodyRoutes(
  app: FastifyInstance,
  deps: {
    config: Config;
    sessions: SessionStore;
    bodies: AgentBodies;
    /**
     * A name the wardrobe does not hold, looked up in the catalogue of 300.
     *
     * Found means it is a real body and can be worn — its file is fetched on
     * first use. Not found means no such body. ABSENT, OR KNOWING NOTHING,
     * means this server cannot read the catalogue and genuinely does not know,
     * which is a third answer and must not be reported as either of the first
     * two. See server/space/catalogue.ts.
     */
    inTheCatalogue?: CatalogueLookup;
  },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  /**
   * The lookup chooseBody is given, or none when the catalogue cannot be read.
   *
   * A lookup that knows nothing is not the same as no lookup. Handed to
   * chooseBody, it would answer every real body "no body is called X", the
   * false claim NOT_SERVED_YET exists to prevent. That is what production
   * would have said on a box whose catalogue file went missing, because the
   * lookup is always passed and only its contents were ever empty.
   */
  const readable = (): CatalogueLookup | undefined =>
    deps.inTheCatalogue && deps.inTheCatalogue.size() > 0 ? deps.inTheCatalogue : undefined;

  /**
   * WHAT CAN BE WORN TODAY, and what cannot.
   *
   * Open to any session, because it is a wardrobe rather than anybody's data,
   * and an agent needs it before it has decided anything.
   */
  app.get("/bff/space/bodies", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const onHand = bodiesOnHand();
    return reply.send({
      onHand,
      chosen: deps.bodies.all(),
      catalogue: "/avatars/catalogue.json",
      ...describeWardrobe(onHand, readable()),
    });
  });

  /**
   * WHO MAY DRESS WHOM.
   *
   * YOURSELF, ALWAYS. That is the feature: the target is taken from the
   * session, never from the payload, so there is no field an agent could set
   * to dress somebody else. This is the whole security surface.
   *
   * A PERSON MAY DRESS AN AGENT, because that is what happens today and it
   * should keep working — Nikk chose Anita's body at Paul's request, and the
   * fix for the nine hours is to add self-service, not to remove the help.
   *
   * AN AGENT MAY NOT DRESS ANOTHER AGENT, and no session may dress a person
   * other than itself. Changing how a colleague appears to everybody is not a
   * thing to be done to them.
   */
  const mayDress = (session: { username: string; kind?: string | null }, actorId: string): string | null => {
    if (actorKey(session.username) === actorKey(actorId)) return null;
    if (session.kind === "agent") return "an agent may choose its own body, not another actor's";
    return null;
  };

  const apply = (
    session: { username: string; kind?: string | null },
    actorId: string,
    asked: unknown,
  ): { code: number; body: Record<string, unknown> } => {
    const refusal = mayDress(session, actorId);
    if (refusal) return { code: 403, body: { code: "NOT_ALLOWED", error: refusal } };
    const chosen = chooseBody(asked, readable());
    if ("error" in chosen) return { code: 400, body: { code: chosen.code, error: chosen.error } };
    deps.bodies.set(actorId, chosen.slug, session.username);
    return { code: 200, body: { ok: true, actorId, body: chosen.slug, looked: chosen.looked } };
  };

  /**
   * MY OWN BODY, with no actor id in the path.
   *
   * Two routes for one thing, on purpose. An agent does not reliably know how
   * the room spells its own name — the chat says `Inkstone` and the room says
   * `inkstone` — and making somebody get that right to dress themselves is a
   * trap with no upside. Here the server knows who you are from the cookie.
   */
  app.put<{ Body: { body?: unknown; avatar?: unknown } }>("/bff/space/body", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    // `avatar` as well as `body`, because both are the obvious word for it and
    // guessing wrong should not be a silent no-op.
    const asked = request.body?.body ?? request.body?.avatar;
    const result = apply(session, session.username, asked);
    return reply.code(result.code).send(result.body);
  });

  app.delete("/bff/space/body", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    deps.bodies.clear(session.username);
    return reply.send({ ok: true, actorId: session.username, body: null });
  });

  /** Somebody else's, for a person dressing an agent. */
  app.put<{ Params: { actorId: string }; Body: { body?: unknown; avatar?: unknown } }>(
    "/bff/space/bodies/:actorId",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const asked = request.body?.body ?? request.body?.avatar;
      const result = apply(session, request.params.actorId, asked);
      return reply.code(result.code).send(result.body);
    },
  );

  app.delete<{ Params: { actorId: string } }>("/bff/space/bodies/:actorId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const refusal = mayDress(session, request.params.actorId);
    if (refusal) return reply.code(403).send({ code: "NOT_ALLOWED", error: refusal });
    deps.bodies.clear(request.params.actorId);
    return reply.send({ ok: true, actorId: request.params.actorId, body: null });
  });
}

/** What the room should draw this actor in, or null to leave it to the repo map. */
export function bodyOf(bodies: Pick<AgentBodies, "get"> | null, actorId: string): string | null {
  return bodies?.get(actorId) ?? null;
}

export type { BodyOnHand };
