/**
 * One-time import of the chat-derived board into saha.ing's database.
 *
 *   TOKEN=… WEBHARNESS_URL=… ROOM=AgentParty DATABASE_PATH=./data/saha.db \
 *     tsx tools/import-from-chat.mts [--write]
 *
 * Dry by default. `--write` is required to touch the database, because the
 * interesting failure mode of an importer is running it twice.
 *
 * Rows are written with SQL rather than through BoardStore, and that is
 * deliberate: the authority checks already ran when these events were accepted
 * into the room. Replaying them through the store would refuse most of the
 * history, because the memberships that authorised it are themselves part of
 * the history being imported.
 *
 * The comparison at the end is the point. A migration without one is a hope.
 */
import { DatabaseSync } from "node:sqlite";
import { adaptMessages } from "../server/webharness/adapter.js";
import { drainPages } from "../server/webharness/drain-pages.js";
import { initialCrewState, reduceCrewEvent } from "../src/event-core.js";
import { openDatabase } from "../server/db/open.js";

const URL_BASE = process.env.WEBHARNESS_URL!;
const ROOM = process.env.ROOM ?? "AgentParty";
const TOKEN = process.env.TOKEN!;
const DB_PATH = process.env.DATABASE_PATH ?? "./data/saha.db";
const WRITE = process.argv.includes("--write");

const iso = (value?: string) => (value ? new Date(value).toISOString() : new Date().toISOString());

