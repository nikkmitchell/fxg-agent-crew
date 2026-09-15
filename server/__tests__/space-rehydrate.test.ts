import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { Activity } from "../space/activity.js";
import { Presence } from "../space/presence.js";
import { STATIONS, deskFor } from "../../shared/space-layout.js";

/**
 * THE ROOM AFTER A RESTART.
 *
 * Presence lives in the server process, so a deploy empties the room. People
 * and headsets reconnect by themselves and come straight back. An agent does
 * not: it arrives by declaring itself once, works quietly, and is simply gone
 * the next time anybody looks — with no way of noticing.
 *
 * Nikk, twice in one afternoon: "Plumbline join the room why can I not see you
 * in the room". The first time I had never declared myself. The second time I
 * had, and a deploy had erased it. Sill deploys many times a day, so every
 * agent silently falls out of the room several times an afternoon, and the room
 * shows them as absent — and absent is a claim.
 *
 * THE ASYMMETRY IS THE WHOLE DESIGN, and it is Sill's: agents are rebuilt,
 * people are never. Where somebody stood before a restart is not where they
 * are; redrawing them is not staleness but invention, and it would show a
 * person who has walked away still standing there attentively. An empty spot is
 * the truth. An agent's position was never observed in the first place — it is
 * derived from the audit trail — so rebuilding it invents nothing at all.
 * Forgetting something you can still derive is not honesty, only loss.
 */

/**
 * THE ROOM'S CLOCK AND THE AUDIT TABLE'S CLOCK ARE THE SAME CLOCK, and these
 * tests start from `Date.now()` rather than a tidy 1_000_000 to keep it that
 * way. `BoardStore` stamps each audit row with the real wall clock, and
 * rehydration reads that stamp back to decide whether an agent has been busy
 * recently. A fake clock starting in 1970 makes every real row look like the
 * distant future, and every rebuilt agent look wide awake — which is the
 * opposite of the bug, and would have passed while hiding it.
 */
const human = (id: string) => ({ id, kind: "human" as const });
const agent = (id: string) => ({ id, kind: "agent" as const });

/** A database with one project, one agent, and one person who have both acted. */
function boot() {
  const db = openDatabase(":memory:", DatabaseSync);
  const store = new BoardStore(db);
  const projectId = store.createProject(human("nikk"), { name: "p" });
  store.actOnMembership(human("nikk"), projectId, "plumbline", "grant", ["maker"]);
  return { db, store, projectId };
}

/** Everything the real server builds at boot, in the order server/index.ts does. */
function start(db: DatabaseSync, now: () => number) {
  const presence = new Presence(now);
  const activity = new Activity(db, presence, now);
  activity.catchUp();
  return { presence, activity };
}

describe("the room after a restart", () => {
  it("brings an agent back to the place its own last action derived", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    // Before the restart: the agent writes to the board, which is what moves it.
    const first = start(db, now);
    const task = store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();
    expect(first.presence.find("plumbline")?.heading).toEqual(STATIONS.taskBoard.stand);

    // The deploy. A brand new process: nothing carries over but the database.
    clock.now += 30_000;
    const second = start(db, now);

    second.activity.rehydrate();

    const back = second.presence.find("plumbline");
    expect(back, "the agent is in the room again").toBeDefined();
    expect(back?.kind).toBe("agent");
    // Standing there already, not walking across the room from its desk: this
    // is where it was, not a journey it is making now.
    expect(back?.at).toEqual(STATIONS.taskBoard.stand);
    expect(back?.heading).toEqual(STATIONS.taskBoard.stand);
    // And the room can still say WHY it is standing there.
    expect(back?.because).toBeTruthy();
    expect(task).toBeTruthy();
  });

  it("never brings a person back, however recently they acted", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(human("nikk"), { projectId, title: "t" });
    first.activity.step();
    expect(first.presence.find("nikk")).toBeDefined();

    clock.now += 30_000;
    const second = start(db, now);
    second.activity.rehydrate();

    // Where nikk stood a moment ago is not where nikk IS. Only their own
    // headset can say that, and it will the moment it reconnects.
    expect(second.presence.find("nikk"), "a person is not invented").toBeUndefined();
  });

  it("puts an agent that has never acted at its desk rather than nowhere", () => {
    const { db } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    // Known to be an agent, but with nothing in the audit trail: signed in and
    // has not touched the board yet. Lumenfold, for most of its first hour.
    db.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run("lumenfold", "agent", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z");

    const server = start(db, now);
    server.activity.rehydrate();

    const back = server.presence.find("lumenfold");
    expect(back, "a known agent is in the room even with no history").toBeDefined();
    expect(back?.at).toEqual(deskFor("lumenfold"));
  });

  it("does not claim a rebuilt agent has just acted", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();

    // Long enough that the agent should read as asleep, not as busy.
    clock.now += 6 * 60_000;
    const second = start(db, now);
    second.activity.rehydrate();
    second.presence.tick(0);

    // `sendTo` stamps lastActed with the current time, which after a restart
    // would say every agent in the building had just done something. The room
    // would show a night's worth of idle agents all thinking hard.
    expect(second.presence.find("plumbline")?.avatar.posture).not.toBe("thinking");
  });

  it("leaves a person who is already connected exactly where they are", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();

    clock.now += 30_000;
    const second = start(db, now);
    // A headset reconnects before the rebuild finishes — the ordinary case
    // after a deploy, since a browser retries within seconds.
    second.presence.join("nikk", "human");
    second.presence.moveSelf("nikk", { x: 2, y: 0, z: 2 }, 1.2);

    second.activity.rehydrate();

    expect(second.presence.find("nikk")?.at).toEqual({ x: 2, y: 0, z: 2 });
  });
});
