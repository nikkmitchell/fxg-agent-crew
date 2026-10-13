import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemorySessionStore, RENEW_AFTER_MS, SqliteSessionStore, type SessionStore, upstreamTokenExpiry } from "../session.js";

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

  it("keeps a new sign-in unselected across a restart until an entry is verified", () => {
    const first = openStore();
    const sid = first.createUnselected("newcomer", "token");
    first.close();
    const second = openStore();
    expect(second.get(sid)?.requiresRoomEntry).toBe(true);
    expect(second.mayInferInDefaultRoom("newcomer")).toBe(false);
    second.enterRoom(sid, "lobby");
    expect(second.get(sid)?.requiresRoomEntry).toBe(false);
    expect(second.get(sid)?.spaceRoom).toBe("lobby");
    second.close();
  });

  it("does not reconstruct a private-room actor in the default room after their session ends and the server restarts", () => {
    const first = openStore();
    const sid = first.createUnselected("Moraine", "token", "agent");
    first.enterRoom(sid, "private-room");
    first.destroy(sid);
    first.close();

    const second = openStore();
    expect(second.mayInferInDefaultRoom("moraine")).toBe(false);
    const returnSid = second.createUnselected("Moraine", "new-token", "agent");
    second.enterRoom(returnSid, "saha.ing");
    second.destroy(returnSid);
    expect(second.mayInferInDefaultRoom("moraine")).toBe(true);
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

    // Bound to a variable and closed. Left inline, this handle stays open and
    // afterEach's rmSync fails with EPERM on Windows — the assertion passes
    // while the suite reports a failure that has nothing to do with sessions.
    const second = openStore();
    expect(second.get(sid)).toBeUndefined();
    second.close();
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
      expect(store.publicView(session), name).toEqual({ username: "qa-tester", kind: "human" });
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

  it("lets a second default-room session keep an actor's legacy activity there", () => {
    forBoth((store, name) => {
      const elsewhere = store.create("Moraine", "t", "agent");
      expect(store.mayInferInDefaultRoom("moraine"), name).toBe(true);
      store.enterRoom(elsewhere, "alpha");
      expect(store.mayInferInDefaultRoom("MORAINE"), name).toBe(false);

      const defaultSession = store.create("moraine", "t2", "agent");
      expect(store.mayInferInDefaultRoom("Moraine"), name).toBe(true);
      store.enterRoom(defaultSession, "saha.ing");
      expect(store.mayInferInDefaultRoom("Moraine"), name).toBe(true);
      store.destroy(defaultSession);
      expect(store.mayInferInDefaultRoom("Moraine"), name).toBe(false);
      store.destroy(elsewhere);
      expect(store.mayInferInDefaultRoom("Moraine"), name).toBe(true);
    });
  });
});

describe("a session lasts as long as it is used (Nikk, 7227: stay signed in until you sign out)", () => {
  afterEach(() => vi.useRealTimers());

  for (const [name, make] of [["memory", (ttl: number) => new MemorySessionStore(ttl)], ["sqlite", (ttl: number) => openStore(ttl)]] as const) {
    it(`${name}: used every few days, it never ends; left alone past its life, it does`, () => {
      vi.useFakeTimers({ now: 0, toFake: ["Date"] });
      const life = 7 * RENEW_AFTER_MS;
      const store = make(life);
      const sid = store.create("Nikk2", "t");
      for (let day = 0; day < 30; day += 3) {
        vi.setSystemTime((day + 3) * RENEW_AFTER_MS);
        expect(store.get(sid)?.username, `day ${day + 3}`).toBe("Nikk2");
      }
      vi.setSystemTime(30 * RENEW_AFTER_MS + life + 1);
      expect(store.get(sid)).toBeUndefined();
      store.close();
    });
  }
});

describe("a session ends when the WebHarness token it holds does", () => {
  afterEach(() => vi.useRealTimers());

  /** The shape WebHarness issues: base64url JSON claims, a dot, a signature. */
  const tokenEnding = (expMs: number) =>
    `${Buffer.from(JSON.stringify({ uid: 1, username: "Nikk2", kind: "human", epoch: 0, exp: Math.floor(expMs / 1000) })).toString("base64url")}.signature`;
  const DAY = RENEW_AFTER_MS;

  it("reads the token's own end, and nothing from a token that does not say", () => {
    expect(upstreamTokenExpiry(tokenEnding(7 * DAY))).toBe(7 * DAY);
    expect(upstreamTokenExpiry("upstream-token")).toBeUndefined();
    expect(upstreamTokenExpiry("dev-harness-not-a-real-token")).toBeUndefined();
    expect(upstreamTokenExpiry("")).toBeUndefined();
  });

  for (const [name, make] of [["memory", (ttl: number) => new MemorySessionStore(ttl)], ["sqlite", (ttl: number) => openStore(ttl)]] as const) {
    it(`${name}: used every day, it still ends on day seven with the token, not on day 400`, () => {
      vi.useFakeTimers({ now: 0, toFake: ["Date"] });
      const store = make(400 * DAY);
      const sid = store.create("Nikk2", tokenEnding(7 * DAY));
      for (let day = 1; day < 7; day++) {
        vi.setSystemTime(day * DAY);
        expect(store.get(sid)?.username, `day ${day}`).toBe("Nikk2");
      }
      vi.setSystemTime(7 * DAY);
      expect(store.get(sid)).toBeUndefined();
      store.close();
    });

    it(`${name}: a fresh token from signing in again starts a fresh week`, () => {
      vi.useFakeTimers({ now: 10 * DAY, toFake: ["Date"] });
      const store = make(400 * DAY);
      const sid = store.create("Nikk2", tokenEnding(17 * DAY));
      vi.setSystemTime(16 * DAY);
      expect(store.get(sid)?.username).toBe("Nikk2");
      store.close();
    });

    it(`${name}: a session whose token has already died is not handed out`, () => {
      vi.useFakeTimers({ now: 10 * DAY, toFake: ["Date"] });
      const store = make(400 * DAY);
      expect(store.get(store.create("Nikk2", tokenEnding(9 * DAY)))).toBeUndefined();
      store.close();
    });
  }

  it("sqlite: a row written before this fix, with a 400-day end over a dead token, ends anyway", () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    const first = openStore(400 * DAY);
    const sid = first.create("Nikk2", tokenEnding(7 * DAY));
    // What the old code wrote: the full 400 days, whatever the token said.
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(400 * DAY, sid);
    raw.close();
    first.close();

    vi.setSystemTime(8 * DAY);
    const second = openStore(400 * DAY);
    expect(second.get(sid)).toBeUndefined();
    second.close();
  });
});
