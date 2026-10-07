import type { Status } from "../../shared/board-rules.js";
import { REVIEW_LIMITS, pageCursor, type ReviewMode, type ReviewRound } from "../../shared/reviews.js";
import { pageSize, questionCursor, type AnswerRef, type Question, type QuestionAnswer, type QuestionPage } from "../../shared/questions.js";

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
    `).all(projectId) as Array<{ id: string; status: string } & Record<string, unknown>>;

    const owners = this.db.prepare(`
      SELECT o.task_id, o.actor_id, o.accepted FROM task_owners o
      JOIN tasks t ON t.id = o.task_id WHERE t.project_id = ?
    `).all(projectId) as Array<{ task_id: string; actor_id: string; accepted: number }>;

    const comments = this.db.prepare(`
      SELECT c.* FROM comments c JOIN tasks t ON t.id = c.task_id
      WHERE t.project_id = ? ORDER BY c.task_id, c.position
    `).all(projectId) as Array<Record<string, unknown>>;

    const links = this.db.prepare(`
      SELECT l.* FROM task_links l JOIN tasks t ON t.id = l.task_id WHERE t.project_id = ?
    `).all(projectId) as Array<Record<string, unknown>>;

    /**
     * THE LATEST MOVE OR CREATION OF EACH CARD, recent ones only.
     *
     * For the glow and the reveal-on-arrival (see shared/board-freshness.ts),
     * which only ever care about the last few minutes. Bounded by time so the
     * query does not grow with the whole history of the board.
     */
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const changes = this.db.prepare(`
      SELECT a.id, a.at, a.actor_id, a.action, a.entity_id, a.before FROM audit a
      JOIN tasks t ON t.id = a.entity_id
      WHERE a.entity = 'task' AND a.action IN ('create', 'transition') AND t.project_id = ? AND a.at >= ?
      ORDER BY a.id
    `).all(projectId, since) as Array<{ id: number; at: string; actor_id: string; action: string; entity_id: string; before: string | null }>;
    const lastChange = new Map<string, { auditId: number; at: string; actorId: string; previousStatus?: string }>();
    for (const change of changes) {
      let previousStatus: string | undefined;
      if (change.action === "transition" && change.before) {
        try {
          previousStatus = (JSON.parse(change.before) as { status?: string }).status;
        } catch {
          previousStatus = undefined;
        }
      }
      lastChange.set(change.entity_id, {
        auditId: change.id,
        at: change.at,
        actorId: change.actor_id,
        ...(previousStatus ? { previousStatus } : {}),
      });
    }

    return {
      project: { ...project, goals },
      tasks: tasks.map((task) => ({
        ...task,
        lastChange: lastChange.get(task.id as string) ?? null,
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

  // -------------------------------------------------- review rounds (migration 53)

  /** Open rounds (their card not done), newest first, a page at a time. */
  rounds(options: { limit?: number; cursor?: { at: string; id: string } | null } = {}): { items: ReviewRound[]; next: string | null } {
    const limit = Math.max(1, Math.min(REVIEW_LIMITS.page.max, Math.floor(options.limit ?? REVIEW_LIMITS.page.default)));
    const where = ["t.status != 'done'"];
    const values: Array<string | number> = [];
    if (options.cursor) {
      where.push("(r.created_at < ? OR (r.created_at = ? AND r.task_id < ?))");
      values.push(options.cursor.at, options.cursor.at, options.cursor.id);
    }
    const rows = this.db.prepare(`${ROUND_ROWS} WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.task_id DESC LIMIT ?`).all(...values, limit + 1) as RoundRow[];
    const items = rows.slice(0, limit).map((row) => this.toRound(row));
    const last = items[items.length - 1];
    return { items, next: rows.length > limit && last ? pageCursor(last.at, last.id) : null };
  }

  round(id: string): ReviewRound | null {
    const row = this.db.prepare(`${ROUND_ROWS} WHERE r.task_id = ?`).get(id) as RoundRow | undefined;
    return row ? this.toRound(row) : null;
  }

  /** Every deploy an open round shows, so the clean-up keeps them. */
  reviewDeploys(): string[] {
    return (this.db.prepare("SELECT r.candidate, r.baseline FROM review_rounds r JOIN tasks t ON t.id = r.task_id WHERE t.status != 'done'").all() as { candidate: string; baseline: string | null }[])
      .flatMap((row) => (row.baseline ? [row.candidate, row.baseline] : [row.candidate]));
  }

  private toRound(row: RoundRow): ReviewRound {
    const owners = (this.db.prepare("SELECT actor_id, accepted FROM task_owners WHERE task_id = ? ORDER BY actor_id").all(row.task_id) as Array<{ actor_id: string; accepted: number }>)
      .map((owner) => ({ id: owner.actor_id, accepted: owner.accepted === 1 }));
    const findings = (this.db.prepare("SELECT count(*) AS n FROM space_feedback WHERE round = ?").get(row.task_id) as { n: number }).n;
    return {
      id: row.task_id, project: row.project_id, title: row.title.replace(/^Review: /, ""), space: row.space, entry: row.entry, mode: row.mode as ReviewMode,
      candidate: { deploy: row.candidate }, baseline: row.baseline ? { deploy: row.baseline } : null,
      checklist: JSON.parse(row.checklist_json) as string[], card: { status: row.status, owners }, findings, by: row.created_by, at: row.created_at,
    };
  }

  // -------------------------------------------------- questions (migration 51)

  /** Which board a space's questions go to, if a manager has said so. */
  questionIntake(space: string): { projectId: string; grantedBy: string; grantedAt: string } | null {
    const row = this.db.prepare("SELECT project_id, granted_by, granted_at FROM question_intakes WHERE space = ?").get(space) as
      | { project_id: string; granted_by: string; granted_at: string } | undefined;
    return row ? { projectId: row.project_id, grantedBy: row.granted_by, grantedAt: row.granted_at } : null;
  }

  /**
   * One page of the questions asked in a space, newest first: each card's own
   * status and owners, and the newest answer. `cursor` is where the page starts
   * (shared/questions.ts); `next` is where the following one does, or null.
   */
  questions(space: string, options: { askedBy?: string; limit?: number; cursor?: { askedAt: string; id: string } | null } = {}): QuestionPage {
    const limit = pageSize(options.limit);
    const where = ["q.space = ?"];
    const values: Array<string | number> = [space];
    if (options.askedBy) {
      where.push("q.asked_by = ? COLLATE NOCASE");
      values.push(options.askedBy);
    }
    if (options.cursor) {
      where.push("(q.asked_at < ? OR (q.asked_at = ? AND q.task_id < ?))");
      values.push(options.cursor.askedAt, options.cursor.askedAt, options.cursor.id);
    }
    // One more than the page, to know whether there is a next page without a count.
    const rows = this.db.prepare(`${QUESTION_ROWS} WHERE ${where.join(" AND ")} ORDER BY q.asked_at DESC, q.task_id DESC LIMIT ?`)
      .all(...values, limit + 1) as QuestionRow[];
    const questions = rows.slice(0, limit).map((row) => this.toQuestion(row, false));
    const last = questions[questions.length - 1];
    return { questions, next: rows.length > limit && last ? questionCursor(last) : null };
  }

  /** One question with every revision of its answer, oldest first: what an answerer reads before writing the next. */
  question(taskId: string): (Question & { answers: QuestionAnswer[] }) | null {
    const row = this.db.prepare(`${QUESTION_ROWS} WHERE q.task_id = ?`).get(taskId) as QuestionRow | undefined;
    if (!row) return null;
    const question = this.toQuestion(row, true);
    return { ...question, answers: question.answers ?? [] };
  }

  private toQuestion(row: QuestionRow, all: true): Question & { answers: QuestionAnswer[] };
  private toQuestion(row: QuestionRow, all: false): Question;
  private toQuestion(row: QuestionRow, all: boolean): Question & { answers?: QuestionAnswer[] } {
    const owners = (this.db.prepare("SELECT actor_id, accepted FROM task_owners WHERE task_id = ? ORDER BY actor_id").all(row.task_id) as
      Array<{ actor_id: string; accepted: number }>).map((owner) => ({ id: owner.actor_id, accepted: owner.accepted === 1 }));
    const answers = (this.db.prepare(
      `SELECT revision, author, body, refs_json, created_at FROM question_answers WHERE task_id = ? ORDER BY revision ${all ? "ASC" : "DESC LIMIT 1"}`,
    ).all(row.task_id) as Array<{ revision: number; author: string; body: string; refs_json: string; created_at: string }>)
      .map((answer) => ({ revision: answer.revision, by: answer.author, at: answer.created_at, body: answer.body, refs: JSON.parse(answer.refs_json) as AnswerRef[] }));
    const question: Question = {
      id: row.task_id,
      project: row.project_id,
      space: row.space,
      text: row.text,
      askedBy: row.asked_by,
      askedAt: row.asked_at,
      card: { status: row.status, owners, updatedAt: row.updated_at },
      answer: (all ? answers[answers.length - 1] : answers[0]) ?? null,
    };
    return all ? { ...question, answers } : question;
  }
}

type QuestionRow = {
  task_id: string; space: string; asked_by: string; text: string; asked_at: string;
  project_id: string; status: Status; updated_at: string;
};

const QUESTION_ROWS = `SELECT q.task_id, q.space, q.asked_by, q.text, q.asked_at, t.project_id, t.status, t.updated_at
  FROM questions q JOIN tasks t ON t.id = q.task_id`;

type RoundRow = {
  task_id: string; project_id: string; space: string; entry: string; mode: string; candidate: string; baseline: string | null;
  checklist_json: string; created_by: string; created_at: string; title: string; status: Status;
};

const ROUND_ROWS = `SELECT r.task_id, r.project_id, r.space, r.entry, r.mode, r.candidate, r.baseline, r.checklist_json, r.created_by, r.created_at, t.title, t.status
  FROM review_rounds r JOIN tasks t ON t.id = r.task_id`;
