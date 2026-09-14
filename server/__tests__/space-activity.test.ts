import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { AGENT_AT_PANEL_MS, Activity, ATTENTION_MS } from "../space/activity.js";
import { destinationFor, restingPlace } from "../space/destinations.js";
import { Presence } from "../space/presence.js";
import { STATIONS, deskFor } from "../../shared/space-layout.js";

/**
 * Movement derived from what actually happened.
 *
 * The mapping is the part of this room that can lie, so it is tested against
 * rows written by the REAL BoardStore rather than hand-made ones. A test that
 * invents its own audit rows proves the mapping agrees with the test author,
 * not with the code that writes the table — and the action names are exactly
 * the kind of thing that drifts.
 */

const boot = () => {
  const db = openDatabase(":memory:", DatabaseSync);
  const store = new BoardStore(db);
  const presence = new Presence();
  let clock = 1_000_000;
  const activity = new Activity(db, presence, () => clock);
  activity.catchUp();
  return { db, store, presence, activity, tick: (ms: number) => { clock += ms; } };
};

const human = (id: string) => ({ id, kind: "human" as const });

/** A project nikk manages, with `also` able to work in it. */
const project = (store: BoardStore, also?: string) => {
  const id = store.createProject(human("nikk"), { name: "p" });
  if (also) store.actOnMembership(human("nikk"), id, also, "grant", ["maker"]);
  return id;
};

describe("where an action sends you", () => {
  it("sends a card action to the task board", () => {
    for (const action of ["comment", "transition", "create", "update", "claim", "accept"]) {
      const destination = destinationFor({ id: 1, actorId: "a", action, entity: "task", entityId: "t" });
      expect(destination?.at, action).toEqual(STATIONS.taskBoard.stand);
      expect(destination?.because, action).toBeTruthy();
    }
  });

  it("sends mood board work to the mood wall and access work to the people corner", () => {
    expect(destinationFor({ id: 1, actorId: "a", action: "add", entity: "board_item", entityId: "i" })?.at)
      .toEqual(STATIONS.moodBoard.stand);
    expect(destinationFor({ id: 1, actorId: "a", action: "grant", entity: "membership", entityId: "m" })?.at)
      .toEqual(STATIONS.people.stand);
  });

  it("faces task and mood panels after arriving", () => {
    const task = destinationFor({ id: 1, actorId: "a", action: "create", entity: "task", entityId: "t" });
    const mood = destinationFor({ id: 2, actorId: "a", action: "add", entity: "board_item", entityId: "i" });
    expect(task?.facing).toBeCloseTo(STATIONS.taskBoard.surface.rotationY, 6);
    expect(mood?.facing).toBeCloseTo(STATIONS.moodBoard.surface.rotationY, 6);
  });

  it("sends a profile edit to that person's own desk, not to a shared wall", () => {
    const destination = destinationFor({ id: 1, actorId: "Plumbline", action: "update", entity: "profile", entityId: "Plumbline" });
    expect(destination?.at).toEqual(deskFor("Plumbline"));
  });

  it("refuses to guess for an action it does not recognise", () => {
    // A default destination would look completely normal and be an invention.
    expect(destinationFor({ id: 1, actorId: "a", action: "exploded", entity: "spaceship", entityId: "x" })).toBeNull();
  });

  it("says nothing rather than 'idle' when there is no recent evidence", () => {
    expect(restingPlace("Plumbline")).toEqual({ at: deskFor("Plumbline"), facing: null, because: null });
  });
});

