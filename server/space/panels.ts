import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout.js";
import type { SessionStore } from "../session.js";
import type { Config } from "../config.js";

/**
 * Which panels a person has open.
 *
 * The room shows four things and not everybody wants four things. This is the
 * smallest possible store for that: a row per decision, no row where nobody has
 * decided, and the defaults from `shared/space-layout.ts` filling the gap.
 *
 * WHY THIS IS SEPARATE FROM WHERE THE PANELS ARE. Positions are shared, because
 * the server computes an agent's destination from its panel's position — a
 * per-person arrangement would have me watching an agent walk to empty air
 * while the room told me it had gone to the board. What you have OPEN is yours
 * alone, because nothing anybody else sees depends on it.
 */
export class PanelChoices {
  constructor(private readonly database: DatabaseSync) {}

  /**
   * The panel ids this actor has open, in catalogue order.
   *
   * Catalogue order rather than the order rows were written: the arc is a place
   * and its panels have a left-to-right, and a settings list that reshuffles as
   * you click is a settings list you cannot use.
   */
  openFor(actorId: string): string[] {
    const rows = this.database
      .prepare("SELECT panel_id, open FROM space_panel_open WHERE actor_id = ?")
      .all(actorId) as { panel_id: string; open: number }[];
    const decided = new Map(rows.map((row) => [row.panel_id, row.open === 1]));
    return Object.keys(STATIONS).filter(
      (id) => decided.get(id) ?? DEFAULT_OPEN_PANELS.includes(id),
    );
  }

  /** Record a decision. Returns null when it was accepted, a sentence when not. */
  set(actorId: string, panelId: string, open: boolean, at: string): string | null {
    if (!(panelId in STATIONS)) return `there is no panel called "${panelId}"`;
    // REFUSING TO CLOSE THE LAST ONE. An empty arc is indistinguishable from a
    // room that failed to load, and the way out of it is a settings list the
    // person has just learned they cannot see. Cheaper to say no.
    if (!open && this.openFor(actorId).filter((id) => id !== panelId).length === 0) {
      return "that is the last panel you have open; the room would be empty and you could not get back";
    }
    this.database
      .prepare(
        `INSERT INTO space_panel_open (actor_id, panel_id, open, at) VALUES (?, ?, ?, ?)
         ON CONFLICT(actor_id, panel_id) DO UPDATE SET open = excluded.open, at = excluded.at`,
      )
      .run(actorId, panelId, open ? 1 : 0, at);
    return null;
  }
}

export function registerPanelRoutes(
  app: FastifyInstance,
  {
    database,
    sessions,
    config,
  }: { database: DatabaseSync; sessions: SessionStore; config: Config },
) {
  const choices = new PanelChoices(database);

  /** The catalogue, and which of it you have open. */
  app.get("/bff/space/panels", async (request, reply) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in" });
    return reply.send({
      panels: Object.values(STATIONS).map((station) => ({
        id: station.id,
        label: station.label,
        tab: station.tab,
      })),
      open: choices.openFor(session.username),
    });
  });

  app.put<{ Params: { id: string }; Body: { open?: unknown } }>(
    "/bff/space/panels/:id",
    async (request, reply) => {
      const session = sessions.get(request.cookies[config.cookieName]);
      if (!session) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in" });
      const open = request.body?.open;
      if (typeof open !== "boolean") {
        return reply.code(400).send({ code: "BAD_OPEN", error: "open must be true or false" });
      }
      const refused = choices.set(
        session.username,
        request.params.id,
        open,
        new Date().toISOString(),
      );
      // 422 rather than 400: the request was understood and declined on its
      // merits, and the sentence is the point.
      if (refused) return reply.code(422).send({ code: "REFUSED", error: refused });
      return reply.send({ open: choices.openFor(session.username) });
    },
  );
}
