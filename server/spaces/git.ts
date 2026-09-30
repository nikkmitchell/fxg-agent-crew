import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The git side of spaces: bare repositories on disk, driven through the git
 * binary. Nothing here takes a path or ref from a request without it having
 * been checked by shared/spaces.ts first.
 *
 * Every call runs git with a clean environment: no user config, no terminal
 * prompts, HOME pointed at the spaces root, so whatever the service user's
 * ~/.gitconfig says cannot change how a team's repository behaves.
 */

export class GitError extends Error {
  constructor(message: string, readonly stderr: string, readonly stdout = "", readonly code: number | null = null) {
    super(message);
    this.name = "GitError";
  }
}

export function gitEnv(root: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    ...extra,
  };
}

/** Run git and collect its output. Rejects on a non-zero exit, with stderr. */
export function git(root: string, args: string[], options: { input?: string | Buffer; env?: Record<string, string> } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { env: gitEnv(root, options.env), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new GitError(`git ${args[0]} failed (${code})`, stderr, Buffer.concat(out).toString("utf8"), code));
    });
    child.stdin.end(options.input ?? "");
  });
}

export const repoPath = (root: string, space: string) => join(root, "repos", `${space}.git`);

/**
 * The hook git runs after a push. It only TALKS: the server deploys once the
 * push has finished (routes.ts), and this tells the person pushing where to
 * look, in their own terminal, since that is where they are.
 */
function postReceiveHook(space: string): string {
  return `#!/bin/sh
# Installed by saha.ing (server/spaces/git.ts). The server deploys after the push.
while read old new ref; do
  branch=\${ref#refs/heads/}
  if [ "$new" = "0000000000000000000000000000000000000000" ]; then
    echo "saha.ing: branch $branch deleted"
  elif [ "$branch" = "main" ]; then
    echo "saha.ing: deploying main -> /s/${space}/ (live in a few seconds)"
  else
    echo "saha.ing: deploying preview $branch -> /s/${space}/@$branch/"
  fi
done
echo "saha.ing: every deploy and its result: /spaces"
`;
}

export type StarterFile = { path: string; content: string };

/**
 * A new bare repository with main as its branch and one first commit, so the
 * very first clone has something in it and the space has a page from the start.
 */