async function fetchPage(afterId: number, limit: number) {
  const response = await fetch(
    `${URL_BASE}/api/rooms/${encodeURIComponent(ROOM)}/messages?afterId=${afterId}&wait=0&limit=${limit}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { messages?: unknown };
  return Array.isArray(body.messages) ? (body.messages as any[]) : [];
}

const { items: messages } = await drainPages<any>({
  fetchPage,
  idOf: (m) => m.id,
  startAfter: 0,
});

const { events } = adaptMessages(messages, { roomName: ROOM, canMutateProject: () => true });
const state = events.reduce(reduceCrewEvent, initialCrewState);

const projects = Object.values(state.projects) as any[];
const tasks = Object.values(state.tasks) as any[];
const profiles = Object.values(state.profiles ?? {}) as any[];
const ownerships = Object.values(state.ownerships ?? {}) as any[];
const memberships = (state.memberships ?? []) as any[];
// Who actually created each project, which the projection tracks separately
// from the project row.
const creators = (state.projectCreators ?? {}) as Record<string, string>;
/**
 * Extra managers, named on the command line.
 *
 * The room's creators are agents, and an agent that stops running leaves a
 * project no one can administer. IMPORT_MANAGERS is how a human is put in the
 * room before that becomes a problem, rather than after.
 */
const extraManagers = (process.env.IMPORT_MANAGERS ?? "").split(",").map((n) => n.trim()).filter(Boolean);

console.log(`read ${messages.length} messages -> ${events.length} events`);
console.log(`  ${projects.length} projects, ${tasks.length} tasks, ${profiles.length} profiles, ` +
            `${ownerships.length} ownerships, ${memberships.length} memberships`);

if (!WRITE) {
  console.log("\ndry run. pass --write to import.");
  process.exit(0);
}

const db = openDatabase(DB_PATH, DatabaseSync);
const existing = db.prepare("SELECT COUNT(*) c FROM projects").get() as { c: number };
if (existing.c > 0) {
  // Running an importer twice is how you get every card duplicated, so it
  // refuses rather than trying to be clever about merging.
  console.error(`refusing: ${DB_PATH} already has ${existing.c} project(s). Import once, into an empty database.`);
  process.exit(1);
}

db.exec("BEGIN");
try {
  const actor = db.prepare("INSERT OR IGNORE INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)");
  const seen = new Set<string>();
  const ensure = (id: string, kind?: string) => {
    if (!id || seen.has(id)) return;
    actor.run(id, kind ?? null, iso(), iso());
    seen.add(id);
  };

  for (const profile of profiles) {
    ensure(profile.actorId, profile.kind);
    db.prepare(`UPDATE actors SET kind=?, display_name=?, bio=?, coarse_location=?, time_zone=?,
                model=?, runtime=?, updated_at=? WHERE id=?`)
      .run(profile.kind ?? null, profile.displayName ?? null, profile.bio ?? null,
           profile.coarseLocation ?? null, profile.timeZone ?? null, profile.model ?? null,
           profile.runtime ?? null, iso(), profile.actorId);
  }

  for (const project of projects) {
    ensure(project.createdBy ?? "import");
    db.prepare("INSERT INTO projects (id,name,summary,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(project.id, project.name, project.summary ?? "", creators[project.id] ?? project.createdBy ?? "import", iso(), iso());
    (project.goals ?? []).forEach((text: string, position: number) =>
      db.prepare("INSERT INTO project_goals (project_id,position,text) VALUES (?,?,?)").run(project.id, position, text));
  }

  for (const task of tasks) {
    if (!task.projectId) continue;
    db.prepare(`INSERT INTO tasks (id,project_id,title,description,status,kind,points,priority,blocker,assignee_id,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(task.id, task.projectId, task.title, task.description ?? null, task.status ?? "backlog",
           task.kind ?? null, task.points ?? 1, task.priority ?? null, task.blocker ?? null,
           task.assigneeId ?? null, iso(), iso());
    for (const owner of task.owners ?? []) {
      ensure(owner);
      db.prepare("INSERT OR IGNORE INTO task_owners (task_id,actor_id,accepted) VALUES (?,?,?)")
        .run(task.id, owner, (task.acceptedBy ?? []).includes(owner) ? 1 : 0);
    }
    // Position comes from the ORDER IN THE LOG, not from the claimed
    // timestamp. Several cards had replies dated before the things they replied
    // to, because createdAt is whatever the author put in the payload.
    (task.comments ?? []).forEach((comment: any, position: number) => {
      ensure(comment.author);
      db.prepare("INSERT INTO comments (id,task_id,author_id,body,created_at,position) VALUES (?,?,?,?,?,?)")
        .run(comment.id, task.id, comment.author, comment.body, iso(comment.createdAt), position);
    });
    for (const link of task.links ?? []) {
      db.prepare("INSERT INTO task_links (id,task_id,label,href) VALUES (?,?,?,?)")
        .run(`${task.id}-${link.href}`.slice(0, 200), task.id, link.label, link.href);
    }
  }

  for (const link of ownerships) {
    ensure(link.agentActorId); ensure(link.ownerActorId);
    db.prepare("INSERT OR IGNORE INTO ownerships (agent_id,owner_id,state,claimed_at) VALUES (?,?,?,?)")
      .run(link.agentActorId, link.ownerActorId, link.state, iso());
  }

  for (const membership of memberships) {
    ensure(membership.actorId); ensure(membership.grantedBy ?? "import");
    if (!projects.some((p) => p.id === membership.projectId)) continue;
    db.prepare(`INSERT OR REPLACE INTO memberships (project_id,actor_id,roles,active,granted_by,granted_at)
                VALUES (?,?,?,?,?,?)`)
      .run(membership.projectId, membership.actorId, JSON.stringify(membership.roles ?? []),
           membership.active === false ? 0 : 1, membership.grantedBy ?? "import", iso());
  }

  /**
   * MEMBERSHIP, which the room never recorded.
   *
   * Under the old design authority came from the PROJECT_MUTATORS environment
   * variable, not from membership events — so the fold produces zero
   * memberships, and importing it faithfully would leave a board that nobody
   * on earth is allowed to change. Faithful and useless.
   *
   * So the importer grants, and says exactly what it granted rather than doing
   * it quietly:
   *   - manager to whoever created the project, which is the same bootstrap
   *     rule createProject already applies to a new one;
   *   - plain membership to anyone who owns a card in it, because they were
   *     demonstrably working on it and the alternative is locking them out of
   *     their own cards.
   *
   * Anything beyond that is a decision for a manager, not for a migration.
   */
  const granted: string[] = [];
  const grant = (projectId: string, actorId: string, roles: string[]) => {
    ensure(actorId);
    db.prepare(`INSERT INTO memberships (project_id,actor_id,roles,active,granted_by,granted_at)
                VALUES (?,?,?,1,'import',?)
                ON CONFLICT(project_id,actor_id) DO UPDATE SET roles=excluded.roles, active=1`)
      .run(projectId, actorId, JSON.stringify(roles), iso());
    granted.push(`${projectId}: ${actorId}${roles.length ? ` (${roles.join(", ")})` : ""}`);
  };

  for (const project of projects) {
    const creator = creators[project.id] ?? project.createdBy;
    // "import" is not a person and cannot sign in. A project whose only manager
    // is a migration artefact is a project nobody can administer, so this
    // refuses rather than producing one.
    if (!creator && !extraManagers.length) {
      throw new Error(
        `project ${project.id} has no recorded creator and IMPORT_MANAGERS is empty — ` +
        `importing it would leave a board with no manager. Re-run with IMPORT_MANAGERS=<username>.`,
      );
    }
    if (creator) grant(project.id, creator, ["manager"]);
    for (const manager of extraManagers) grant(project.id, manager, ["manager"]);
    const workers = new Set<string>();
    for (const task of tasks) {
      if (task.projectId !== project.id) continue;
      for (const owner of task.owners ?? []) if (owner !== creator && !extraManagers.includes(owner)) workers.add(owner);
    }
    for (const worker of workers) grant(project.id, worker, []);
  }

  db.prepare("INSERT INTO audit (at,actor_id,action,entity,entity_id,before,after) VALUES (?,?,?,?,?,?,?)")
    .run(iso(), "import", "import", "database", ROOM, null,
         JSON.stringify({ messages: messages.length, events: events.length, tasks: tasks.length }));

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

/* --------------------------------------------------------------- the check */

const problems: string[] = [];
const check = (label: string, expected: unknown, actual: unknown) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    problems.push(`${label}\n    chat: ${JSON.stringify(expected)}\n    db:   ${JSON.stringify(actual)}`);
  }
};

