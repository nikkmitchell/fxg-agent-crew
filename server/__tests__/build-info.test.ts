import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBuildInfo } from "../routes/build.js";

/**
 * A build panel exists to answer "is what I think is running actually
 * running". So the case that matters is not the happy one — it is the one
 * where the answer is unknown, because inventing a version there defeats the
 * entire purpose.
 */
describe("build info", () => {
  it("reports the deployed commit when the release script recorded one", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_COMMIT"), "5a2ba27abc\n");
      const info = readBuildInfo(dir);

      expect(info.commit).toBe("5a2ba27abc");
      expect(info.deployedAt).not.toBeNull();
      expect(info.unavailableReason).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says UNKNOWN, with a reason, when there is no record", () => {
    // The real case: a service started by hand rather than by release.sh. This
    // happened on the live host and was only noticed by reading the box. It
    // must never render as a blank field that looks like loading, and never as
    // a plausible-looking commit.
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-none-"));
    try {
      const info = readBuildInfo(dir);

      expect(info.commit).toBeNull();
      expect(info.unavailableReason).toContain("release.sh");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats an empty record as unknown rather than as a commit", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-empty-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_COMMIT"), "   \n");
      const info = readBuildInfo(dir);

      expect(info.commit).toBeNull();
      expect(info.unavailableReason).toBe("DEPLOYED_COMMIT is empty");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports process start separately from deploy time", () => {
    // These differ after a bare `systemctl restart`, and conflating them would
    // report a restart as a deployment.
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-times-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_COMMIT"), "abc123\n");
      const info = readBuildInfo(dir);

      expect(info.processStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(info.processStartedAt).not.toBe(info.deployedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("branch and tree state", () => {
  it("reports the branch and a clean tree when the release recorded them", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-branch-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_COMMIT"), "abc123\n");
      writeFileSync(join(dir, "DEPLOYED_BRANCH"), "main\n");
      writeFileSync(join(dir, "DEPLOYED_TREE"), "clean\n");
      const info = readBuildInfo(dir);

      expect(info.branch).toBe("main");
      expect(info.tree).toBe("clean");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says NOT RECORDED for a deploy made before these were written", () => {
    // Every deploy up to now. Absent must read as unknown, never as "main" or
    // "clean" — both of which would be a reassuring guess about the thing this
    // panel exists to check.
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-old-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_COMMIT"), "abc123\n");
      const info = readBuildInfo(dir);

      expect(info.branch).toBeNull();
      expect(info.tree).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries the dirty count so an artifact that does not match its commit is visible", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-dirty-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_COMMIT"), "abc123\n");
      writeFileSync(join(dir, "DEPLOYED_TREE"), "dirty:3\n");
      expect(readBuildInfo(dir).tree).toBe("dirty:3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reports branch and tree when the commit itself is unknown", () => {
    // A hand-started service may still have sidecars from an earlier deploy.
    // Losing them because the commit is missing would discard true information.
    const dir = mkdtempSync(join(tmpdir(), "fxg-build-nocommit-"));
    try {
      writeFileSync(join(dir, "DEPLOYED_BRANCH"), "feat/x\n");
      const info = readBuildInfo(dir);
      expect(info.commit).toBeNull();
      expect(info.branch).toBe("feat/x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
