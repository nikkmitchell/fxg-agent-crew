import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout.js";
import {
  defaultPlacement,
  normaliseRotation,
  placementRefusal,
} from "../../shared/panel-place.js";
import type { Placement } from "../../shared/space-wire.js";
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

/**
 * Where the panels hang.
 *
 * SHARED, unlike which ones you have open. The server works out where an agent
 * should walk from where its panel is, so a per-person arrangement would have
 * one of us watching an agent cross to empty space while the room insisted it
 * had gone to the board. Moving a panel is moving furniture.
 *
 * A row only where somebody moved one: no row means the panel is where
 * `shared/space-layout.ts` computes it, which keeps "nobody has touched this"
 * distinguishable from "somebody put it back exactly".
 */
export class PanelPlaces {
  constructor(private readonly database: DatabaseSync) {}

  /** Every panel, moved or not, in catalogue order. */
  all(): Placement[] {
    const rows = this.database
      .prepare("SELECT panel_id, x, y, z, rotation_y FROM space_panel_place")
      .all() as { panel_id: string; x: number; y: number; z: number; rotation_y: number }[];
    const moved = new Map(
      rows.map((row) => [
        row.panel_id,
        { id: row.panel_id, position: { x: row.x, y: row.y, z: row.z }, rotationY: row.rotation_y },
      ]),
    );
    return Object.keys(STATIONS).map(
      (id) => moved.get(id) ?? (defaultPlacement(id) as Placement),
    );
  }

  /**
   * Move one. Returns the placement as stored, or a sentence saying why not.
   *
   * The refusal comes from `shared/panel-place.ts`, which the browser uses to
   * refuse the drag as it happens — one rule, so a panel cannot snap back for
   * one person and stay put for another.
   */
  place(
    place: Placement,
    by: string,
    at: string,
  ): { placement: Placement } | { refused: string } {
    const refused = placementRefusal(place);
    if (refused) return { refused };
    const stored: Placement = {
      id: place.id,
      position: place.position,
      rotationY: normaliseRotation(place.rotationY),
    };
    this.database
      .prepare(
        `INSERT INTO space_panel_place (panel_id, x, y, z, rotation_y, moved_by, moved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(panel_id) DO UPDATE SET
           x = excluded.x, y = excluded.y, z = excluded.z,
           rotation_y = excluded.rotation_y,
           moved_by = excluded.moved_by, moved_at = excluded.moved_at`,
      )
      .run(
        stored.id,
        stored.position.x,
        stored.position.y,
        stored.position.z,
        stored.rotationY,
        by,
        at,
      );
    return { placement: stored };
  }
}

export function registerPanelRoutes(
  app: FastifyInstance,
  {
    database,
    sessions,
    config,
    announce,
  }: {
    database: DatabaseSync;
    sessions: SessionStore;
    config: Config;
    /** Tell everyone in the room, so a panel moves under their eyes. */
    announce: (placement: Placement, by: string) => void;
  },
) {
  const choices = new PanelChoices(database);
  const places = new PanelPlaces(database);

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
      places: places.all(),
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

  /**
   * Put a panel somewhere.
   *
   * HTTP rather than a socket message, even though the result is broadcast on
   * the socket. A move is rare, it either succeeds or is refused with a
   * sentence somebody needs to read, and a request/response says that far
   * better than a fire-and-forget frame — the socket carries positions, which
   * are safe to miss, and this is not.
   */
  app.put<{ Params: { id: string }; Body: { position?: unknown; rotationY?: unknown } }>(
    "/bff/space/panels/:id/place",
    async (request, reply) => {
      const session = sessions.get(request.cookies[config.cookieName]);
      if (!session) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in" });

      const body = request.body ?? {};
      const position = body.position as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      if (
        typeof position?.x !== "number" ||
        typeof position?.y !== "number" ||
        typeof position?.z !== "number" ||
        typeof body.rotationY !== "number"
      ) {
        return reply
          .code(400)
          .send({ code: "BAD_PLACE", error: "a place needs x, y, z and rotationY" });
      }

      const result = places.place(
        {
          id: request.params.id,
          position: { x: position.x, y: position.y, z: position.z },
          rotationY: body.rotationY,
        },
        session.username,
        new Date().toISOString(),
      );
      if ("refused" in result) {
        return reply.code(422).send({ code: "REFUSED", error: result.refused });
      }
      announce(result.placement, session.username);
      return reply.send({ placement: result.placement });
    },
  );
}
