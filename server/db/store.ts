import { createHash, randomUUID } from "node:crypto";
import {
  FORBIDDEN_PROFILE_KEYS,
  canTransition,
  hasProjectAuthority,
  isRole,
  isStatus,
  type Role,
  type Status,
} from "../../shared/board-rules.js";

type Db = import("node:sqlite").DatabaseSync;

/**
 * Every write to the board, and the rules that guard them.
 *
 * ONE PLACE. The reducer's real value was not event sourcing — it was that
 * there was exactly one function that could change state, so a rule written
 * once could not be bypassed by a second code path. That property is worth
 * keeping, so nothing outside this file writes to these tables.
 *
 * Every mutation records who did it in `audit`, in the SAME transaction as the
 * change. An audit row written separately can be missing for the change that
 * most needs explaining — the one that failed halfway.
 */

export class Refused extends Error {
  constructor(message: string, readonly code = "REFUSED") {
    super(message);
    this.name = "Refused";
  }
}

const now = () => new Date().toISOString();

/**
 * Generous bounds on free text.
 *
 * The 2000-character cap was the chat transport's, and removing it was the
 * point of ADR-002 — but "the transport limit is gone" is not "there is no
 * limit". Unbounded TEXT is a storage and context denial-of-service: one client
 * bug writes a 500MB brief, and every reader of that board then pays for it.
 *
 * Chosen to be far above any honest use. A brief is a brief; if 100,000
 * characters is not enough, the thing being written is a document and belongs
 * behind a link.
 */
export const LIMITS = { description: 100_000, comment: 50_000, title: 500 } as const;

const bounded = (value: string, max: number, what: string) => {
  if (value.length > max) {
    throw new Refused(
      `that ${what} is ${value.length.toLocaleString()} characters; the limit is ${max.toLocaleString()}`,
      "TOO_LONG",
    );
  }
  return value;
};

export type Actor = { id: string; kind?: "human" | "agent" | null };

export class BoardStore {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------- helpers

  /**
   * What was asked, alongside what changed.
   *
   * `before`/`after` is a diff of state. `request` is the intent — the exact
   * thing the caller asked for. They are not the same evidence: a diff shows a
   * card moved to done, the request shows who asked for that and in what terms.
   *
   * This is also the field a signature would attach to. An agent's board change
   * used to be signed at source with its Ed25519 key, so not even we could
   * forge one; moving writes to an API gives that up. We cannot verify a
   * signature today — that needs the agent's PUBLIC key, and WebHarness exposes
   * none (/api/me returns id, username, kind, ownerName; /api/profile and four
   * other guesses are 404) — and humans have no keys at all.
   *
   * So the envelope is recorded now and the signature columns stay empty. They
   * are a seam, not a claim. Nothing verifies them, and anything that begins to
   * must say so somewhere a reader will find it.
   */
  private request?: unknown;

  /** Set by the API layer for the duration of one call. */
  withRequest<T>(request: unknown, work: () => T): T {
    const previous = this.request;
    this.request = request;
    try {
      return work();
    } finally {
      this.request = previous;
    }
  }