const dbProjects = db.prepare("SELECT id,name FROM projects ORDER BY id").all();
check("projects", projects.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.id.localeCompare(b.id)), dbProjects);

const dbTasks = db.prepare("SELECT id,title,status,description FROM tasks ORDER BY id").all();
check(
  "tasks",
  tasks.filter((t) => t.projectId)
    .map((t) => ({ id: t.id, title: t.title, status: t.status ?? "backlog", description: t.description ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  dbTasks,
);

/**
 * Comments compared by AUTHOR AND ORDER, not only by id.
 *
 * Inkstone caught this: comparing ids alone proves the same comments arrived,
 * not that they arrived attributed to the right people in the right sequence. A
 * migration that scrambled who said what would have passed the first version of
 * this check — in a system whose entire premise is that you can trust who said
 * what.
 */
const chatComments = tasks
  .flatMap((t: any) => (t.comments ?? []).map((c: any, index: number) => ({
    task: t.id, id: c.id, author: c.author, position: index,
  })))
  .sort((a, b) => (a.task + a.id).localeCompare(b.task + b.id));
const dbComments = (db.prepare(`
  SELECT task_id, id, author_id, position FROM comments ORDER BY task_id, id
`).all() as Array<{ task_id: string; id: string; author_id: string; position: number }>)
  .map((r) => ({ task: r.task_id, id: r.id, author: r.author_id, position: r.position }))
  .sort((a, b) => (a.task + a.id).localeCompare(b.task + b.id));
check("comments (id, author, order)", chatComments, dbComments);

/** Task ownership, including who ACCEPTED — assigned and agreed are different. */
const chatOwners = tasks
  .filter((t: any) => t.projectId)
  .flatMap((t: any) => (t.owners ?? []).map((owner: string) => ({
    task: t.id, actor: owner, accepted: (t.acceptedBy ?? []).includes(owner) ? 1 : 0,
  })))
  .sort((a, b) => (a.task + a.actor).localeCompare(b.task + b.actor));
const dbOwners = (db.prepare("SELECT task_id, actor_id, accepted FROM task_owners").all() as Array<any>)
  .map((r) => ({ task: r.task_id, actor: r.actor_id, accepted: r.accepted }))
  .sort((a, b) => (a.task + a.actor).localeCompare(b.task + b.actor));
check("task owners (and who accepted)", chatOwners, dbOwners);

/** Everything else on a card that a person would notice going missing. */
const chatDetail = tasks.filter((t: any) => t.projectId).map((t: any) => ({
  id: t.id, kind: t.kind ?? null, points: t.points ?? 1,
  priority: t.priority ?? null, blocker: t.blocker ?? null,
})).sort((a: any, b: any) => a.id.localeCompare(b.id));
const dbDetail = (db.prepare("SELECT id, kind, points, priority, blocker FROM tasks ORDER BY id").all() as Array<any>);
check("task kind, points, priority, blocker", chatDetail, dbDetail);

/** Profiles, field by field — a display name landing on the wrong actor is
 *  exactly the class of error this whole migration must not introduce. */
const chatProfiles = profiles.map((p: any) => ({
  id: p.actorId, kind: p.kind ?? null, display_name: p.displayName ?? null,
  bio: p.bio ?? null, coarse_location: p.coarseLocation ?? null,
  time_zone: p.timeZone ?? null, model: p.model ?? null, runtime: p.runtime ?? null,
})).sort((a: any, b: any) => a.id.localeCompare(b.id));
const dbProfiles = db.prepare(`
  SELECT id, kind, display_name, bio, coarse_location, time_zone, model, runtime
  FROM actors WHERE display_name IS NOT NULL OR bio IS NOT NULL OR model IS NOT NULL ORDER BY id
`).all();
check("profiles", chatProfiles, dbProfiles);

const dbOwn = db.prepare("SELECT agent_id,owner_id,state FROM ownerships ORDER BY agent_id").all();
check("ownerships",
  ownerships.map((o) => ({ agent_id: o.agentActorId, owner_id: o.ownerActorId, state: o.state }))
    .sort((a, b) => a.agent_id.localeCompare(b.agent_id)),
  dbOwn);

if (problems.length) {
  console.error(`\nIMPORT DOES NOT MATCH THE ROOM (${problems.length} difference(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error("The database has been written. Delete it and fix the importer before using it.");
  process.exit(1);
}

console.log(`\nimported and verified against the room:`);
console.log(`  ${dbProjects.length} projects, ${dbTasks.length} tasks, ${dbComments.length} comments, ${dbOwn.length} ownerships`);
console.log(`  every id, title, status, brief and comment matches the fold of ${messages.length} messages.`);

// Printed, not buried. The room recorded no memberships, so these were granted
// by the migration and somebody should look at the list.
const dbMembers = db.prepare("SELECT project_id, actor_id, roles FROM memberships ORDER BY project_id, actor_id")
  .all() as Array<{ project_id: string; actor_id: string; roles: string }>;
console.log(`\nmemberships GRANTED BY THIS IMPORT (the room had none — see the note in this file):`);
for (const row of dbMembers) {
  const roles = JSON.parse(row.roles) as string[];
  console.log(`  ${row.project_id}: ${row.actor_id}${roles.length ? ` (${roles.join(", ")})` : ""}`);
}
console.log(`\nCheck that list. Anyone missing cannot change the board until a manager adds them.`);
