import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyMandala, emptyMandala, parseMandala, type MandalaChange, type MandalaEvent, type Mandala } from "../../shared/mandala.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/**
 * Each room's sand mandala. See shared/mandala.ts.
 *
 * STORED until it is swept: it is built over days, by whoever passes.
 */
export class RoomMandalas extends RoomState<Mandala> {
  constructor(database: DatabaseSync) {
    super(database, "space_mandala", parseMandala, emptyMandala);
  }
}

/**
 * GET  /bff/space/mandala                              the plate as it is
 * POST /bff/space/mandala  { action: "pour", colour, points } | { action: "sweep" }
 */
export function registerMandalaRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  mandalas: RoomMandalas;
  announce: (room: string, event: MandalaEvent) => void;
}): void {
  registerRoomStateRoutes<Mandala, MandalaChange, MandalaEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/mandala",
    key: "mandala",
    store: deps.mandalas,
    apply: (state, change, by) => {
      const result = applyMandala(state, change, by, () => randomUUID().slice(0, 8));
      return "refused" in result ? result : { state: result.mandala, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say what to do with the sand: pour or sweep.",
  });
}
