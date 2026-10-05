import type { DatabaseSync } from "node:sqlite";
import type { DeployRecord } from "../../shared/spaces.js";
import type { BenchPiece } from "../../shared/space-bench.js";
import type { SpaceItem } from "../../shared/space-kit.js";
import type { FeedbackReport, StoredFeedback } from "../../shared/space-feedback.js";

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
  pieces_json?: string | null;
  pieces_problems?: string | null;
};

export type StoredDeploy = Omit<DeployRecord, "status"> & {
  status: DeployRow["status"];
  spa: boolean;
  /** What saha-pieces.json listed (shared/space-bench.ts); empty when it had none. */
  pieces?: BenchPiece[];
  piecesProblems?: string[];
};

const parseList = <T>(text: string | null | undefined): T[] => {
  if (!text) return [];
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
};

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
  pieces: parseList<BenchPiece>(row.pieces_json),
  piecesProblems: parseList<string>(row.pieces_problems),
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
      `INSERT INTO space_deploys (id, space, branch, commit_sha, message, author, pushed_by, created_at, status, problem, files, bytes, spa, pieces_json, pieces_problems)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(deploy.id, deploy.space, deploy.branch, deploy.commit, deploy.message, deploy.author, deploy.pushedBy, deploy.createdAt,
      deploy.status, deploy.problem, deploy.files, deploy.bytes, deploy.spa ? 1 : 0,
      deploy.pieces?.length ? JSON.stringify(deploy.pieces) : null,
      deploy.piecesProblems?.length ? JSON.stringify(deploy.piecesProblems) : null);
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

  /**
   * Ready deploys of a branch beyond the newest `keep`, never the live one and
   * never one something is PINNED to (a finished space, Nikk 6940): these lose
   * their files. A pin is a promise that this exact version stays; the tenth
   * push after it must not quietly break the room that made the promise.
   */
  toRetire(space: string, branch: string, keep: number, pinned: ReadonlySet<string> = new Set()): StoredDeploy[] {
    const liveId = this.live(space, branch)?.id ?? "";
    return (this.db.prepare(
      "SELECT * FROM space_deploys WHERE space = ? AND branch = ? AND status = 'ready' AND id != ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?",
    ).all(space, branch, liveId, Math.max(0, keep - 1)) as DeployRow[]).map(toDeploy).filter((deploy) => !pinned.has(deploy.id));
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

  // ------------------------------------------------ the workbench (migration 46)

  benchBranch(name: string): string {
    const row = this.db.prepare("SELECT bench_branch FROM spaces WHERE name = ?").get(name) as { bench_branch: string | null } | undefined;
    return row?.bench_branch ?? "main";
  }

  setBenchBranch(name: string, branch: string): void {
    this.db.prepare("UPDATE spaces SET bench_branch = ? WHERE name = ?").run(branch === "main" ? null : branch, name);
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

  // ------------------------------------------------ items that follow you (migration 47)

  items(username: string): SpaceItem[] {
    const rows = this.db.prepare("SELECT id, from_space, name, url, data, created_at FROM carried_items WHERE username = ? ORDER BY created_at, id").all(username) as {
      id: string; from_space: string; name: string; url: string | null; data: string; created_at: string;
    }[];
    return rows.map((row) => {
      let data: unknown = null;
      try {
        data = JSON.parse(row.data);
      } catch {
        /* unreadable data is shown as none */
      }
      return { id: row.id, name: row.name, from: row.from_space, url: row.url, data, at: row.created_at };
    });
  }

  itemCount(username: string): number {
    return (this.db.prepare("SELECT count(*) AS n FROM carried_items WHERE username = ?").get(username) as { n: number }).n;
  }

  addItem(username: string, item: SpaceItem): void {
    this.db.prepare("INSERT INTO carried_items (id, username, from_space, name, url, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, username, item.from, item.name, item.url, JSON.stringify(item.data ?? null), item.at);
  }

  /** Take an item back: only the space that gave it may. True when one went. */
  removeItem(username: string, id: string, space: string): boolean {
    return Number(this.db.prepare("DELETE FROM carried_items WHERE username = ? AND id = ? AND from_space = ?").run(username, id, space).changes) > 0;
  }

  // ------------------------------------------------ tester feedback (migration 48)

  addFeedback(space: string, by: string, report: FeedbackReport, id: string, at: string): void {
    this.db.prepare("INSERT INTO space_feedback (id, space, branch, username, device, summary, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, space, report.branch, by, report.device, report.summary, JSON.stringify(report.items), at);
  }

  /** Newest first; one branch, or every branch when `branch` is null. */
  feedback(space: string, branch: string | null, limit: number): StoredFeedback[] {
    const rows = (branch === null
      ? this.db.prepare("SELECT * FROM space_feedback WHERE space = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(space, limit)
      : this.db.prepare("SELECT * FROM space_feedback WHERE space = ? AND branch = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(space, branch, limit)) as {
      id: string; branch: string; username: string; device: string; summary: string; items_json: string; created_at: string;
    }[];
    return rows.map((row) => {
      let items: StoredFeedback["items"] = [];
      try {
        items = JSON.parse(row.items_json);
      } catch {
        /* unreadable items are shown as none */
      }
      return { id: row.id, by: row.username, at: row.created_at, branch: row.branch, device: row.device, summary: row.summary, items };
    });
  }
}
