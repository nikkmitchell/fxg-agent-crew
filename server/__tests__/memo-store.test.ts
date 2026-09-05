import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMemo, memoPath, saveMemo } from "../webharness/memo-store.js";
import { initialCrewState } from "../../src/event-core.js";

const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "fxg-memo-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const memo = (commit: string) => ({ commit, room: "AgentParty", lastId: 42, state: initialCrewState });

describe("the memo is only reused when the same code wrote it", () => {
  it("resumes when the commit matches", () => {
    withDir((dir) => {
      saveMemo(dir, memo("abc123"));
      expect(loadMemo(dir, "AgentParty", "abc123")?.lastId).toBe(42);
    });
  });

  it("discards a memo written by a DIFFERENT commit", () => {
    // The whole safety argument. If validation tightened or the reducer changed,
    // yesterday's fold was computed by a different program and is worthless —
    // reusing it would be exactly the unverified claim about history this was
    // objected to for.
    withDir((dir) => {
      saveMemo(dir, memo("old-commit"));
      expect(loadMemo(dir, "AgentParty", "new-commit")).toBeNull();
    });
  });

  it("discards it when the running service has no recorded commit", () => {
    // A hand-started service — no DEPLOYED_COMMIT — cannot vouch for anything,
    // so it replays honestly rather than trusting a file.
    withDir((dir) => {
      saveMemo(dir, memo("abc123"));
      expect(loadMemo(dir, "AgentParty", null)).toBeNull();
    });
  });

  it("does not hand one room's fold to another", () => {
    withDir((dir) => {
      saveMemo(dir, memo("abc123"));
      expect(loadMemo(dir, "SomeOtherRoom", "abc123")).toBeNull();
    });
  });

  it("treats a truncated file as no memo rather than crashing", () => {
    // A process killed mid-write. Survivable: replay from zero.
    withDir((dir) => {
      writeFileSync(memoPath(dir), '{"commit":"abc123","room":"Agent');
      expect(loadMemo(dir, "AgentParty", "abc123")).toBeNull();
    });
  });

  it("treats a missing file as no memo", () => {
    withDir((dir) => {
      expect(loadMemo(dir, "AgentParty", "abc123")).toBeNull();
    });
  });

  it("rejects a memo missing the fields it would be trusted for", () => {
    withDir((dir) => {
      writeFileSync(memoPath(dir), JSON.stringify({ commit: "abc123", room: "AgentParty" }));
      expect(loadMemo(dir, "AgentParty", "abc123")).toBeNull();
    });
  });

  it("never throws out of saveMemo, even into an unwritable path", () => {
    // Failing to cache is not a reason to fail a request; the fallback is the
    // behaviour we had before this existed.
    expect(() => saveMemo("/proc/nonexistent-dir", memo("abc123"))).not.toThrow();
  });
});
