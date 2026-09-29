import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branches, createRepo, git, mergeInto, repoPath } from "../spaces/git.js";

/** The Spaces page's "Merge into main" (server/spaces/git.ts mergeInto), on a real bare repo. */
let root = "";
const space = "merge-test";
const dir = () => repoPath(root, space);
const who = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

/** A commit on top of `parent` whose tree is exactly `files`, moved onto `branch`. */
async function commit(branch: string, parent: string, files: Record<string, string>): Promise<string> {
  const lines: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const sha = (await git(root, ["--git-dir", dir(), "hash-object", "-w", "--stdin"], { input: content })).toString().trim();
    lines.push(`100644 blob ${sha}\t${path}`);
  }
  const tree = (await git(root, ["--git-dir", dir(), "mktree"], { input: `${lines.join("\n")}\n` })).toString().trim();
  const sha = (await git(root, ["--git-dir", dir(), "commit-tree", tree, "-p", parent, "-m", branch], { env: who })).toString().trim();
  await git(root, ["--git-dir", dir(), "update-ref", `refs/heads/${branch}`, sha]);
  return sha;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "space-merge-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("merging a branch on the box", () => {
  it("fast-forwards main when main has not moved, and says so when there is nothing to do", async () => {
    const first = await createRepo(root, space, [{ path: "index.html", content: "a\n" }], "nikk");
    const work = await commit("wip", first, { "index.html": "b\n" });
    expect(await mergeInto(root, space, "main", "wip", "nikk")).toEqual({ ok: true, commit: work, how: "fast-forward" });
    expect((await branches(root, space)).get("main")).toBe(work);
    expect(await mergeInto(root, space, "main", "wip", "nikk")).toEqual({ ok: true, commit: work, how: "already" });
  });

  it("makes a real merge commit when both changed different files", async () => {
    const first = await createRepo(root, space, [{ path: "index.html", content: "a\n" }], "nikk");
    await commit("wip", first, { "index.html": "a\n", "piece.js": "x\n" });
    await commit("main", first, { "index.html": "a2\n" });
    const result = await mergeInto(root, space, "main", "wip", "mica");
    expect(result).toMatchObject({ ok: true, how: "merged" });
    const main = (await branches(root, space)).get("main")!;
    const files = (await git(root, ["--git-dir", dir(), "ls-tree", "--name-only", main])).toString().split("\n").filter(Boolean);
    expect(files.sort()).toEqual(["index.html", "piece.js"]);
    expect((await git(root, ["--git-dir", dir(), "show", `${main}:index.html`])).toString()).toBe("a2\n");
    expect((await git(root, ["--git-dir", dir(), "log", "-1", "--format=%an %s", main])).toString().trim()).toBe("mica Merge wip into main (mica, on saha.ing)");
  });

  it("changes nothing on a conflict and names the files", async () => {
    const first = await createRepo(root, space, [{ path: "index.html", content: "a\n" }], "nikk");
    await commit("wip", first, { "index.html": "from wip\n" });
    const main = await commit("main", first, { "index.html": "from main\n" });
    expect(await mergeInto(root, space, "main", "wip", "nikk")).toEqual({ ok: false, conflicts: ["index.html"] });
    expect((await branches(root, space)).get("main")).toBe(main);
  });
});
