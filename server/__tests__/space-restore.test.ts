import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { branches, createRepo, gitEnv, prepareAllRepos, repoPath } from "../spaces/git.js";
import { tempDir } from "./test-config.js";

const run = (root: string, args: string[]) => execFileSync("git", args, { env: gitEnv(root) }).toString().trim();
const setting = (root: string, space: string, key: string) => {
  try {
    return run(root, ["--git-dir", repoPath(root, space), "config", "--get", key]);
  } catch {
    return null;
  }
};

describe("a space restored from a backup takes pushes again (Sill, 6468)", () => {
  it("gets its push settings and hook back when the server starts, with every branch intact", async () => {
    const before = tempDir("spaces-");
    await createRepo(before, "xr.instruments", [{ path: "index.html", content: "marimba" }], "Sill");
    const bundle = join(tempDir("backup-"), "xr.instruments.bundle");
    run(before, ["--git-dir", repoPath(before, "xr.instruments"), "bundle", "create", bundle, "--all"]);

    // The restore docs/SPACES.md describes, onto a fresh disk.
    const after = tempDir("spaces-");
    mkdirSync(join(after, "repos"), { recursive: true });
    run(after, ["clone", "--quiet", "--mirror", bundle, repoPath(after, "xr.instruments")]);
    expect(setting(after, "xr.instruments", "http.receivepack")).toBeNull();

    const { prepared, failed } = await prepareAllRepos(after);
    expect({ prepared, failed }).toEqual({ prepared: ["xr.instruments"], failed: [] });
    expect(setting(after, "xr.instruments", "http.receivepack")).toBe("true");
    expect(setting(after, "xr.instruments", "receive.maxInputSize")).toBe(String(500 * 1024 * 1024));
    const hook = join(repoPath(after, "xr.instruments"), "hooks", "post-receive");
    expect(statSync(hook).mode & 0o111).not.toBe(0);
    expect([...(await branches(after, "xr.instruments")).keys()]).toEqual(["main"]);
  });

  it("leaves alone anything in repos/ that is not a space, and a root with no repos at all", async () => {
    const root = tempDir("spaces-");
    mkdirSync(join(root, "repos", "Not A Space.git"), { recursive: true });
    writeFileSync(join(root, "repos", "notes.txt"), "hello");
    expect(await prepareAllRepos(root)).toEqual({ prepared: [], failed: [] });
    expect(await prepareAllRepos(tempDir("empty-"))).toEqual({ prepared: [], failed: [] });
  });
});
