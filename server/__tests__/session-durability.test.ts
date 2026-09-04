import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemorySessionStore, SqliteSessionStore, type SessionStore } from "../session.js";

/**
 * The point of the SQLite store is surviving a restart, so these tests actually
 * restart it: the store is closed and a NEW instance opened against the same
 * file. Asserting against a single live instance would prove only that a Map
 * works, which is the shape of test that has passed for the wrong reason
 * repeatedly here.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fxg-sessions-"));
  path = join(dir, "sessions.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const openStore = (ttlMs = 60_000) => new SqliteSessionStore(ttlMs, path, DatabaseSync);

describe("sessions survive a restart", () => {
  it("keeps a signed-in human signed in across a process restart", () => {
    const first = openStore();
    const sid = first.create("qa-tester", "upstream-token");
    first.close();

    // The restart. A cloud platform does this on deploy, on crash, and on
    // scale-down; today it silently signed everyone out.
    const second = openStore();
    const session = second.get(sid);

    expect(session?.username).toBe("qa-tester");
    expect(session?.token).toBe("upstream-token");
    second.close();
  });

  it("does not resurrect a session that expired while the process was down", () => {
    const first = openStore(-1000); // already expired on creation
    const sid = first.create("qa-tester", "t");
    first.close();

    const second = openStore();

    expect(second.get(sid)).toBeUndefined();
    second.close();
  });

  it("keeps a destroyed session destroyed", () => {
    const first = openStore();
    const sid = first.create("qa-tester", "t");
    first.destroy(sid);
    first.close();

    expect(openStore().get(sid)).toBeUndefined();
  });
});

describe("both stores honour the same contract", () => {
  /**
   * Built inside each test, not at collection time: the sqlite path only exists
   * after beforeEach. An earlier version called this in `it.each(...)`, which
   * evaluates during collection and silently produced a file with no tests in
   * it — green run, nothing executed.
   */
  const bothStores = (ttlMs = 60_000): Array<[string, SessionStore]> => [
    ["memory", new MemorySessionStore(ttlMs)],
    ["sqlite", new SqliteSessionStore(ttlMs, path, DatabaseSync)],
  ];

  const forBoth = (fn: (store: SessionStore, name: string) => void, ttlMs?: number) => {
    for (const [name, store] of bothStores(ttlMs)) {
      try {
        fn(store, name);
      } finally {
        store.close();
      }
    }
  };

  it("never exposes the token in publicView", () => {
    // The invariant the whole BFF rests on. It has to hold in BOTH
    // implementations, or swapping the store swaps the security model.
    forBoth((store, name) => {
      const session = store.get(store.create("qa-tester", "super-secret-token"))!;

      expect(JSON.stringify(store.publicView(session)), name).not.toContain("super-secret-token");
      expect(store.publicView(session), name).toEqual({ username: "qa-tester" });
    });
  });

  it("refuses an expired session", () => {
    forBoth((store, name) => {
      expect(store.get(store.create("qa", "t")), name).toBeUndefined();
    }, -1000);
  });

  it("keeps the same session id when a token is refreshed", () => {
    forBoth((store, name) => {
      const sid = store.create("qa-tester", "old");
      store.refreshToken(sid, "new");

      expect(store.get(sid)?.token, name).toBe("new");
    });
  });

  it("returns undefined for an unknown or absent id", () => {
    forBoth((store, name) => {
      expect(store.get("not-a-real-sid"), name).toBeUndefined();
      expect(store.get(undefined), name).toBeUndefined();
    });
  });
});
