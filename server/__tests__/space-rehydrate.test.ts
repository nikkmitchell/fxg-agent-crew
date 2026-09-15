import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { AGENT_AT_PANEL_MS, Activity, ATTENTION_MS } from "../space/activity.js";
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
  it("brings an agent back into the room, standing still rather than walking in", () => {
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
    // ALREADY THERE, not on its way. `at` equals `heading`, so the tick loop
    // has nothing to walk: the agent was standing somewhere before the deploy
    // and is standing there after it. Sending it a heading instead would
    // animate a journey that never happened.
    expect(back?.at).toEqual(back?.heading);
    // Rebuilt, so nothing of its own is attached: the broken ring, which is
    // true. A socket is the only thing that makes `connected` true.
    expect(back?.connected).toBe(false);
    // WHERE it stands is decided by how recent the action was — see the two
    // tests below, which is the distinction Sill found missing here.
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

  /**
   * WHERE A FINISHED ACTION LEAVES YOU IS NOT WHERE YOU LIVE.
   *
   * Found by Sill reviewing the first version of this. `sendStaleHome` walks an
   * agent back from a panel by iterating `sentAt` — and that map is empty after
   * a restart, because nothing sent anybody anywhere. So an agent whose last
   * row was "commented on a card" was rebuilt standing at the board, with that
   * reason over its head, and stayed there indefinitely. Exactly the thing Nikk
   * asked us to stop: "you stand at the board for way too long... place your
   * tasks on the board, and then return."
   *
   * It overclaimed in words too. `because` reads as present tense to anyone in
   * the room, and a reason from yesterday asserts a recency that is not there.
   */
  it("rebuilds an agent at home, not at the panel its last action sent it to", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();
    expect(first.presence.find("plumbline")?.heading).toEqual(STATIONS.taskBoard.stand);

    // Long after the action finished — the ordinary case for a restart.
    clock.now += AGENT_AT_PANEL_MS + 60_000;
    const second = start(db, now);
    second.activity.rehydrate();

    const back = second.presence.find("plumbline");
    expect(back?.at).toEqual(deskFor("plumbline"));
    // And it does not claim a reason it no longer has.
    expect(back?.because).toBeNull();
  });

  it("keeps an agent at the panel when the restart lands on a fresh action", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();

    // A deploy seconds after a real action, which is what Sill's deploys are.
    const second = start(db, now);
    second.activity.rehydrate();
    expect(second.presence.find("plumbline")?.at).toEqual(STATIONS.taskBoard.stand);
    expect(second.presence.find("plumbline")?.because).toBeTruthy();

    // And it walks home afterwards like any other agent, rather than standing
    // at the board for good because the restart lost the bookkeeping.
    clock.now += AGENT_AT_PANEL_MS + ATTENTION_MS + 1_000;
    second.activity.step();
    expect(second.presence.find("plumbline")?.heading).toEqual(deskFor("plumbline"));
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

  /**
   * WHERE MY HALF AND SILL'S MEET.
   *
   * Sill's `forgetLongAsleep` drops an agent that has been asleep over an hour
   * with nothing attached — Nikk, looking at two figures on the floor nobody
   * had heard from all day. Rehydration rebuilds every known agent at boot. Put
   * together without this, the room contradicts itself on a schedule: an agent
   * vanishes after an hour and walks back in at the next deploy, which is worse
   * than either behaviour alone. Sill saw it before it shipped and asked whose
   * half it was; it is this one.
   *
   * SO THE TWO USE ONE NUMBER. `Presence.FORGET_SLEEPING_MS` is imported rather
   * than restated, because a second copy of an hour is a second copy that can
   * drift.
   */
  it("does not rebuild an agent that has been gone longer than the room remembers", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();

    // An agent that last did anything well over an hour ago. Sill's tick would
    // remove it immediately, so putting it back would only make it flicker.
    clock.now += Presence.FORGET_SLEEPING_MS + 60_000;
    const second = start(db, now);
    second.activity.rehydrate();

    expect(second.presence.find("plumbline"), "not rebuilt, and not flickering").toBeUndefined();
  });

  it("still rebuilds an agent that has been quiet for less than that", () => {
    const { db, store, projectId } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;

    const first = start(db, now);
    store.createTask(agent("plumbline"), { projectId, title: "t" });
    first.activity.step();

    clock.now += Presence.FORGET_SLEEPING_MS - 60_000;
    const second = start(db, now);
    second.activity.rehydrate();
    second.presence.tick(0);

    expect(second.presence.find("plumbline"), "inside the hour, so still here").toBeDefined();
  });

  /**
   * A NEW AGENT IS NOT AN OLD ONE. It has signed in, said it is an agent, and
   * touched nothing — Lumenfold, for its whole first hour. There is no action
   * to be older than an hour, and treating "never acted" as "long gone" would
   * keep every new agent out of the room until it happened to write to the
   * board. Sill's rule counts its hour from when it joined; so does this.
   */
  it("still rebuilds an agent that has never acted at all", () => {
    const { db } = boot();
    const now = () => Date.now();
    db.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run("newcomer", "agent", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z");

    const server = start(db, now);
    server.activity.rehydrate();
    expect(server.presence.find("newcomer")).toBeDefined();
  });

  /**
   * "HAS IT DONE ANYTHING LATELY" AND "WHERE WAS IT WHEN IT LAST DID SOMETHING
   * THE ROOM CAN DRAW" ARE TWO QUESTIONS, and the first version of the cutoff
   * answered both with one timestamp.
   *
   * Sill found it reading 0811b35. The loop skips a row `destinationFor` does
   * not recognise, so the time it ends up with is the newest MAPPABLE row — not
   * the newest action. `destinationFor` returns null on purpose for anything it
   * has no place for (utterance, screen, home, and `actor`, which is what
   * retiring somebody writes), so that a new entity is never silently sent to
   * the task board.
   *
   * The day somebody audits a new entity without teaching `destinationFor`
   * about it, an agent that has been talking for an hour but last wrote to the
   * board three hours ago is declared long gone and VANISHES WHILE IT IS
   * ACTIVELY WORKING. Sill's rule would keep it; this would drop it — the same
   * disagreement the cutoff exists to remove, pointing the other way.
   *
   * Not live today: Sill checked the real table rather than reasoning about it,
   * and every entity currently on the box maps. This is a trap for a fortnight
   * away, which is exactly when nobody remembers why the room lost somebody.
   */
  it("counts any recent action as life, even one the room cannot draw", () => {
    const { db } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;
    const iso = (ms: number) => new Date(ms).toISOString();

    db.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run("chatty", "agent", iso(clock.now), iso(clock.now));

    const write = (entity: string, action: string, at: number) =>
      db.prepare(
        `INSERT INTO audit (at, actor_id, action, entity, entity_id, verification)
         VALUES (?,?,?,?,?,'server-attested')`,
      ).run(iso(at), "chatty", action, entity, "x");

    // Last touched the board three hours ago...
    write("task", "create", clock.now - 3 * 60 * 60_000);
    // ...but said something a minute ago. `utterance` has no destination, by
    // design, so the old loop never looked at its timestamp.
    write("utterance", "create", clock.now - 60_000);

    const server = start(db, now);
    server.activity.rehydrate();

    expect(
      server.presence.find("chatty"),
      "talking is being alive, even when the room cannot draw where you did it",
    ).toBeDefined();
  });

  it("still places that agent by the last thing the room CAN draw", () => {
    const { db } = boot();
    const clock = { now: Date.now() };
    const now = () => clock.now;
    const iso = (ms: number) => new Date(ms).toISOString();

    db.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run("chatty", "agent", iso(clock.now), iso(clock.now));
    const write = (entity: string, action: string, at: number) =>
      db.prepare(
        `INSERT INTO audit (at, actor_id, action, entity, entity_id, verification)
         VALUES (?,?,?,?,?,'server-attested')`,
      ).run(iso(at), "chatty", action, entity, "x");

    write("task", "create", clock.now - 3 * 60 * 60_000);
    write("utterance", "create", clock.now - 60_000);

    const server = start(db, now);
    server.activity.rehydrate();

    // Kept BY the utterance, placed BY the board row — and since that row is
    // hours old it stands at home rather than at the panel, wearing no reason.
    const back = server.presence.find("chatty");
    expect(back?.at).toEqual(deskFor("chatty"));
    expect(back?.because).toBeNull();
  });
});