export async function createRepo(root: string, space: string, starter: StarterFile[], author: string): Promise<string> {
  const path = repoPath(root, space);
  await mkdir(dirname(path), { recursive: true });
  await git(root, ["init", "--bare", "--quiet", "--initial-branch=main", path]);
  await git(root, ["--git-dir", path, "config", "http.receivepack", "true"]);
  // Pushes are what deploy, so a push of a huge history should say so early.
  await git(root, ["--git-dir", path, "config", "receive.maxInputSize", String(500 * 1024 * 1024)]);
  const hook = join(path, "hooks", "post-receive");
  await writeFile(hook, postReceiveHook(space), "utf8");
  await chmod(hook, 0o755);

  const lines: string[] = [];
  for (const file of starter) {
    const sha = (await git(root, ["--git-dir", path, "hash-object", "-w", "--stdin"], { input: file.content })).toString().trim();
    lines.push(`100644 blob ${sha}\t${file.path}`);
  }
  const tree = (await git(root, ["--git-dir", path, "mktree"], { input: `${lines.join("\n")}\n` })).toString().trim();
  const who = { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@saha.ing`, GIT_COMMITTER_NAME: "saha.ing", GIT_COMMITTER_EMAIL: "spaces@saha.ing" };
  const commit = (await git(root, ["--git-dir", path, "commit-tree", tree, "-m", `A new space: ${space}`], { env: who })).toString().trim();
  await git(root, ["--git-dir", path, "update-ref", "refs/heads/main", commit]);
  return commit;
}

/** Every branch and the commit it points at. */
export async function branches(root: string, space: string): Promise<Map<string, string>> {
  const out = (await git(root, ["--git-dir", repoPath(root, space), "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"])).toString();
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [branch, sha] = line.trim().split(" ");
    if (branch && sha) map.set(branch, sha);
  }
  return map;
}

export async function commitInfo(root: string, space: string, commit: string): Promise<{ author: string; message: string }> {
  const out = (await git(root, ["--git-dir", repoPath(root, space), "log", "-1", "--format=%an%x00%s", commit])).toString();
  const [author = "", message = ""] = out.replace(/\n$/, "").split("\0");
  return { author, message };
}

export type TreeFile = { path: string; sha: string; size: number };

/**
 * The REGULAR FILES of a commit. Symlinks (mode 120000) and submodules are
 * left out on purpose: a symlink in a repo pointing at /etc/passwd, served as
 * a file, would hand out the box. Only blobs with a normal file mode count.
 */
export async function treeFiles(root: string, space: string, commit: string): Promise<TreeFile[]> {
  const out = (await git(root, ["--git-dir", repoPath(root, space), "ls-tree", "-r", "-l", "-z", "--full-tree", commit])).toString("utf8");
  const files: TreeFile[] = [];
  for (const entry of out.split("\0")) {
    const match = /^(\d{6}) blob ([0-9a-f]{40,64})\s+(\d+)\t(.+)$/s.exec(entry);
    if (!match) continue;
    const [, mode, sha, size, path] = match;
    if (mode !== "100644" && mode !== "100755") continue;
    files.push({ path, sha, size: Number(size) });
  }
  return files;
}

// ------------------------------------------------------------------ the code browser (F)

/** A branch name or a commit id a member may ask to see. Never an option (no leading "-"). */
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/;
const SHA = /^[0-9a-f]{7,64}$/;

/**
 * The commit a member asked for, or null: an existing branch, or a commit id
 * that really is a commit in this repo. Nothing else ever reaches git.
 */
export async function resolveCommit(root: string, space: string, ref: string): Promise<string | null> {
  const heads = await branches(root, space);
  const head = heads.get(ref);
  if (head) return head;
  if (!SHA.test(ref) || !REF.test(ref)) return null;
  try {
    return (await git(root, ["--git-dir", repoPath(root, space), "rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).toString().trim() || null;
  } catch {
    return null;
  }
}

export type LogEntry = { sha: string; author: string; at: string; message: string };

/** The newest commits reachable from `commit`, newest first. */
export async function commitLog(root: string, space: string, commit: string, limit = 50): Promise<LogEntry[]> {
  const out = (await git(root, ["--git-dir", repoPath(root, space), "log", `--max-count=${limit}`, "--format=%H%x00%an%x00%aI%x00%s%x1e", commit])).toString("utf8");
  return out
    .split("\x1e")
    .map((line) => line.replace(/^\n/, ""))
    .filter(Boolean)
    .map((line) => {
      const [sha = "", author = "", at = "", message = ""] = line.split("\0");
      return { sha, author, at, message };
    });
}

export type ChangedFile = { path: string; added: number | null; removed: number | null };

/** The largest diff shown in full; beyond it the text is cut and says so. */
export const DIFF_LIMIT = 200_000;

/** What one commit changed: per file counts, and the patch (cut at DIFF_LIMIT). */
export async function commitChanges(root: string, space: string, commit: string): Promise<{ files: ChangedFile[]; patch: string; cut: boolean; parent: string | null }> {
  const dir = ["--git-dir", repoPath(root, space)];
  const numstat = (await git(root, [...dir, "show", "--format=", "--numstat", "-z", "--no-renames", commit])).toString("utf8");
  const files: ChangedFile[] = [];
  for (const entry of numstat.split("\0")) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(entry.replace(/^\n/, ""));
    if (!match) continue;
    files.push({ path: match[3], added: match[1] === "-" ? null : Number(match[1]), removed: match[2] === "-" ? null : Number(match[2]) });
  }
  const full = (await git(root, [...dir, "show", "--format=", "--no-color", "--no-renames", "--patch", commit])).toString("utf8");
  const parents = (await git(root, [...dir, "log", "-1", "--format=%P", commit])).toString().trim().split(" ").filter(Boolean);
  return { files, patch: full.length > DIFF_LIMIT ? full.slice(0, DIFF_LIMIT) : full, cut: full.length > DIFF_LIMIT, parent: parents[0] ?? null };
}

/** The largest file shown as text in the browser. */
export const VIEW_LIMIT = 512 * 1024;

/**
 * One file of a commit, by path, from the same list the deploys use (so a
 * symlink or submodule is never followed). Binary or too big: said, not shown.
 */
export async function viewFile(root: string, space: string, commit: string, path: string): Promise<{ path: string; size: number; binary: boolean; text: string | null } | null> {
  const file = (await treeFiles(root, space, commit)).find((each) => each.path === path);
  if (!file) return null;
  if (file.size > VIEW_LIMIT) return { path, size: file.size, binary: false, text: null };
  const bytes = await readBlob(root, space, file.sha);
  const binary = bytes.subarray(0, 8000).includes(0);
  return { path, size: file.size, binary, text: binary ? null : bytes.toString("utf8") };
}

export async function readBlob(root: string, space: string, sha: string): Promise<Buffer> {
  return git(root, ["--git-dir", repoPath(root, space), "cat-file", "blob", sha]);
}

/**
 * Write blobs to disk under `target`, each at its given relative path, in one
 * `git cat-file --batch` stream rather than a process per file.
 *
 * STREAMED, not buffered: each object's bytes go to its file as they arrive,
 * so a 50 MB model costs 50 MB of disk writes, not a buffer copied over and
 * over as it grows.
 */
export function exportBlobs(root: string, space: string, files: { sha: string; to: string }[], target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (files.length === 0) {
      resolve();
      return;
    }
    const child = spawn("git", ["--git-dir", repoPath(root, space), "cat-file", "--batch"], { env: gitEnv(root), stdio: ["pipe", "pipe", "pipe"] });
    let index = 0;
    let header: Buffer[] = [];
    let remaining = -1; // bytes of the current object still to write; -1 while reading a header
    let trailing = false; // the newline after each object's bytes
    let fd: number | null = null;
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      if (fd !== null) closeSync(fd);
      child.kill();
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        let at = 0;
        // remaining === 0 is an empty file whose header ended this chunk: close it now.
        while ((at < chunk.length || remaining === 0) && !failed) {
          if (trailing) {
            at += 1;
            trailing = false;
            continue;
          }
          if (remaining < 0) {
            const newline = chunk.indexOf(0x0a, at);
            if (newline < 0) {
              header.push(chunk.subarray(at));
              return;
            }
            header.push(chunk.subarray(at, newline));
            at = newline + 1;
            const parts = Buffer.concat(header).toString().split(" ");
            header = [];
            if (parts[1] !== "blob" || index >= files.length) return fail(new GitError(`unexpected object in export: ${parts.join(" ")}`, ""));
            const destination = join(target, files[index].to);
            index += 1;
            mkdirSync(dirname(destination), { recursive: true });
            fd = openSync(destination, "w");
            remaining = Number(parts[2]);
          }
          const take = Math.min(remaining, chunk.length - at);
          if (take > 0 && fd !== null) writeSync(fd, chunk, at, take);
          at += take;
          remaining -= take;
          if (remaining === 0 && fd !== null) {
            closeSync(fd);
            fd = null;
            remaining = -1;
            trailing = true;
          }
        }
      } catch (error) {
        fail(error as Error);
      }
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (failed) return;
      if (code !== 0 || index !== files.length || remaining >= 0) return fail(new GitError("export did not finish", ""));
      resolve();
    });
    child.stdin.end(files.map((file) => file.sha).join("\n") + "\n");
  });
}

export type MergeResult =
  | { ok: true; commit: string; how: "already" | "fast-forward" | "merged" }
  | { ok: false; conflicts: string[] };

/**
 * MERGE A BRANCH INTO ANOTHER ON THE BOX, the Spaces page's "Merge into main"
 * (a pull request without the ceremony). No working copy: git merge-tree
 * works out the result in the bare repository, and the branch only moves if
 * nobody pushed to it meanwhile (update-ref checks the old commit). A
 * conflict changes nothing and names the files, to be settled with git.
 */
export async function mergeInto(root: string, space: string, into: string, from: string, by: string): Promise<MergeResult> {
  const dir = repoPath(root, space);
  const heads = await branches(root, space);
  const target = heads.get(into);
  const source = heads.get(from);
  if (!target || !source) throw new GitError(`No branch ${!target ? into : from}.`, "");
  const ancestor = async (a: string, b: string) =>
    git(root, ["--git-dir", dir, "merge-base", "--is-ancestor", a, b]).then(() => true, (error: unknown) => {
      if (error instanceof GitError && error.code === 1) return false;
      throw error;
    });
  if (await ancestor(source, target)) return { ok: true, commit: target, how: "already" };
  if (await ancestor(target, source)) {
    await git(root, ["--git-dir", dir, "update-ref", `refs/heads/${into}`, source, target]);
    return { ok: true, commit: source, how: "fast-forward" };
  }
  let tree: string;
  try {
    tree = (await git(root, ["--git-dir", dir, "merge-tree", "--write-tree", "--name-only", "--no-messages", target, source])).toString().split("\n")[0].trim();
  } catch (error) {
    if (error instanceof GitError && error.code === 1) {
      const conflicts = error.stdout.split("\n").slice(1).map((line) => line.trim()).filter(Boolean);
      return { ok: false, conflicts: [...new Set(conflicts)] };
    }
    throw error;
  }
  const who = { GIT_AUTHOR_NAME: by, GIT_AUTHOR_EMAIL: `${by}@saha.ing`, GIT_COMMITTER_NAME: "saha.ing", GIT_COMMITTER_EMAIL: "spaces@saha.ing" };
  const commit = (await git(root, ["--git-dir", dir, "commit-tree", tree, "-p", target, "-p", source, "-m", `Merge ${from} into ${into} (${by}, on saha.ing)`], { env: who })).toString().trim();
  await git(root, ["--git-dir", dir, "update-ref", `refs/heads/${into}`, commit, target]);
  return { ok: true, commit, how: "merged" };
}
