import type { FastifyInstance } from "fastify";
import { roomKey } from "../../shared/space-room.js";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { Showing } from "../../shared/space-wire.js";
import type { BoardReads } from "../db/reads.js";

/**
 * What the room is showing, as one shared fact.
 *
 * WHY THIS IS SERVER STATE AND NOT A SETTING. Every other "which project" in
 * the app lives in localStorage and changes nothing for anybody else. This one
 * has to be shared, because people stand in this room together and talk about
 * what is on the wall — two people looking at different boards while pointing
 * at "that card" is a conversation that cannot happen. Same argument as where
 * a panel hangs, which is already shared.
 *
 * AND BECAUSE AGENTS HAVE TO BE ABLE TO READ IT. Nikk: "agents should be
 * aware." A choice living in one person's browser is invisible to everything
 * else; a row here is something an agent can ask about, act on, and be told
 * about when it changes.
 */
export class RoomShowing {
  constructor(
    private readonly database: DatabaseSync,
    private readonly reads: BoardReads,
  ) {}

  /** What THIS room is showing. Nulls until somebody in it chooses. */
  current(room: string): Showing {
    const row = this.database
      .prepare("SELECT project_id, board_id, set_by, set_at FROM space_showing WHERE room = ?")
      .get(roomKey(room)) as
      | { project_id: string | null; board_id: string | null; set_by: string; set_at: string }
      | undefined;
    if (!row) return { projectId: null, boardId: null, setBy: null, setAt: null };
    return {
      projectId: row.project_id,
      boardId: row.board_id,
      setBy: row.set_by,
      setAt: row.set_at,
    };
  }

  /**
   * Change what the room is showing, or say why not.
   *
   * CHECKED AGAINST WHAT EXISTS, rather than stored and discovered wrong later.
   * A room pointed at a deleted project shows an error to everybody at once,
   * and the person who would have to work out why is not the person who set it.
   *
   * A board must belong to the project it is shown with. They are two fields of
   * one choice — "this project's mood board" — and allowing a board from some
   * other project would put a wall and a board in the room that have nothing to
   * do with each other.
   */
  set(
    room: string,
    choice: { projectId: string | null; boardId: string | null },
    by: string,
    at: string,
  ): { showing: Showing } | { refused: string } {
    const projectId = choice.projectId?.trim() || null;
    const boardId = choice.boardId?.trim() || null;

    if (boardId && !projectId) {
      return { refused: "a mood board cannot be shown without the project it belongs to" };
    }

    if (projectId) {
      const projects = this.reads.projects() as { id: string }[];
      if (!projects.some((project) => project.id === projectId)) {
        return { refused: `there is no project called "${projectId}"` };
      }
      if (boardId) {
        // `boards()` returns each board with its items attached, so the id is
        // reached through the row rather than a typed field.
        const boards = this.reads.boards(projectId) as unknown as { id?: unknown }[];
        if (!boards.some((board) => board.id === boardId)) {
          return { refused: "that mood board is not in that project" };
        }
      }
    }

    const before = this.current(room);
    this.database
      .prepare(
        `INSERT INTO space_showing (room, project_id, board_id, set_by, set_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room) DO UPDATE SET
           project_id = excluded.project_id, board_id = excluded.board_id,
           set_by = excluded.set_by, set_at = excluded.set_at`,
      )
      .run(roomKey(room), projectId, boardId, by, at);

    /**
     * RECORDED IN THE AUDIT TRAIL, because this is how an agent finds out.
     *
     * Nikk asked that agents be aware of the choice. Two halves: the route
     * below lets one ASK, and this row means one that was not watching can
     * still find out that the room changed, who changed it, and from what —
     * the same stream the rest of the app already uses to know what happened.
     *
     * Written here rather than through BoardStore because that class audits
     * board mutations inside its own transactions, and this is not a board
     * mutation; borrowing its private helper would have meant making it public
     * for one caller with different rules.
     */
    this.database
      .prepare(
        `INSERT INTO audit (at, actor_id, action, entity, entity_id, before, after)
         VALUES (?, ?, 'update', 'room-showing', 'room', ?, ?)`,
      )
      .run(
        at,
        by,
        JSON.stringify({ projectId: before.projectId, boardId: before.boardId }),
        JSON.stringify({ projectId, boardId }),
      );

    return { showing: { projectId, boardId, setBy: by, setAt: at } };
  }
}

/**
 * Reading and changing what the room shows.
 *
 * A ROUTE RATHER THAN A SOCKET FRAME, deliberately, and for the same reason
 * moving a panel is: a refusal here is a sentence somebody has to read — "there
 * is no project called that", "that mood board is not in that project" — and a
 * fire-and-forget frame has nowhere to put one. The socket carries the
 * announcement afterwards, which is the part everybody else needs.
 *
 * READABLE BY AGENTS, which is not a special case: an agent signs in with its
 * own token and gets a session like anybody else, so GET here is how it finds
 * out what the room is looking at without being told.
 */
export function registerShowingRoutes(
  app: FastifyInstance,
  {
    showing,
    sessions,
    config,
    announce,
  }: {
    showing: RoomShowing;
    sessions: SessionStore;
    config: Config;
    announce: (room: string, showing: Showing) => void;
  },
): void {
  const requireSession = makeRequireSession(config, sessions);

  app.get("/bff/space/showing", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ showing: showing.current(spaceRoomOf(session)) });
  });

  app.put<{ Body: { projectId?: unknown; boardId?: unknown } }>(
    "/bff/space/showing",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;

      const body = request.body ?? {};
      // Null is a real answer here — "show nothing" — so it is accepted and
      // only the wrong TYPE is refused. Undefined means the same as null: the
      // caller did not name one.
      for (const field of ["projectId", "boardId"] as const) {
        const value = body[field];
        if (value !== undefined && value !== null && typeof value !== "string") {
          return reply
            .code(400)
            .send({ code: "BAD_SHOWING", error: `${field} must be a string or null` });
        }
      }

      const result = showing.set(
        spaceRoomOf(session),
        {
          projectId: (body.projectId as string | null | undefined) ?? null,
          boardId: (body.boardId as string | null | undefined) ?? null,
        },
        session.username,
        new Date().toISOString(),
      );
      if ("refused" in result) {
        return reply.code(422).send({ code: "REFUSED", error: result.refused });
      }

      announce(spaceRoomOf(session), result.showing);
      return reply.send({ showing: result.showing });
    },
  );
}
