type Db = import("node:sqlite").DatabaseSync;

/**
 * Reads.
 *
 * The whole point of ADR-002 is in this file. Answering "which cards are in
 * review" used to mean pulling about a thousand chat messages and folding them;
 * `tools/board-dump.mts` exists only because there was no way to simply ask.
 * Now it is a SELECT with an index behind it.
 *
 * Reads take no authority argument. Board contents are visible to anyone with a
 * session — the boundary is the session, not the row. Writes are where
 * membership is checked, and that stays in store.ts.
 */

export type BoardView = ReturnType<BoardReads["project"]>;

export class BoardReads {
  constructor(private readonly db: Db) {}

  projects() {
    return this.db.prepare("SELECT id, name, summary, created_by, created_at FROM projects ORDER BY name").all();
  }

  /**
   * Everything one project's screen needs, in a handful of queries rather than
   * one per card. The N+1 version was measurably fine at this size and would
   * stop being fine exactly when the board got interesting.
   */
  project(projectId: string) {
    const project = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
      | Record<string, unknown> | undefined;
    if (!project) return null;

    const goals = (this.db.prepare("SELECT text FROM project_goals WHERE project_id=? ORDER BY position")
      .all(projectId) as Array<{ text: string }>).map((g) => g.text);

    const tasks = this.db.prepare(`
      SELECT t.*,
             (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
      FROM tasks t WHERE t.project_id = ?
      ORDER BY CASE WHEN t.priority IS NULL THEN 1 ELSE 0 END, t.priority, t.created_at
    `).all(projectId) as Array<Record<string, unknown>>;

    const owners = this.db.prepare(`
      SELECT o.task_id, o.actor_id, o.accepted FROM task_owners o
      JOIN tasks t ON t.id = o.task_id WHERE t.project_id = ?
    `).all(projectId) as Array<{ task_id: string; actor_id: string; accepted: number }>;

    const comments = this.db.prepare(`
      SELECT c.* FROM comments c JOIN tasks t ON t.id = c.task_id
      WHERE t.project_id = ? ORDER BY c.created_at
    `).all(projectId) as Array<Record<string, unknown>>;

    const links = this.db.prepare(`
      SELECT l.* FROM task_links l JOIN tasks t ON t.id = l.task_id WHERE t.project_id = ?
    `).all(projectId) as Array<Record<string, unknown>>;

    return {
      project: { ...project, goals },
      tasks: tasks.map((task) => ({
        ...task,
        owners: owners.filter((o) => o.task_id === task.id).map((o) => o.actor_id),
        acceptedBy: owners.filter((o) => o.task_id === task.id && o.accepted === 1).map((o) => o.actor_id),
        comments: comments.filter((c) => c.task_id === task.id),
        links: links.filter((l) => l.task_id === task.id),
      })),
      memberships: this.memberships(projectId),
      boards: this.boards(projectId),
    };
  }

  memberships(projectId?: string) {
    const rows = projectId
      ? this.db.prepare("SELECT * FROM memberships WHERE project_id = ?").all(projectId)
      : this.db.prepare("SELECT * FROM memberships").all();
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      projectId: row.project_id,
      actorId: row.actor_id,
      // Stored as JSON because SQLite has no array type. Parsed here so no
      // caller has to remember that it is a string.
      roles: JSON.parse(String(row.roles)),
      active: row.active === 1,
      grantedBy: row.granted_by,
    }));
  }

  actors() {
    return this.db.prepare("SELECT * FROM actors ORDER BY id").all();
  }

  ownerships() {
    return (this.db.prepare("SELECT * FROM ownerships").all() as Array<Record<string, unknown>>).map((row) => ({
      agentActorId: row.agent_id,
      ownerActorId: row.owner_id,
      state: row.state,
    }));
  }

  boards(projectId: string) {
    const boards = this.db.prepare("SELECT * FROM boards WHERE project_id = ? ORDER BY created_at").all(projectId) as
      Array<Record<string, unknown>>;
    if (!boards.length) return [];
    const items = this.db.prepare(`
      SELECT i.*, b.mime AS blob_mime, b.width AS blob_width, b.height AS blob_height
      FROM board_items i
      LEFT JOIN blobs b ON b.id = i.blob_id
      JOIN boards bd ON bd.id = i.board_id
      WHERE bd.project_id = ? ORDER BY i.z
    `).all(projectId) as Array<Record<string, unknown>>;
    return boards.map((board) => ({ ...board, items: items.filter((i) => i.board_id === board.id) }));
  }

  /** History for one card, newest last, so a reader can see how it got here. */
  history(entity: string, entityId: string, limit = 100) {
    return this.db.prepare(
      "SELECT at, actor_id, action, before, after FROM audit WHERE entity=? AND entity_id=? ORDER BY id DESC LIMIT ?",
    ).all(entity, entityId, limit);
  }
}
