import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What release.sh ships, checked with rsync itself and release.sh's own list.
 *
 * A worktree that had run the room harness sent its demo space repositories,
 * its blobs and a dev signing key to the box with every release (Kerf,
 * 2026-10-14): git-ignored is not rsync-ignored. The build output is
 * git-ignored too and must still go, so both halves are asserted.
 */
const unixOnly = process.platform === "win32";
describe.skipIf(unixOnly)("the release ships the build and not the developer's leftovers", () => {
  it("leaves out harness output and keys, and keeps dist", () => {
    const script = readFileSync(fileURLToPath(new URL("../../deploy/release.sh", import.meta.url)), "utf8");
    const line = script.split("\n").find((one) => one.startsWith("LOCAL_ONLY=("));
    expect(line, "release.sh names what never ships in LOCAL_ONLY").toBeTruthy();
    const words = [...line!.slice("LOCAL_ONLY=(".length, line!.lastIndexOf(")")).matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]);

    const root = mkdtempSync(join(tmpdir(), "release-excludes-"));
    const tree = join(root, "tree");
    const dest = join(root, "dest");
    try {
      for (const file of [
        "dist/index.html", "dist-server/server/index.js", "server/index.ts", "public/skill.md",
        ".dev-blobs/a.bin", ".dev-spaces/repos/demo.git/HEAD", ".dev-spaces.tickets-key", "output/vite.mjs",
        ".harness-run/x", "tools/webharness/__pycache__/inbox.cpython-312.pyc",
      ]) {
        mkdirSync(join(tree, file, ".."), { recursive: true });
        writeFileSync(join(tree, file), "x");
      }
      mkdirSync(dest);
      execFileSync("rsync", ["-a", "--delete", ...words, `${tree}/`, `${dest}/`]);
      for (const shipped of ["dist/index.html", "dist-server/server/index.js", "server/index.ts", "public/skill.md"]) {
        expect(existsSync(join(dest, shipped)), `${shipped} ships`).toBe(true);
      }
      for (const kept of [".dev-blobs", ".dev-spaces", ".dev-spaces.tickets-key", "output", ".harness-run", "tools/webharness/__pycache__"]) {
        expect(existsSync(join(dest, kept)), `${kept} stays on this machine`).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