  private audit(actorId: string, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
    const request = this.request === undefined ? null : canonical(this.request);
    this.db
      .prepare(`INSERT INTO audit (at, actor_id, action, entity, entity_id, before, after,
                                   request, request_hash, canonicalization, attested_by, verification)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(now(), actorId, action, entity, entityId,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
        request,
        request === null ? null : createHash("sha256").update(request).digest("hex"),
        request === null ? null : CANONICALIZATION,
        // Who is vouching for this. Us — which is exactly the point of the
        // word: the claim is the server's, not the actor's.
        request === null ? null : "saha.ing",
        "server-attested");
  }

  /**
   * Run `work` in a transaction, so a refused rule leaves no half-written card.
   *
   * The rollback erases the attempt, and that is right — an audit row for a
   * change that did not happen would be a lie about the board. But it also
   * erased the fact that somebody TRIED and was refused, and that is a security
   * signal: repeated denials are how you notice probing, or a permission that
   * has broken. Making them leave nothing inverts the discipline this project
   * is built on.
   *
   * So a refusal is recorded AFTER the rollback, in its own table, on its own
   * connection-level statement that no transaction is holding.
   */
  private tx<T>(work: () => T, context?: { actorId: string; action: string; target?: string }): T {
    this.db.exec("BEGIN");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (context && error instanceof Refused) this.denied(context, error);
      throw error;
    }
  }

  /**
   * Record a refusal. Never inside a transaction — the whole point is that it
   * survives the one that was just rolled back.
   *
   * MINIMAL METADATA, GUARANTEED STRUCTURALLY. The denial log exists to watch
   * for probing, and the tempting thing to store is the rejected payload. That
   * would put the very content we refused — a hostname, a token, a credential —
   * into the table we added to catch people sending it. Today no refusal
   * message happens to quote its input, but that is a property of how I worded
   * them, not a guarantee, and the next person to write a helpful error would
   * undo it without noticing.
   *
   * So `reason` is NOT the refusal message. It is a fixed sentence chosen from
   * the refusal CODE, which cannot carry a payload because it never touches
   * one.
   */
  private denied(context: { actorId: string; action: string; target?: string }, refusal: Refused): void {
    try {
      this.db.prepare("INSERT INTO security_audit (at, actor_id, action, target, code, reason) VALUES (?,?,?,?,?,?)")
        .run(now(), context.actorId, context.action, context.target ?? null, refusal.code, reasonFor(refusal.code));
    } catch (error) {
      // Failing to record a denial must not turn a clean refusal into a 500 —
      // the caller is still correctly refused. But silent is not acceptable
      // either: a denial log that has quietly stopped recording is worse than
      // none, because it reads as "nobody has tried anything".
      this.onDenialWriteFailure?.(error, context, refusal.code);
    }
  }

  /** Set by the server so a lost denial reaches the log rather than nowhere. */
  onDenialWriteFailure?: (error: unknown, context: { actorId: string; action: string }, code: string) => void;

  /** Refusals raised before the transaction opens still deserve recording. */
  private guard<T>(context: { actorId: string; action: string; target?: string }, work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof Refused) this.denied(context, error);
      throw error;
    }
  }

  /** Record that we have seen someone, without claiming anything about them. */
  ensureActor(id: string, kind?: "human" | "agent"): void {
    const existing = this.db.prepare("SELECT id, kind FROM actors WHERE id = ?").get(id) as
      | { id: string; kind: string | null }
      | undefined;
    if (!existing) {
      this.db
        .prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
        .run(id, kind ?? null, now(), now());
      return;
    }
    // Fill in a kind we did not know; never overwrite one that was declared.
    if (kind && !existing.kind) {
      this.db.prepare("UPDATE actors SET kind = ?, updated_at = ? WHERE id = ?").run(kind, now(), id);
    }
  }

  private memberships(): Array<{ projectId: string; actorId: string; active: boolean }> {
    return (this.db.prepare("SELECT project_id, actor_id, active FROM memberships").all() as Array<{
      project_id: string; actor_id: string; active: number;
    }>).map((r) => ({ projectId: r.project_id, actorId: r.actor_id, active: r.active === 1 }));
  }

  /**
   * May this actor change this project?
   *
   * Membership only. Deliberately does not look at ownership, task assignment,
   * or who created the card being edited — each of those has been proposed at
   * some point and each would make "operating an agent grants authority" true
   * by a side door.
   */
  private assertAuthority(actorId: string, projectId: string): void {
    if (!hasProjectAuthority(this.memberships(), projectId, actorId)) {
      throw new Refused(
        `${actorId} is not a member of ${projectId}; treat this as a request pending a manager`,
        "PROJECT_PERMISSION_REQUIRED",
      );
    }
  }

  private taskRow(id: string) {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Refused(`no task ${id}`, "NOT_FOUND");
    return row;
  }

  // ---------------------------------------------------------------- projects

  createProject(actor: Actor, input: { id?: string; name: string; summary?: string; goals?: string[] }) {
    const id = (input.id ?? slug(input.name)).trim();
    if (!id) throw new Refused("project id is required");
    if (!input.name.trim()) throw new Refused("project name is required");

    return this.tx(() => {
      this.ensureActor(actor.id, actor.kind ?? undefined);
      const exists = this.db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
      if (exists) throw new Refused(`project ${id} already exists`, "CONFLICT");

      this.db.prepare("INSERT INTO projects (id,name,summary,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run(id, input.name.trim(), (input.summary ?? "").trim(), actor.id, now(), now());
      (input.goals ?? []).forEach((text, position) => {
        this.db.prepare("INSERT INTO project_goals (project_id, position, text) VALUES (?,?,?)")
          .run(id, position, text);
      });
      // THE BOOTSTRAP. Someone has to be able to act on a brand new project, and
      // the only defensible someone is whoever created it. Without this, a new
      // project is unusable until a manager who is not yet a member adds one.
      this.db.prepare("INSERT INTO memberships (project_id,actor_id,roles,active,granted_by,granted_at) VALUES (?,?,?,1,?,?)")
        .run(id, actor.id, JSON.stringify(["manager"]), actor.id, now());
      this.audit(actor.id, "create", "project", id, undefined, { name: input.name });
      return id;
    }, { actorId: actor.id, action: "create project", target: id });
  }

  // ------------------------------------------------------------------- tasks

  createTask(actor: Actor, input: {
    projectId: string; title: string; description?: string;
    kind?: "build" | "decision"; points?: number; priority?: number; owners?: string[];
  }) {
    if (!input.title.trim()) throw new Refused("a card needs a title");
    bounded(input.title.trim(), LIMITS.title, "title");
    if (input.description) bounded(input.description.trim(), LIMITS.description, "brief");
    return this.tx(() => {
      this.ensureActor(actor.id, actor.kind ?? undefined);
      this.assertAuthority(actor.id, input.projectId);
      const id = `${input.projectId}-${randomUUID().slice(0, 8)}`;
      this.db.prepare(`INSERT INTO tasks (id,project_id,title,description,kind,points,priority,status,created_at,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.projectId, input.title.trim(), input.description?.trim() || null,
             input.kind ?? null, input.points ?? 1, input.priority ?? null,
             (input.owners?.length ? "assigned" : "backlog"), now(), now());
      for (const owner of input.owners ?? []) {
        this.ensureActor(owner);
        this.db.prepare("INSERT INTO task_owners (task_id,actor_id,accepted) VALUES (?,?,0)").run(id, owner);
      }
      this.audit(actor.id, "create", "task", id, undefined, { title: input.title });
      return id;
    }, { actorId: actor.id, action: "create task", target: input.projectId });
  }

  /**
   * Change fields on a card. Status is NOT changeable here — it has its own
   * method with its own rule, so nobody can slide an illegal move through a
   * general-purpose update.
   */
  updateTask(actor: Actor, id: string, patch: {
    title?: string; description?: string | null; kind?: "build" | "decision" | null;
    points?: number; priority?: number | null;
  }) {
    return this.tx(() => {
      const before = this.taskRow(id);
      this.assertAuthority(actor.id, before.project_id as string);

      const sets: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };

      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new Refused("a card needs a title");
        set("title", bounded(patch.title.trim(), LIMITS.title, "title"));
      }
      // null means "cleared", undefined means "not mentioned". They are
      // different instructions and collapsing them loses a brief someone wrote.
      if (patch.description !== undefined) {
        set("description", patch.description?.trim() ? bounded(patch.description.trim(), LIMITS.description, "brief") : null);
      }
      if (patch.kind !== undefined) set("kind", patch.kind);
      if (patch.points !== undefined) set("points", patch.points);
      if (patch.priority !== undefined) set("priority", patch.priority);
      if (!sets.length) return;

      set("updated_at", now());
      values.push(id);
      this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values as never[]);
      this.audit(actor.id, "update", "task", id, before, this.taskRow(id));
    }, { actorId: actor.id, action: "update task", target: id });
  }

  transitionTask(actor: Actor, id: string, to: Status, blocker?: string) {
    if (!isStatus(to)) throw new Refused(`${to} is not a status`);
    return this.tx(() => {
      const before = this.taskRow(id);
      this.assertAuthority(actor.id, before.project_id as string);
      const from = before.status as Status;
      if (from === to) return;
      if (!canTransition(from, to)) {
        throw new Refused(`${from} → ${to} is not a legal move`, "ILLEGAL_TRANSITION");
      }
      this.db.prepare("UPDATE tasks SET status = ?, blocker = ?, updated_at = ? WHERE id = ?")
        .run(to, to === "blocked" ? (blocker ?? null) : null, now(), id);
      this.audit(actor.id, "transition", "task", id, { status: from }, { status: to });
    }, { actorId: actor.id, action: "transition task", target: id });
  }

  setOwnership(actor: Actor, id: string, action: "claim" | "accept" | "release") {
    return this.tx(() => {
      const task = this.taskRow(id);
      this.assertAuthority(actor.id, task.project_id as string);
      this.ensureActor(actor.id, actor.kind ?? undefined);

      if (action === "claim") {
        this.db.prepare("INSERT OR IGNORE INTO task_owners (task_id,actor_id,accepted) VALUES (?,?,0)").run(id, actor.id);
        if (task.status === "backlog") {
          this.db.prepare("UPDATE tasks SET status='assigned', updated_at=? WHERE id=?").run(now(), id);
        }
      } else if (action === "accept") {
        const owns = this.db.prepare("SELECT 1 FROM task_owners WHERE task_id=? AND actor_id=?").get(id, actor.id);
        // Accepting a card nobody gave you is not a thing; the refusal says so
        // rather than silently creating the ownership it implies.
        if (!owns) throw new Refused("you can only accept a card you own", "NOT_AN_OWNER");
        this.db.prepare("UPDATE task_owners SET accepted=1 WHERE task_id=? AND actor_id=?").run(id, actor.id);
      } else {
        this.db.prepare("DELETE FROM task_owners WHERE task_id=? AND actor_id=?").run(id, actor.id);
      }
      this.db.prepare("UPDATE tasks SET assignee_id = (SELECT actor_id FROM task_owners WHERE task_id=? LIMIT 1) WHERE id=?")
        .run(id, id);
      this.audit(actor.id, action, "task", id, undefined, undefined);
    }, { actorId: actor.id, action: `${action} task`, target: id });
  }

  addComment(actor: Actor, taskId: string, body: string) {
    if (!body.trim()) throw new Refused("an empty comment is not a comment");
    return this.tx(() => {
      const task = this.taskRow(taskId);
      this.assertAuthority(actor.id, task.project_id as string);
      this.ensureActor(actor.id, actor.kind ?? undefined);
      const id = randomUUID();
      // Position, not timestamp. Ordering a discussion by an author-supplied
      // time put replies before what they replied to; the server assigns the
      // order things actually arrived in.
      const position = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM comments WHERE task_id = ?")
        .get(taskId) as { next: number }).next;
      this.db.prepare("INSERT INTO comments (id,task_id,author_id,body,created_at,position) VALUES (?,?,?,?,?,?)")
        .run(id, taskId, actor.id, bounded(body.trim(), LIMITS.comment, "comment"), now(), position);
      this.audit(actor.id, "comment", "task", taskId, undefined, { commentId: id });
      return id;
    }, { actorId: actor.id, action: "comment", target: taskId });
  }

  // ------------------------------------------------------------------ people

  upsertProfile(actor: Actor, profile: Record<string, unknown>) {
    return this.guard({ actorId: actor.id, action: "update profile", target: actor.id }, () =>
      this.upsertProfileChecked(actor, profile));
  }

  private upsertProfileChecked(actor: Actor, profile: Record<string, unknown>) {
    // A profile is a statement about yourself. The acting identity is the
    // authenticated caller, never a field in the body — that was a real
    // impersonation hole once.
    for (const key of Object.keys(profile)) {
      if ((FORBIDDEN_PROFILE_KEYS as readonly string[]).includes(key)) {
        throw new Refused(`${key} may never be stored on a profile`, "FORBIDDEN_FIELD");
      }
    }
    const text = (value: unknown, max: number) => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string") throw new Refused("profile fields must be text");
      const trimmed = value.trim();
      if (trimmed.length > max) throw new Refused(`profile field exceeds ${max} characters`);
      return trimmed || null;
    };
    const kind = profile.kind === "human" || profile.kind === "agent" ? profile.kind : (actor.kind ?? null);
    if (kind === "human" && (profile.model || profile.runtime)) {
      throw new Refused("model and runtime describe an agent runtime, not a person");
    }

    return this.tx(() => {
      this.ensureActor(actor.id, actor.kind ?? undefined);
      const before = this.db.prepare("SELECT * FROM actors WHERE id=?").get(actor.id);
      this.db.prepare(`UPDATE actors SET kind=?, display_name=?, bio=?, coarse_location=?, time_zone=?,
                       model=?, runtime=?, updated_at=? WHERE id=?`)
        .run(kind, text(profile.displayName, 120), text(profile.bio, 600), text(profile.coarseLocation, 120),
             text(profile.timeZone, 120), text(profile.model, 120), text(profile.runtime, 120), now(), actor.id);
      this.audit(actor.id, "update", "profile", actor.id, before, this.db.prepare("SELECT * FROM actors WHERE id=?").get(actor.id));
    });
  }

  actOnOwnership(actor: Actor, agentId: string, ownerId: string, action: "declare" | "confirm" | "revoke") {
    return this.tx(() => {
      this.ensureActor(agentId);
      this.ensureActor(ownerId);
      const existing = this.db.prepare("SELECT * FROM ownerships WHERE agent_id=? AND owner_id=?")
        .get(agentId, ownerId) as Record<string, unknown> | undefined;

      if (action === "declare") {
        if (actor.id !== ownerId) throw new Refused("you may only claim an agent as your own", "NOT_YOURS");
        // A claim is a REQUEST. Anyone can say an agent is theirs; only the
        // agent saying so makes it true.
        this.db.prepare(`INSERT INTO ownerships (agent_id,owner_id,state,claimed_at) VALUES (?,?,'pending',?)
                         ON CONFLICT(agent_id,owner_id) DO UPDATE SET state='pending', claimed_at=excluded.claimed_at`)
          .run(agentId, ownerId, now());
      } else if (action === "confirm") {
        if (actor.id !== agentId) throw new Refused("only the agent can confirm who operates it", "NOT_THE_AGENT");
        if (!existing) throw new Refused("there is no claim to confirm", "NOT_FOUND");
        this.db.prepare("UPDATE ownerships SET state='verified', settled_at=? WHERE agent_id=? AND owner_id=?")
          .run(now(), agentId, ownerId);
      } else {
        // Either side may end it; neither may end it on the other's behalf.
        if (actor.id !== agentId && actor.id !== ownerId) throw new Refused("not your link to end", "NOT_YOURS");
        if (!existing) throw new Refused("there is no link to end", "NOT_FOUND");
        this.db.prepare("UPDATE ownerships SET state='revoked', settled_at=? WHERE agent_id=? AND owner_id=?")
          .run(now(), agentId, ownerId);
      }
      this.audit(actor.id, action, "ownership", `${agentId}:${ownerId}`, existing, undefined);
    }, { actorId: actor.id, action: `${action} ownership`, target: `${agentId}:${ownerId}` });
  }

  actOnMembership(actor: Actor, projectId: string, actorId: string, action: "grant" | "revoke", roles: Role[] = []) {
    const clean = roles.filter(isRole);
    return this.tx(() => {
      // "Never had a member" and "has no member RIGHT NOW" are different, and
      // conflating them was a privilege escalation: revoking the last manager
      // dropped the active count to zero, which re-opened the bootstrap and let
      // ANY signed-in actor grant themselves manager on that project.
      //
      // So the bootstrap looks at whether a membership row has ever existed,
      // active or revoked. A revoked membership is still evidence that this
      // project has been administered by somebody, and the way back in is that
      // person or another manager — never a stranger.
      const everGranted = (this.db.prepare("SELECT COUNT(*) c FROM memberships WHERE project_id = ?")
        .get(projectId) as { c: number }).c;
      const isManager = (this.db.prepare("SELECT roles FROM memberships WHERE project_id=? AND actor_id=? AND active=1")
        .get(projectId, actor.id) as { roles: string } | undefined);
      const managerRoles: string[] = isManager ? JSON.parse(isManager.roles) : [];
      // A manager may. Nobody else may — not an owner of a member agent, not
      // someone holding a card in the project, and not somebody who arrived
      // after the last manager left.
      if (everGranted > 0 && !managerRoles.includes("manager")) {
        throw new Refused("only a project manager can change who belongs to it", "PROJECT_PERMISSION_REQUIRED");
      }
      this.ensureActor(actorId);
      if (action === "grant") {
        this.db.prepare(`INSERT INTO memberships (project_id,actor_id,roles,active,granted_by,granted_at)
                         VALUES (?,?,?,1,?,?)
                         ON CONFLICT(project_id,actor_id) DO UPDATE SET roles=excluded.roles, active=1,
                           granted_by=excluded.granted_by, granted_at=excluded.granted_at`)
          .run(projectId, actorId, JSON.stringify(clean), actor.id, now());
      } else {
        this.db.prepare("UPDATE memberships SET active=0 WHERE project_id=? AND actor_id=?").run(projectId, actorId);
      }
      this.audit(actor.id, action, "membership", `${projectId}:${actorId}`, undefined, { roles: clean });
    }, { actorId: actor.id, action: `${action} membership`, target: `${projectId}:${actorId}` });
  }

  // ------------------------------------------------------------ mood boards

  createBoard(actor: Actor, projectId: string, name: string) {
    if (!name.trim()) throw new Refused("a board needs a name");
    return this.tx(() => {
      this.assertAuthority(actor.id, projectId);
      const id = randomUUID();
      this.db.prepare("INSERT INTO boards (id,project_id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run(id, projectId, name.trim(), actor.id, now(), now());
      this.audit(actor.id, "create", "board", id, undefined, { name });
      return id;
    }, { actorId: actor.id, action: "create board", target: projectId });
  }

  private boardProject(boardId: string): string {
    const row = this.db.prepare("SELECT project_id FROM boards WHERE id = ?").get(boardId) as
      | { project_id: string } | undefined;
    if (!row) throw new Refused("no such board", "NOT_FOUND");
    return row.project_id;
  }

  addBoardItem(actor: Actor, boardId: string, item: {
    kind: "image" | "link" | "note" | "swatch";
    blobId?: string; url?: string; text?: string; caption?: string;
    x?: number; y?: number; w?: number; h?: number;
  }) {
    return this.tx(() => {
      this.assertAuthority(actor.id, this.boardProject(boardId));
      if (item.kind === "image" && !item.blobId) throw new Refused("an image item needs an uploaded file");
      if (item.kind === "link" && !item.url) throw new Refused("a link item needs a url");
      if ((item.kind === "note" || item.kind === "swatch") && !item.text?.trim()) {
        throw new Refused(`a ${item.kind} needs text`);
      }
      // A link that is not http(s) is either a mistake or an attempt at
      // javascript: — neither belongs on a board other people click.
      if (item.url && !/^https?:\/\//i.test(item.url)) {
        throw new Refused("a link must be http or https", "BAD_URL");
      }
      const id = randomUUID();
      // Placed on top by default: a new item you cannot see reads as an upload
      // that failed.
      const top = (this.db.prepare("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM board_items WHERE board_id = ?")
        .get(boardId) as { z: number }).z;
      this.db.prepare(`INSERT INTO board_items (id,board_id,kind,blob_id,url,text,caption,x,y,w,h,z,added_by,added_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, boardId, item.kind, item.blobId ?? null, item.url ?? null, item.text?.trim() ?? null,
             item.caption?.trim() || null, item.x ?? 0, item.y ?? 0, item.w ?? 240, item.h ?? 240,
             top, actor.id, now());
      this.audit(actor.id, "add", "board_item", id, undefined, { boardId, kind: item.kind });
      return id;
    }, { actorId: actor.id, action: "add board item", target: boardId });
  }

  moveBoardItem(actor: Actor, itemId: string, at: { x: number; y: number; w?: number; h?: number; z?: number }) {
    return this.tx(() => {
      const row = this.db.prepare("SELECT board_id FROM board_items WHERE id = ?").get(itemId) as
        | { board_id: string } | undefined;
      if (!row) throw new Refused("no such item", "NOT_FOUND");
      this.assertAuthority(actor.id, this.boardProject(row.board_id));
      // Dragging is not audited. A board is arranged by moving things around
      // dozens of times, and an audit row per drag would bury the changes that
      // actually matter under noise — the same lesson as saha-machine-noise.
      this.db.prepare("UPDATE board_items SET x=?, y=?, w=COALESCE(?,w), h=COALESCE(?,h), z=COALESCE(?,z) WHERE id=?")
        .run(at.x, at.y, at.w ?? null, at.h ?? null, at.z ?? null, itemId);
    });
  }

  removeBoardItem(actor: Actor, itemId: string) {
    return this.tx(() => {
      const row = this.db.prepare("SELECT * FROM board_items WHERE id = ?").get(itemId) as
        | Record<string, unknown> | undefined;
      if (!row) throw new Refused("no such item", "NOT_FOUND");
      this.assertAuthority(actor.id, this.boardProject(row.board_id as string));
      this.db.prepare("DELETE FROM board_items WHERE id = ?").run(itemId);
      // The BLOB is deliberately left alone. Someone else's board may show the
      // same image, and deleting bytes on the strength of one reference is how
      // you lose a file that was still in use.
      this.audit(actor.id, "remove", "board_item", itemId, row, undefined);
    }, { actorId: actor.id, action: "remove board item", target: itemId });
  }
}

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/**
 * How a request is turned into the bytes we hash.
 *
 * Versioned because a hash is only comparable against one made the same way. If
 * this rule ever changes, rows written under the old one must stay checkable
 * rather than silently looking corrupt — so the version travels with the row.
 *
 * v1: JSON with object keys sorted, so two identical requests that happened to
 * serialise their fields in a different order hash the same.
 */
export const CANONICALIZATION = "json-sorted-keys-v1";

function canonical(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, sort(inner)]));
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

/**
 * A fixed sentence per refusal code.
 *
 * The denial log must never contain the thing that was refused. Deriving the
 * text from the CODE rather than the message makes that structural: this
 * function has no access to a payload, so it cannot leak one however the
 * refusal was worded.
 */
function reasonFor(code: string): string {
  const reasons: Record<string, string> = {
    PROJECT_PERMISSION_REQUIRED: "actor is not a member of the project",
    NOT_YOURS: "actor tried to act on someone else's link",
    NOT_THE_AGENT: "only the agent may confirm who operates it",
    NOT_AN_OWNER: "actor does not own the card",
    FORBIDDEN_FIELD: "profile carried a field that may never be stored",
    ILLEGAL_TRANSITION: "status change is not a legal move",
    TOO_LONG: "text exceeded the stored bound",
    TOO_LARGE: "upload exceeded the size bound",
    UNSUPPORTED_TYPE: "file type is not one we store",
    EMPTY_FILE: "upload was empty",
    BAD_URL: "link was not http or https",
    NOT_FOUND: "target does not exist",
    CONFLICT: "target already exists",
  };
  return reasons[code] ?? "refused";
}
