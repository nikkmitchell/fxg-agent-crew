import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { BoardStore, Refused } from "../db/store.js";

/**
 * The rules survive the move off event sourcing.
 *
 * ADR-002 retires the reducer, and the risk of a rewrite like this is that the
 * rules quietly go with it — each one having been learned from a real incident.
 * These tests are those incidents, re-asked of the new code.
 */

let db: ReturnType<typeof openDatabase>;
let store: BoardStore;

const nikk = { id: "nikk", kind: "human" as const };
const claude = { id: "claude-nikk2mbp", kind: "agent" as const };
const stranger = { id: "stranger", kind: "human" as const };

beforeEach(() => {
  db = openDatabase(":memory:", DatabaseSync);
  store = new BoardStore(db);
  store.createProject(nikk, { id: "saha", name: "Saha", goals: ["ship it"] });
});

const aTask = (owners: string[] = []) =>
  store.createTask(nikk, { projectId: "saha", title: "A card", owners });

describe("project authority", () => {
  it("lets the creator act, because a new project must be usable by somebody", () => {
    expect(() => aTask()).not.toThrow();
  });

  it("refuses a non-member, and says it is a request rather than an error", () => {
    expect(() => store.createTask(stranger, { projectId: "saha", title: "nope" }))
      .toThrow(/not a member/);
  });

  it("OPERATING AN AGENT GRANTS NOTHING", () => {
    // The rule this whole system repeats. nikk is a manager; claude is nikk's
    // confirmed agent; claude still may not touch the project.
    store.actOnOwnership(nikk, "claude-nikk2mbp", "nikk", "declare");
    store.actOnOwnership(claude, "claude-nikk2mbp", "nikk", "confirm");

    expect(() => store.createTask(claude, { projectId: "saha", title: "by proxy" }))
      .toThrow(/not a member/);
  });

  it("grants authority only through explicit membership", () => {
    store.actOnMembership(nikk, "saha", "claude-nikk2mbp", "grant", ["engineering"]);

    expect(() => store.createTask(claude, { projectId: "saha", title: "mine now" })).not.toThrow();
  });

  it("lets only a manager change who belongs", () => {
    store.actOnMembership(nikk, "saha", "claude-nikk2mbp", "grant", ["engineering"]);

    expect(() => store.actOnMembership(claude, "saha", "stranger", "grant", ["manager"]))
      .toThrow(/only a project manager/);
  });
});