describe("reading the audit table", () => {
  it("starts at the end, so a restart does not replay months of work", () => {
    const { db, store, presence } = boot();
    const projectId = project(store, "Plumbline");
    const taskId = store.createTask(human("Plumbline"), { projectId, title: "old work" });
    store.addComment(human("Plumbline"), taskId, "done ages ago");

    // A second Activity booting now must not march anybody through all that.
    const fresh = new Activity(db, presence);
    fresh.catchUp();
    expect(fresh.step()).toBe(0);
    expect(presence.size).toBe(0);
  });

  it("moves the actor who actually did the thing", () => {
    const { store, activity, presence } = boot();
    const projectId = project(store, "Plumbline");
    const taskId = store.createTask(human("Plumbline"), { projectId, title: "a card" });
    store.addComment(human("Plumbline"), taskId, "a comment");

    expect(activity.step()).toBeGreaterThan(0);
    const plumbline = presence.find("Plumbline");
    expect(plumbline?.heading).toEqual(STATIONS.taskBoard.stand);
    expect(plumbline?.because).toBe("commented on a card");
    // And the sentence describes the action, never its contents.
    expect(plumbline?.because).not.toContain("a comment");
  });

  it("does not create a second body when audit and room spell one person differently", () => {
    const { store, activity, presence } = boot();
    presence.join("nikk2", "human", true);
    presence.moveSelf("nikk2", { x: 2, y: 0, z: 2 }, 0);

    store.createProject(human("Nikk2"), { name: "same person, different case" });
    activity.step();

    expect(presence.size).toBe(1);
    expect(presence.find("Nikk2")).toBe(presence.find("nikk2"));
    expect(presence.everyone()[0]).toMatchObject({
      actorId: "nikk2",
      at: { x: 2, y: 0, z: 2 },
      because: null,
    });
  });

  it("moves a real mood-board writer to the mood board", () => {
    const { store, activity, presence } = boot();
    const projectId = project(store, "Inkstone");
    const boardId = store.createBoard({ id: "Inkstone", kind: "agent" }, projectId, "Direction");
    store.addBoardItem({ id: "Inkstone", kind: "agent" }, boardId, {
      kind: "note",
      text: "Quiet materials",
    });

    activity.step();
    expect(presence.find("Inkstone")?.heading).toEqual(STATIONS.moodBoard.stand);
    expect(presence.find("Inkstone")?.because).toBe("pinned something up");
  });

  it("moves an explicit authenticated read to the requested surface", () => {
    const { activity, presence } = boot();
    activity.observeRead("Inkstone", "agent", "tasks");
    expect(presence.find("Inkstone")?.heading).toEqual(STATIONS.taskBoard.stand);
    expect(presence.find("Inkstone")?.because).toBe("was checking tasks");

    activity.observeRead("Inkstone", "agent", "mood");
    expect(presence.find("Inkstone")?.heading).toEqual(STATIONS.moodBoard.stand);
    expect(presence.find("Inkstone")?.because).toBe("was considering the mood board");
  });

  it("does not replay a row twice", () => {
    const { store, activity } = boot();
    const projectId = project(store);
    store.createTask(human("nikk"), { projectId, title: "t" });

    const first = activity.step();
    expect(first).toBeGreaterThan(0);
    expect(activity.step()).toBe(0);
  });

  it("never puts the migration actor in the room", () => {
    const { db, activity, presence } = boot();
    db.prepare(
      "INSERT INTO audit (at, actor_id, action, entity, entity_id) VALUES (?,?,?,?,?)",
    ).run(new Date().toISOString(), "import", "create", "task", "t1");

    activity.step();
    expect(presence.find("import")).toBeUndefined();
  });

  it("places people with the kind the database already knows", () => {
    const { store, activity, presence } = boot();
    const projectId = project(store, "Plumbline");
    const taskId = store.createTask(human("nikk"), { projectId, title: "t" });
    // Plumbline is recorded as an agent; comment as one.
    store.addComment({ id: "Plumbline", kind: "agent" }, taskId, "hello");
    activity.step();

    // Passing null here drew "kind unknown" under an actor the actors table
    // knows perfectly well — an invented unknown, which makes the dashed
    // outline meaningless for the actors who genuinely have never declared one.
    expect(presence.find("Plumbline")?.kind).toBe("agent");
  });

  it("walks somebody back to their desk once the reason goes cold", () => {
    const { store, activity, presence, tick } = boot();
    const projectId = project(store, "Plumbline");
    const taskId = store.createTask(human("Plumbline"), { projectId, title: "t" });
    store.addComment(human("Plumbline"), taskId, "hello");
    activity.step();
    expect(presence.find("Plumbline")?.heading).toEqual(STATIONS.taskBoard.stand);

    tick(ATTENTION_MS + 1);
    activity.step();
    const plumbline = presence.find("Plumbline");
    expect(plumbline?.heading).toEqual(deskFor("Plumbline"));
    // "No recent evidence", not "idle".
    expect(plumbline?.because).toBeNull();
  });

  it("walks an AGENT home a few seconds after it reaches the board, not two minutes later", () => {
    // Nikk: "you should just go up to the board, place your tasks on the
    // board, and then return" — to its own space, where its screen shows.
    const { store, activity, presence, tick } = boot();
    const agent = { id: "Plumbline", kind: "agent" as const };
    const projectId = project(store, "Plumbline");
    store.createTask(agent, { projectId, title: "a card" });
    activity.step();
    const plumbline = presence.find("Plumbline")!;
    expect(plumbline.heading).toEqual(STATIONS.taskBoard.stand);

    // Still walking over: however long that takes, it is not sent back mid-walk.
    tick(AGENT_AT_PANEL_MS * 2);
    activity.step();
    expect(plumbline.heading).toEqual(STATIONS.taskBoard.stand);

    // Arrives, and stays long enough to be seen there.
    plumbline.at = { ...plumbline.heading };
    activity.step();
    tick(AGENT_AT_PANEL_MS - 1000);
    activity.step();
    expect(plumbline.heading, "not yet").toEqual(STATIONS.taskBoard.stand);

    tick(1001);
    activity.step();
    expect(plumbline.heading).toEqual(deskFor("Plumbline"));
    expect(plumbline.because).toBeNull();
  });

  it("starts the count again for each further thing the agent does at the board", () => {
    const { store, activity, presence, tick } = boot();
    const agent = { id: "Plumbline", kind: "agent" as const };
    const projectId = project(store, "Plumbline");
    store.createTask(agent, { projectId, title: "first" });
    activity.step();
    const plumbline = presence.find("Plumbline")!;
    plumbline.at = { ...plumbline.heading };
    activity.step();
    tick(AGENT_AT_PANEL_MS - 1000);
    store.createTask(agent, { projectId, title: "second" });
    activity.step();
    tick(2000);
    activity.step();
    expect(plumbline.heading, "still placing its second card").toEqual(STATIONS.taskBoard.stand);
  });

  it("sends an agent home even while it holds a socket open to watch the room", () => {
    // `connected` used to exempt it, so an agent watching the room stayed at
    // the board indefinitely.
    const { store, activity, presence, tick } = boot();
    const agent = { id: "Sill", kind: "agent" as const };
    const projectId = project(store, "Sill");
    presence.join("Sill", "agent", true);
    store.createTask(agent, { projectId, title: "a card" });
    activity.step();
    const sill = presence.find("Sill")!;
    expect(sill.heading).toEqual(STATIONS.taskBoard.stand);
    sill.at = { ...sill.heading };
    activity.step();
    tick(AGENT_AT_PANEL_MS + 1);
    activity.step();
    expect(sill.heading).toEqual(deskFor("Sill"));
  });

  it("does not drag a person who is driving their own avatar", () => {
    const { store, activity, presence, tick } = boot();
    const projectId = project(store);
    const taskId = store.createTask(human("nikk"), { projectId, title: "t" });
    store.addComment(human("nikk"), taskId, "hello");
    activity.step();

    // nikk opens the room and walks somewhere of their own accord.
    presence.join("nikk", "human", true);
    presence.moveSelf("nikk", { x: 2, y: 0, z: 2 }, 0);

    tick(ATTENTION_MS + 1);
    activity.step();
    const nikk = presence.find("nikk");
    expect(nikk?.at).toEqual({ x: 2, y: 0, z: 2 });
    // The HEADING is the assertion that matters. `presence.tick` already
    // refuses to step a connected occupant, so checking only `at` passes even
    // with this guard deleted — it is the other guard doing the work. A stale
    // heading would send them marching to a desk the moment they disconnected,
    // and would meanwhile label them with a reason they are not there for.
    expect(nikk?.heading).toEqual({ x: 2, y: 0, z: 2 });
  });
});
