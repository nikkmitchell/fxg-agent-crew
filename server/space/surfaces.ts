import type { DatabaseSync } from "node:sqlite";
import { LANES, type Lane, type Surfaces, type WallBoard, type WallCard, type WallItem } from "../../shared/space-surfaces.js";

/**
 * Read the walls.
 *
 * No authority argument, exactly like `BoardReads`: reads in this product are
 * not gated per project, and inventing a second rule here would be a security
 * boundary nobody else knows about. The session check happens at the route.
 */
export function readSurfaces(db: DatabaseSync, requestedProjectId?: string): Surfaces {
  // "Most recently touched" has to mean the cards, not the project row.
  // `projects.updated_at` only moves when the project itself is edited — which
  // is almost never — so ordering by it put a dormant project on the wall while
  // the one everybody was working in sat second. The board's own activity is
  // what the wall should follow.
  const projects = db
    .prepare(
      `SELECT p.id, p.name,
              COALESCE(MAX(t.updated_at), p.updated_at) AS updatedAt
         FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id, p.name, p.updated_at
        ORDER BY updatedAt DESC, p.id ASC`,
    )
    .all() as unknown as { id: string; name: string; updatedAt: string }[];

  // Default to the most recently touched project rather than the first
  // alphabetically: the wall should show the thing being worked on. An
  // unrecognised id falls back to that too, instead of rendering an empty wall
  // that looks like a project with no cards in it.
  const projectId =
    (requestedProjectId && projects.some((p) => p.id === requestedProjectId) ? requestedProjectId : null) ??
    projects[0]?.id ??
    null;

  if (!projectId) return { projects, projectId: null, cards: [], boards: [] };

  const rows = db
    .prepare(
      `SELECT id, title, status, kind, blocker FROM tasks
        WHERE project_id = ?
        ORDER BY CASE WHEN priority IS NULL THEN 1 ELSE 0 END, priority, created_at`,
    )
    .all(projectId) as unknown as {
    id: string;
    title: string;
    status: string;
    kind: "build" | "decision" | null;
    blocker: string | null;
  }[];

  const owners = db
    .prepare(
      `SELECT o.task_id AS taskId, o.actor_id AS actorId FROM task_owners o
         JOIN tasks t ON t.id = o.task_id WHERE t.project_id = ?`,
    )
    .all(projectId) as unknown as { taskId: string; actorId: string }[];

  const isLane = (value: string): value is Lane => (LANES as readonly string[]).includes(value);

  const cards: WallCard[] = rows
    // A status the schema does not allow cannot exist, but if one ever did it
    // would silently vanish from a lane rather than appear in the wrong one.
    .filter((row) => isLane(row.status))
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as Lane,
      kind: row.kind,
      owners: owners.filter((o) => o.taskId === row.id).map((o) => o.actorId),
      blocker: row.blocker,
    }));

  const boardRows = db
    .prepare("SELECT id, name FROM boards WHERE project_id = ? ORDER BY created_at")
    .all(projectId) as unknown as { id: string; name: string }[];

  const itemRows = db
    .prepare(
      `SELECT i.id, i.board_id AS boardId, i.kind, i.blob_id AS blobId, i.text, i.caption,
              i.x, i.y, i.w, i.h, i.z
         FROM board_items i JOIN boards b ON b.id = i.board_id
        WHERE b.project_id = ? ORDER BY i.z`,
    )
    .all(projectId) as unknown as (WallItem & { boardId: string })[];

  const boards: WallBoard[] = boardRows.map((board) => ({
    id: board.id,
    name: board.name,
    items: itemRows
      .filter((item) => item.boardId === board.id)
      .map(({ boardId, ...item }) => {
        void boardId;
        return item;
      }),
  }));

  return { projects, projectId, cards, boards };
}
