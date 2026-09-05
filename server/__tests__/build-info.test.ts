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
