import type { FastifyInstance } from "fastify";
import { roomKey } from "../../shared/space-room.js";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout.js";
import {
  defaultPlacement,
  normaliseRotation,
  placementRefusal,
  scaleOf,
} from "../../shared/panel-place.js";
import type { Placement } from "../../shared/space-wire.js";
import type { SessionStore } from "../session.js";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";

/**
 * Which panels a person has open.
 *
 * The room shows four things and not everybody wants four things. This is the
 * smallest possible store for that: a row per decision, no row where nobody has
 * decided, and the defaults from `shared/space-layout.ts` filling the gap.
 *
 * SHARED, LIKE POSITION AND SCALE — and this file used to argue the opposite,
 * so the old reasoning is kept because it was not wrong, only answering a
 * different question: "Positions are shared, because the server computes an
 * agent's destination from its panel's position... What you have OPEN is yours
 * alone, because nothing anybody else sees depends on it."
 *
 * Nothing does break when each person has their own set, which is what that
 * argued. But necessity is not the same as fit. Nikk, having used it: "Now the
 * enabled or dissabled boards/panels are not syned, we want this to also be
 * synced, have it the same as position and scale of boards." Dragging a panel
 * already moves it for everybody and resizing already resizes it for
 * everybody; a room where the furniture is shared but which furniture EXISTS
 * is private is a strange half-room.
 *
 * THE CONSEQUENCE, SAID PLAINLY: closing a panel now closes it for everyone,
 * including somebody reading it in a headset. That is the same deal as
 * dragging, which already pulls a board out from under a reader — but more
 * noticeable, because a panel that vanishes is harder to follow than one that
 * slides. Hence `set_by` and `set_at`: "why has the mood board gone" should be
 * answerable without asking around.
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
  open(room: string): string[] {
    const rows = this.database
      .prepare("SELECT panel_id, open FROM space_panel_shown WHERE room = ?")
      .all(roomKey(room)) as { panel_id: string; open: number }[];
    const decided = new Map(rows.map((row) => [row.panel_id, row.open === 1]));
    return Object.keys(STATIONS).filter(
      (id) => decided.get(id) ?? DEFAULT_OPEN_PANELS.includes(id),
    );
  }

  /** Record a decision. Returns null when it was accepted, a sentence when not. */
  set(room: string, panelId: string, open: boolean, by: string, at: string): string | null {
    if (!(panelId in STATIONS)) return `there is no panel called "${panelId}"`;
    // REFUSING TO CLOSE THE LAST ONE. An empty arc is indistinguishable from a
    // room that failed to load, and the way out of it is a settings list the
    // person has just learned they cannot see. Cheaper to say no.
    //
    // NOW A REFUSAL ON EVERYBODY'S BEHALF, which is a stronger reason for it
    // rather than a weaker one: closing the last panel would empty the room
    // for every person in it, including people not looking at a settings menu
    // and with no idea why the walls went bare.
    if (!open && this.open(room).filter((id) => id !== panelId).length === 0) {
      return "that is the last panel open; the room would be empty for everybody and nobody could get back";
    }
    this.database
      .prepare(
        `INSERT INTO space_panel_shown (room, panel_id, open, set_by, set_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room, panel_id) DO UPDATE SET open = excluded.open, set_by = excluded.set_by, set_at = excluded.set_at`,
      )
      .run(roomKey(room), panelId, open ? 1 : 0, by, at);
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
  all(room: string): Placement[] {
    const rows = this.database
      .prepare("SELECT panel_id, x, y, z, rotation_y, scale FROM space_panel_place WHERE room = ?")
      .all(roomKey(room)) as {
      panel_id: string;
      x: number;
      y: number;
      z: number;
      rotation_y: number;
      scale: number;
    }[];
    const moved = new Map(
      rows.map((row) => [
        row.panel_id,
        {
          id: row.panel_id,
          position: { x: row.x, y: row.y, z: row.z },
          rotationY: row.rotation_y,
          scale: row.scale,
        },
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
    room: string,
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
      scale: scaleOf(place),
    };
    this.database
      .prepare(
        `INSERT INTO space_panel_place (room, panel_id, x, y, z, rotation_y, scale, moved_by, moved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(room, panel_id) DO UPDATE SET
           x = excluded.x, y = excluded.y, z = excluded.z,
           rotation_y = excluded.rotation_y, scale = excluded.scale,
           moved_by = excluded.moved_by, moved_at = excluded.moved_at`,
      )
      .run(
        roomKey(room),
        stored.id,
        stored.position.x,
        stored.position.y,
        stored.position.z,
        stored.rotationY,
        stored.scale ?? 1,
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
    announceOpen,
  }: {
    database: DatabaseSync;
    sessions: SessionStore;
    config: Config;
    /** Tell everyone in the room, so a panel moves under their eyes. */
    announce: (room: string, placement: Placement, by: string) => void;
    announceOpen: (room: string, open: string[], by: string) => void;
  },
) {
  const requireSession = makeRequireSession(config, sessions);
  const choices = new PanelChoices(database);
  const places = new PanelPlaces(database);

  /** The catalogue, and which of it you have open. */
  app.get("/bff/space/panels", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({
      panels: Object.values(STATIONS).map((station) => ({
        id: station.id,
        label: station.label,
        tab: station.tab,
      })),
      open: choices.open(spaceRoomOf(session)),
      places: places.all(spaceRoomOf(session)),
    });
  });

  app.put<{ Params: { id: string }; Body: { open?: unknown } }>(
    "/bff/space/panels/:id",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const open = request.body?.open;
      if (typeof open !== "boolean") {
        return reply.code(400).send({ code: "BAD_OPEN", error: "open must be true or false" });
      }
      const refused = choices.set(
        spaceRoomOf(session),
        request.params.id,
        open,
        session.username,
        new Date().toISOString(),
      );
      // 422 rather than 400: the request was understood and declined on its
      // merits, and the sentence is the point.
      if (refused) return reply.code(422).send({ code: "REFUSED", error: refused });
      const shown = choices.open(spaceRoomOf(session));
      // TOLD TO EVERYBODY, like a move. Without this the person who clicked
      // sees it and nobody else does until they reload — which is the bug this
      // change exists to fix, merely moved from the database to the socket.
      announceOpen(spaceRoomOf(session), shown, session.username);
      return reply.send({ open: shown });
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
  app.put<{
    Params: { id: string };
    Body: { position?: unknown; rotationY?: unknown; scale?: unknown };
  }>(
    "/bff/space/panels/:id/place",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;

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
      /**
       * SIZE IS OPTIONAL, and absent is different from wrong.
       *
       * A client that predates resizing sends no scale at all, and refusing
       * those would break every drag from an older tab. Absent means "leave it
       * as it is"; a scale that is present and not a number is a bug worth
       * saying out loud rather than quietly ignoring.
       */
      if (body.scale !== undefined && typeof body.scale !== "number") {
        return reply.code(400).send({ code: "BAD_PLACE", error: "scale must be a number" });
      }

      const result = places.place(
        spaceRoomOf(session),
        {
          id: request.params.id,
          position: { x: position.x, y: position.y, z: position.z },
          rotationY: body.rotationY,
          ...(body.scale !== undefined ? { scale: body.scale } : {}),
        },
        session.username,
        new Date().toISOString(),
      );
      if ("refused" in result) {
        return reply.code(422).send({ code: "REFUSED", error: result.refused });
      }
      announce(spaceRoomOf(session), result.placement, session.username);
      return reply.send({ placement: result.placement });
    },
  );
}
