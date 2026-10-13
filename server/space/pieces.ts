import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyPieces, allShown, parsePieces, type PiecesChange, type PiecesEvent, type RoomPieces } from "../../shared/room-pieces.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/** Which pieces each room has hidden, stored. See shared/room-pieces.ts. */
export class RoomPiecesStore extends RoomState<RoomPieces> {
  constructor(database: DatabaseSync) {
    super(database, "space_pieces", parsePieces, allShown);
  }
}

/**
 * GET  /bff/space/pieces           which pieces are hidden
 * POST /bff/space/pieces { name, shown } or { all } turn one piece, or all, on or off, for everyone
 */
export function registerPiecesRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  pieces: RoomPiecesStore;
  announce: (room: string, event: PiecesEvent) => void;
}): void {
  registerRoomStateRoutes<RoomPieces, PiecesChange, PiecesEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/pieces",
    key: "pieces",
    store: deps.pieces,
    apply: (state, change, by) => {
      const result = applyPieces(state, change, by);
      return "refused" in result ? result : { state: result.pieces, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say which piece to show or hide, or all of them.",
  });
}
