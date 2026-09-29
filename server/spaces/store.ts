import type { DatabaseSync } from "node:sqlite";
import type { DeployRecord } from "../../shared/spaces.js";

/**
 * What saha.ing remembers about spaces (migration 44): that a space exists,
 * every deploy with its result, and which deploy each branch is serving.
 * The source itself is the git repository on disk.
 */

type DeployRow = {
  id: string;
  space: string;
  branch: string;
  commit_sha: string;
  message: string;
  author: string;
  pushed_by: string;
  created_at: string;
  status: "ready" | "failed" | "retired";
  problem: string | null;
  files: number;
  bytes: number;
  spa: number;
};

export type StoredDeploy = Omit<DeployRecord, "status"> & { status: DeployRow["status"]; spa: boolean };

const toDeploy = (row: DeployRow): StoredDeploy => ({
  id: row.id,
  space: row.space,
  branch: row.branch,
  commit: row.commit_sha,
  message: row.message,
  author: row.author,
  pushedBy: row.pushed_by,
  createdAt: row.created_at,
  status: row.status,
  problem: row.problem,
  files: row.files,
  bytes: row.bytes,
  spa: row.spa === 1,
});

export class SpaceStore {
  constructor(private readonly db: DatabaseSync) {}

  exists(name: string): boolean {
    return this.db.prepare("SELECT 1 FROM spaces WHERE name = ?").get(name) !== undefined;
  }

  create(name: string, createdBy: string, at: string): void {
    this.db.prepare("INSERT INTO spaces (name, created_by, created_at) VALUES (?, ?, ?)").run(name, createdBy, at);
  }

  get(name: string): { name: string; createdBy: string; createdAt: string } | null {
    const row = this.db.prepare("SELECT name, created_by, created_at FROM spaces WHERE name = ?").get(name) as
      | { name: string; created_by: string; created_at: string }
      | undefined;
    return row ? { name: row.name, createdBy: row.created_by, createdAt: row.created_at } : null;
  }

  all(): string[] {
    return (this.db.prepare("SELECT name FROM spaces ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  }

  record(deploy: StoredDeploy): void {
    this.db.prepare(
      `INSERT INTO space_deploys (id, space, branch, commit_sha, message, author, pushed_by, created_at, status, problem, files, bytes, spa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(deploy.id, deploy.space, deploy.branch, deploy.commit, deploy.message, deploy.author, deploy.pushedBy, deploy.createdAt,
      deploy.status, deploy.problem, deploy.files, deploy.bytes, deploy.spa ? 1 : 0);
  }

  deploy(id: string): StoredDeploy | null {
    const row = this.db.prepare("SELECT * FROM space_deploys WHERE id = ?").get(id) as DeployRow | undefined;
    return row ? toDeploy(row) : null;
  }

  deploys(space: string, limit = 50): StoredDeploy[] {
    return (this.db.prepare("SELECT * FROM space_deploys WHERE space = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(space, limit) as DeployRow[]).map(toDeploy);
  }

  /** The deploy a branch serves right now, if any. */
  live(space: string, branch: string): StoredDeploy | null {
    const row = this.db.prepare(
      "SELECT d.* FROM space_live l JOIN space_deploys d ON d.id = l.deploy_id WHERE l.space = ? AND l.branch = ?",
    ).get(space, branch) as DeployRow | undefined;
    return row ? toDeploy(row) : null;
  }

  liveBranches(space: string): string[] {
    return (this.db.prepare("SELECT branch FROM space_live WHERE space = ? ORDER BY branch").all(space) as { branch: string }[]).map((row) => row.branch);
  }

  setLive(space: string, branch: string, deployId: string): void {
    this.db.prepare(
      "INSERT INTO space_live (space, branch, deploy_id) VALUES (?, ?, ?) ON CONFLICT(space, branch) DO UPDATE SET deploy_id = excluded.deploy_id",
    ).run(space, branch, deployId);
  }

  clearLive(space: string, branch: string): void {
    this.db.prepare("DELETE FROM space_live WHERE space = ? AND branch = ?").run(space, branch);
  }

  /** Ready deploys of a branch beyond the newest `keep`, never the live one: these lose their files. */
  toRetire(space: string, branch: string, keep: number): StoredDeploy[] {
    const liveId = this.live(space, branch)?.id ?? "";
    return (this.db.prepare(
      "SELECT * FROM space_deploys WHERE space = ? AND branch = ? AND status = 'ready' AND id != ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?",
    ).all(space, branch, liveId, Math.max(0, keep - 1)) as DeployRow[]).map(toDeploy);
  }

  retire(id: string): void {
    this.db.prepare("UPDATE space_deploys SET status = 'retired' WHERE id = ?").run(id);
  }

  // ------------------------------------------------ public rooms (migration 45)

  publicInfo(name: string): { public: boolean; title: string | null } {
    const row = this.db.prepare("SELECT public, title FROM spaces WHERE name = ?").get(name) as { public: number; title: string | null } | undefined;
    return { public: row?.public === 1, title: row?.title ?? null };
  }

  setPublic(name: string, isPublic: boolean, title: string | null): void {
    this.db.prepare("UPDATE spaces SET public = ?, title = ? WHERE name = ?").run(isPublic ? 1 : 0, title, name);
  }

  /** Every published space, for the lobby's doors. Only those with something live. */
  publicSpaces(): { name: string; title: string | null }[] {
    return (this.db.prepare(
      "SELECT s.name, s.title FROM spaces s JOIN space_live l ON l.space = s.name AND l.branch = 'main' WHERE s.public = 1 ORDER BY s.name",
    ).all() as { name: string; title: string | null }[]).map((row) => ({ name: row.name, title: row.title }));
  }

  // ------------------------------------------------ shared state (shared/space-kit.ts)

  state(space: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.db.prepare("SELECT key, value FROM space_state WHERE space = ?").all(space) as { key: string; value: string }[]) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        /* a value that no longer parses is left out, not fatal */
      }
    }
    return out;
  }

  stateSize(space: string): { keys: number; bytes: number } {
    const row = this.db.prepare("SELECT count(*) AS keys, coalesce(sum(length(value)), 0) AS bytes FROM space_state WHERE space = ?").get(space) as { keys: number; bytes: number };
    return { keys: row.keys, bytes: row.bytes };
  }

  setState(space: string, key: string, value: unknown, by: string, at: string): void {
    if (value === null) {
      this.db.prepare("DELETE FROM space_state WHERE space = ? AND key = ?").run(space, key);
      return;
    }
    this.db.prepare(
      `INSERT INTO space_state (space, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(space, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(space, key, JSON.stringify(value), by, at);
  }

  stateValueBytes(space: string, key: string): number {
    const row = this.db.prepare("SELECT length(value) AS bytes FROM space_state WHERE space = ? AND key = ?").get(space, key) as { bytes: number } | undefined;
    return row?.bytes ?? 0;
  }
}