describe("moving cards", () => {
  it("refuses backlog straight to done", () => {
    const id = aTask();
    expect(() => store.transitionTask(nikk, id, "done")).toThrow(/not a legal move/);
  });

  it("allows the legal path", () => {
    const id = aTask();
    for (const to of ["assigned", "in_progress", "review", "done"] as const) {
      store.transitionTask(nikk, id, to);
    }
    expect((db.prepare("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status).toBe("done");
  });

  it("cannot be bypassed through the general update path", () => {
    // updateTask deliberately has no status field. If it grew one, this fails.
    const id = aTask();
    store.updateTask(nikk, id, { title: "renamed" } as never);
    expect((db.prepare("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status).toBe("backlog");
  });

  it("clears the blocker when a card stops being blocked", () => {
    const id = aTask();
    store.transitionTask(nikk, id, "assigned");
    store.transitionTask(nikk, id, "in_progress");
    store.transitionTask(nikk, id, "blocked", "waiting on auth");
    expect((db.prepare("SELECT blocker FROM tasks WHERE id=?").get(id) as { blocker: string }).blocker)
      .toBe("waiting on auth");

    store.transitionTask(nikk, id, "in_progress");
    expect((db.prepare("SELECT blocker FROM tasks WHERE id=?").get(id) as { blocker: string | null }).blocker).toBeNull();
  });
});

describe("briefs and comments", () => {
  it("accepts a brief far longer than a chat message could carry", () => {
    // The whole point of ADR-002. 2000 characters was the transport's limit and
    // it made eleven real cards uneditable.
    const id = aTask();
    const long = "x".repeat(20_000);
    store.updateTask(nikk, id, { description: long });

    expect((db.prepare("SELECT description FROM tasks WHERE id=?").get(id) as { description: string }).description)
      .toHaveLength(20_000);
  });

  it("keeps comments when the card is edited", () => {
    // Under the old design an edit re-sent every comment, which is what made
    // cards uneditable. Comments are their own rows now, so an edit cannot
    // touch them at all.
    const id = aTask();
    store.addComment(nikk, id, "first");
    store.addComment(nikk, id, "second");
    store.updateTask(nikk, id, { title: "renamed" });

    expect(db.prepare("SELECT COUNT(*) c FROM comments WHERE task_id=?").get(id)).toEqual({ c: 2 });
  });

  it("distinguishes a cleared brief from an unmentioned one", () => {
    const id = aTask();
    store.updateTask(nikk, id, { description: "something" });
    store.updateTask(nikk, id, { title: "renamed" });
    expect((db.prepare("SELECT description FROM tasks WHERE id=?").get(id) as { description: string }).description)
      .toBe("something");

    store.updateTask(nikk, id, { description: null });
    expect((db.prepare("SELECT description FROM tasks WHERE id=?").get(id) as { description: null }).description).toBeNull();
  });
});

describe("profiles", () => {
  it("refuses a forbidden key outright rather than stripping it", () => {
    // Silently dropping tells the sender it was stored, and they believe it.
    expect(() => store.upsertProfile(nikk, { displayName: "Nikk", hostname: "laptop.local" }))
      .toThrow(/may never be stored/);
  });

  it("writes the profile of the caller, never a name in the body", () => {
    store.upsertProfile(nikk, { displayName: "Nikk", actorId: "someone-else" } as never);

    const rows = db.prepare("SELECT id, display_name FROM actors WHERE display_name IS NOT NULL").all();
    expect(rows).toEqual([{ id: "nikk", display_name: "Nikk" }]);
  });

  it("refuses a runtime on a person", () => {
    expect(() => store.upsertProfile(nikk, { displayName: "Nikk", model: "opus-5" }))
      .toThrow(/not a person/);
  });
});

describe("ownership is a request, not a fact", () => {
  it("starts pending, and only the agent can settle it", () => {
    store.actOnOwnership(nikk, "claude-nikk2mbp", "nikk", "declare");
    expect((db.prepare("SELECT state FROM ownerships").get() as { state: string }).state).toBe("pending");

    expect(() => store.actOnOwnership(nikk, "claude-nikk2mbp", "nikk", "confirm"))
      .toThrow(/only the agent/);

    store.actOnOwnership(claude, "claude-nikk2mbp", "nikk", "confirm");
    expect((db.prepare("SELECT state FROM ownerships").get() as { state: string }).state).toBe("verified");
  });

  it("refuses a claim made on someone else's behalf", () => {
    expect(() => store.actOnOwnership(stranger, "claude-nikk2mbp", "nikk", "declare"))
      .toThrow(/only claim an agent as your own/);
  });

  it("lets either side end it, and nobody else", () => {
    store.actOnOwnership(nikk, "claude-nikk2mbp", "nikk", "declare");
    expect(() => store.actOnOwnership(stranger, "claude-nikk2mbp", "nikk", "revoke")).toThrow(/not your link/);
    store.actOnOwnership(claude, "claude-nikk2mbp", "nikk", "revoke");
    expect((db.prepare("SELECT state FROM ownerships").get() as { state: string }).state).toBe("revoked");
  });
});

describe("the audit trail", () => {
  it("records who did what", () => {
    const id = aTask();
    store.transitionTask(nikk, id, "assigned");

    const rows = db.prepare("SELECT actor_id, action, entity FROM audit ORDER BY id").all();
    expect(rows).toContainEqual({ actor_id: "nikk", action: "transition", entity: "task" });
  });

  it("writes no BUSINESS audit row when the change was refused", () => {
    // The audit row and the change share a transaction, so a refusal leaves no
    // record of a change that did not happen. That part was right.
    const id = aTask();
    const before = db.prepare("SELECT COUNT(*) c FROM audit").get() as { c: number };
    expect(() => store.transitionTask(nikk, id, "done")).toThrow();

    expect(db.prepare("SELECT COUNT(*) c FROM audit").get()).toEqual(before);
  });

  it("RECORDS THE DENIAL, which the first version of this store did not", () => {
    // Caught in review by Inkstone. I had reasoned from "no audit row for a
    // change that did not happen" to "no trace at all", and wrote a test
    // asserting it. But a refusal is a security signal: repeated denials are
    // how you see someone probing, or a permission that has broken. Making them
    // invisible inverts validated-is-not-authorized.
    const id = aTask();
    expect(() => store.transitionTask(nikk, id, "done")).toThrow();

    const denials = db.prepare("SELECT actor_id, action, target, code FROM security_audit").all();
    expect(denials).toEqual([
      { actor_id: "nikk", action: "transition task", target: id, code: "ILLEGAL_TRANSITION" },
    ]);
  });

  it("records a denial that happens OUTSIDE a transaction too", () => {
    // upsertProfile refuses forbidden keys before opening one, so it needs its
    // own guard or that whole class of attempt goes unrecorded — which is the
    // class most worth seeing.
    expect(() => store.upsertProfile(nikk, { displayName: "N", hostname: "laptop.local" })).toThrow();

    const denial = db.prepare("SELECT actor_id, action, code FROM security_audit").get();
    expect(denial).toEqual({ actor_id: "nikk", action: "update profile", code: "FORBIDDEN_FIELD" });
  });

  it("keeps the denial even though the attempt itself was rolled back", () => {
    // The point of writing it outside the transaction. If this ever fails, the
    // denial is being swallowed by the same rollback that erases the attempt.
    expect(() => store.createTask(stranger, { projectId: "saha", title: "nope" })).toThrow();

    expect(db.prepare("SELECT COUNT(*) c FROM tasks WHERE title='nope'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM security_audit WHERE code='PROJECT_PERMISSION_REQUIRED'").get())
      .toEqual({ c: 1 });
  });

  it("shows a pattern of probing, which one row could not", () => {
    // The reason this table exists: six refusals from one actor is a signal,
    // and it was previously indistinguishable from silence.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(() => store.createTask(stranger, { projectId: "saha", title: `try ${attempt}` })).toThrow();
    }

    expect(db.prepare("SELECT COUNT(*) c FROM security_audit WHERE actor_id='stranger'").get()).toEqual({ c: 6 });
  });

  it("leaves no half-written card behind when a rule refuses", () => {
    const before = db.prepare("SELECT COUNT(*) c FROM tasks").get();
    expect(() => store.createTask(stranger, { projectId: "saha", title: "nope" })).toThrow(Refused);

    expect(db.prepare("SELECT COUNT(*) c FROM tasks").get()).toEqual(before);
  });
});

describe("bounds on free text", () => {
  it("accepts a brief far beyond anything the transport could carry", () => {
    const id = aTask();
    expect(() => store.updateTask(nikk, id, { description: "x".repeat(90_000) })).not.toThrow();
  });

  it("refuses one that is a denial-of-service rather than a brief", () => {
    // Removing the transport's 2000-character cap was the point of ADR-002.
    // "No limit" is a different claim, and an unbounded TEXT column is a
    // storage and context DoS that every later reader of that board pays for.
    const id = aTask();
    expect(() => store.updateTask(nikk, id, { description: "x".repeat(200_000) }))
      .toThrow(/200,000 characters; the limit is 100,000/);
  });

  it("bounds comments and titles too", () => {
    const id = aTask();
    expect(() => store.addComment(nikk, id, "x".repeat(60_000))).toThrow(/limit is 50,000/);
    expect(() => store.updateTask(nikk, id, { title: "x".repeat(600) })).toThrow(/limit is 500/);
  });
});

describe("the denial log holds metadata, never payloads", () => {
  it("does not record the value that was refused", () => {
    // The log exists to watch for people sending things they must not. Storing
    // the rejected payload would put the hostname, token or credential we
    // refused into the very table we added to catch it.
    store.upsertProfile(nikk, { displayName: "Nikk" });
    expect(() => store.upsertProfile(nikk, { displayName: "Nikk", hostname: "secret-box.internal" })).toThrow();

    const row = db.prepare("SELECT reason FROM security_audit").get() as { reason: string };
    expect(row.reason).toBe("profile carried a field that may never be stored");
    expect(JSON.stringify(row)).not.toContain("secret-box");
  });

  it("derives the reason from the CODE, so no wording change can leak one", () => {
    // Structural rather than conventional: reasonFor() has no access to a
    // payload, so it cannot pass one on however a refusal is phrased.
    const id = aTask();
    expect(() => store.transitionTask(nikk, id, "done")).toThrow(/backlog → done/);

    const row = db.prepare("SELECT code, reason FROM security_audit").get() as { code: string; reason: string };
    expect(row.code).toBe("ILLEGAL_TRANSITION");
    expect(row.reason).toBe("status change is not a legal move");
  });

  it("surfaces a denial it could not write, rather than losing it quietly", () => {
    // A denial log that has stopped recording reads as "nobody has tried
    // anything", which is the most dangerous thing it could say.
    const seen: string[] = [];
    store.onDenialWriteFailure = (_error, context, code) => seen.push(`${context.actorId}:${code}`);
    db.exec("DROP TABLE security_audit");

    expect(() => store.createTask(stranger, { projectId: "saha", title: "nope" })).toThrow();

    expect(seen).toEqual(["stranger:PROJECT_PERMISSION_REQUIRED"]);
  });
});

describe("what was asked, attested by us and not signed", () => {
  it("records a hash and the canonicalization that produced it", () => {
    const id = aTask();
    store.withRequest({ b: 2, a: 1 }, () => store.transitionTask(nikk, id, "assigned"));

    const row = db.prepare(
      "SELECT request, request_hash, canonicalization, attested_by, verification FROM audit WHERE action='transition'",
    ).get() as Record<string, string>;

    // Keys sorted, so the same request serialised differently hashes the same.
    expect(row.request).toBe('{"a":1,"b":2}');
    expect(row.request_hash).toHaveLength(64);
    expect(row.canonicalization).toBe("json-sorted-keys-v1");
    expect(row.attested_by).toBe("saha.ing");
    // The honest word. Nothing here is independently verifiable.
    expect(row.verification).toBe("server-attested");
  });

  it("hashes identically regardless of key order", () => {
    const id = aTask();
    store.withRequest({ a: 1, b: { d: 4, c: 3 } }, () => store.transitionTask(nikk, id, "assigned"));
    store.withRequest({ b: { c: 3, d: 4 }, a: 1 }, () => store.transitionTask(nikk, id, "in_progress"));

    const hashes = (db.prepare("SELECT request_hash FROM audit WHERE action='transition'").all() as Array<{ request_hash: string }>)
      .map((r) => r.request_hash);
    expect(hashes[0]).toBe(hashes[1]);
  });
});
