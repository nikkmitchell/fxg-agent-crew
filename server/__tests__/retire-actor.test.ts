import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { Activity } from "../space/activity.js";
import { Presence } from "../space/presence.js";
import { ShareKeys } from "../space/screens.js";

/**
 * RETIRING AN ACTOR, WHICH IS NOT DELETING ONE.
 *
 * Renaming an agent leaves its old identity behind. saha.ing takes an actor id
 * straight from whatever WebHarness calls you, so `claude-nikk2mbp` and
 * `Plumbline` are two rows describing one worker. Since agents are rebuilt into
 * the room at every restart, the abandoned one now stands there permanently:
 * Nikk had two of me in his room, one of which had done nothing since 14:30.
 *
 * THE DISTINCTION THIS FILE EXISTS TO HOLD:
 *
 *   kept    — audit rows, cards, comments, memberships. What an actor did is
 *             true, and stays true. This project does not rewrite who did what.
 *   stopped — drawn in the room, offered for screen sharing, counted present.
 *
 * "This agent is here" becomes "this agent was here and is not any more". Both
 * are honest claims. DELETING the row would make a third claim — that the work
 * never happened — and that is the one nobody should be able to make by
 * accident while tidying up a duplicate.
 *
 * Reversible on purpose: "I was wrong about that" has to be expressible too.
 */

const human = (id: string) => ({ id, kind: "human" as const });
const agent = (id: string) => ({ id, kind: "agent" as const });

function boot() {
  const db = openDatabase(":memory:", DatabaseSync);
  const store = new BoardStore(db);
  const projectId = store.createProject(human("nikk"), { name: "p" });
  store.actOnMembership(human("nikk"), projectId, "claude-nikk2mbp", "grant", ["maker"]);
  store.actOnMembership(human("nikk"), projectId, "plumbline", "grant", ["maker"]);
  return { db, store, projectId };
}

describe("retiring an actor", () => {
  it("keeps every trace of what the actor did", () => {
    const { db, store, projectId } = boot();
    const taskId = store.createTask(agent("claude-nikk2mbp"), { projectId, title: "a real card" });
    const auditBefore = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE actor_id = ?")
      .get("claude-nikk2mbp") as { n: number };
    expect(auditBefore.n).toBeGreaterThan(0);

    store.retireActor(human("nikk"), "claude-nikk2mbp");

    // The card is still there, still theirs, still readable.
    expect(db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId)).toBeTruthy();
    // The history is untouched — this is the whole point of retiring rather
    // than deleting, and the assertion that must never be relaxed.
    const auditAfter = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE actor_id = ?")
      .get("claude-nikk2mbp") as { n: number };
    expect(auditAfter.n).toBeGreaterThanOrEqual(auditBefore.n);
    // And the actor row survives, so nothing that points at it dangles.
    expect(db.prepare("SELECT id FROM actors WHERE id = ?").get("claude-nikk2mbp")).toBeTruthy();
  });

  it("writes its own audit row, because retiring somebody is an act", () => {
    const { db, store } = boot();
    store.retireActor(human("nikk"), "claude-nikk2mbp");
    const row = db
      .prepare("SELECT actor_id AS actorId, action, entity, entity_id AS entityId FROM audit WHERE action = 'retire'")
      .get() as { actorId: string; action: string; entity: string; entityId: string } | undefined;
    expect(row, "a retirement is recorded like any other change").toBeDefined();
    expect(row?.actorId).toBe("nikk");
    expect(row?.entityId).toBe("claude-nikk2mbp");
  });

  it("stops the actor being rebuilt into the room", () => {
    const { db, store, projectId } = boot();
    const now = () => Date.now();
    store.createTask(agent("claude-nikk2mbp"), { projectId, title: "t" });
    store.createTask(agent("plumbline"), { projectId, title: "t2" });

    const before = new Presence(now);
    const beforeActivity = new Activity(db, before, now);
    beforeActivity.catchUp();
    beforeActivity.rehydrate();
    expect(before.find("claude-nikk2mbp"), "present before retiring").toBeDefined();

    store.retireActor(human("nikk"), "claude-nikk2mbp");

    const after = new Presence(now);
    const afterActivity = new Activity(db, after, now);
    afterActivity.catchUp();
    afterActivity.rehydrate();

    expect(after.find("claude-nikk2mbp"), "not drawn in the room any more").toBeUndefined();
    // The live identity is untouched: retiring one is not retiring the worker.
    expect(after.find("plumbline"), "the agent that is still working stays").toBeDefined();
  });

  it("stops the actor being offered as somebody to share a screen for", () => {
    const { db, store } = boot();
    const keys = new ShareKeys(db, () => Date.now());
    store.ensureActor("claude-nikk2mbp", "agent");
    store.ensureActor("plumbline", "agent");
    expect(keys.agents()).toContain("claude-nikk2mbp");

    store.retireActor(human("nikk"), "claude-nikk2mbp");

    expect(keys.agents(), "a retired agent is not offered").not.toContain("claude-nikk2mbp");
    expect(keys.agents()).toContain("plumbline");
  });

  it("can be undone, because being wrong about it must be expressible", () => {
    const { db, store, projectId } = boot();
    const now = () => Date.now();
    store.createTask(agent("claude-nikk2mbp"), { projectId, title: "t" });

    store.retireActor(human("nikk"), "claude-nikk2mbp");
    store.unretireActor(human("nikk"), "claude-nikk2mbp");

    const presence = new Presence(now);
    const activity = new Activity(db, presence, now);
    activity.catchUp();
    activity.rehydrate();
    expect(presence.find("claude-nikk2mbp"), "back in the room").toBeDefined();
  });

  /**
   * ASSERTS THE REFUSAL, NOT MERELY A THROW. While `retireActor` did not exist
   * yet, this test passed — a missing method throws a TypeError, and `toThrow()`
   * cannot tell that from a considered refusal. It was green for the entire
   * time the feature was unwritten. A test that passes before the code exists
   * is not protecting anything, and it is the same family as reporting "six
   * runs" for six runs that all left by the same door.
   */
  it("refuses an actor that does not exist, rather than doing nothing quietly", () => {
    const { store } = boot();
    expect(() => store.retireActor(human("nikk"), "nobody-by-that-name"))
      .toThrowError(expect.objectContaining({ name: "Refused", code: "NOT_FOUND" }));
  });

  it("is quietly idempotent: retiring twice is not an error", () => {
    const { db, store } = boot();
    store.ensureActor("claude-nikk2mbp", "agent");
    store.retireActor(human("nikk"), "claude-nikk2mbp");
    const first = db.prepare("SELECT retired_at FROM actors WHERE id = ?")
      .get("claude-nikk2mbp") as { retired_at: string };

    expect(() => store.retireActor(human("nikk"), "claude-nikk2mbp")).not.toThrow();

    // The SECOND call changes nothing — including the date, which would
    // otherwise drift forward every time somebody ran the tool and quietly
    // rewrite when this actor actually stopped being present.
    const second = db.prepare("SELECT retired_at FROM actors WHERE id = ?")
      .get("claude-nikk2mbp") as { retired_at: string };
    expect(second.retired_at).toBe(first.retired_at);
    // And it does not write a second audit row claiming it happened twice.
    const rows = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'retire'").get() as { n: number };
    expect(rows.n).toBe(1);
  });
});
