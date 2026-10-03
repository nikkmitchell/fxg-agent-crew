import { describe, expect, it } from "vitest";
import { git } from "../spaces/git.js";
import { tempDir } from "./test-config.js";

/**
 * A GIT THAT STOPS READING MUST NOT KILL THE SERVER (Sill, 6820): a push to a
 * space took saha.ing down with an uncaught `write EPIPE`, because git()'s
 * stdin had no error listener. A git that exits without reading what it was
 * given is an answer (its exit code), never a crash.
 */
describe("git() and a git that does not read its input", () => {
  it("settles with git's own answer, and nothing is thrown at the process", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      // `git --version` never reads stdin; 8 MB cannot fit in the pipe, so the write breaks.
      const answer = await git(tempDir(), ["--version"], { input: Buffer.alloc(8 * 1024 * 1024, 97) });
      expect(answer.toString()).toMatch(/^git version/);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
