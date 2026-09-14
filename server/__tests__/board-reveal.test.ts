import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { BoardReads } from "../db/reads.js";
import { Activity } from "../space/activity.js";
import { Presence } from "../space/presence.js";
import { REVEAL_CAP_MS } from "../../shared/board-freshness.js";

/**
 * Nikk: "make sure that the task board changes happen when they reach the
 * board". A card an agent moves is shown moved when the agent gets there.
 */
const boot = () => {
  const db = openDatabase(":memory:", DatabaseSync);
  let clock = 1_000_000;
  const presence = new Presence(() => clock);
  const activity = new Activity(db, presence, () => clock);
  activity.catchUp();
  const store = new BoardStore(db);
  const reads = new BoardReads(db);
  const nikk = { id: "nikk", kind: "human" as const };
  const projectId = store.createProject(nikk, { name: "p" });
  store.actOnMembership(nikk, projectId, "Plumbline", "grant", ["maker"]);
  const lastChange = (taskId: string) => reads.project(projectId)!.tasks.find((t) => t.id === taskId)!.lastChange!;
  return { db, store, presence, activity, projectId, nikk, lastChange, tick: (ms: number) => { clock += ms; } };
};

describe("a card change waits for its agent", () => {
  it("is held while the agent walks, and shown the moment it arrives", () => {
    const { store, presence, activity, projectId, lastChange, tick } = boot();
    presence.join("nikk2", "human", true); // somebody is in the room to see it
    presence.join("Plumbline", "agent", false);
    const taskId = store.createTask({ id: "Plumbline", kind: "agent" }, { projectId, title: "a card" });
    activity.step();
    const change = lastChange(taskId);
    expect(activity.revealAt(change.auditId, change.at), "still walking").toBeNull();

    tick(4_000);
    const plumbline = presence.find("Plumbline")!;
    plumbline.at = { ...plumbline.heading }; // arrives
    activity.step();
    const shown = activity.revealAt(change.auditId, change.at);
    expect(shown).not.toBeNull();
    expect(Date.parse(shown!)).toBe(1_004_000);
  });

  it("shows a person's change straight away — people move themselves", () => {
    const { store, activity, projectId, nikk, lastChange } = boot();
    const taskId = store.createTask(nikk, { projectId, title: "mine" });
    activity.step();
    const change = lastChange(taskId);
    expect(activity.revealAt(change.auditId, change.at)).toBe(change.at);
  });

  it("never holds a change longer than the cap, if the agent never arrives", () => {
    const { store, presence, activity, projectId, lastChange, tick } = boot();
    presence.join("nikk2", "human", true);
    presence.join("Plumbline", "agent", false);
    const taskId = store.createTask({ id: "Plumbline", kind: "agent" }, { projectId, title: "a card" });
    activity.step();
    const change = lastChange(taskId);
    tick(REVEAL_CAP_MS + 1);
    expect(activity.revealAt(change.auditId, change.at)).not.toBeNull();
  });

  it("is not held when nobody has the room open, since nobody would see the walk", () => {
    const { store, presence, activity, projectId, lastChange } = boot();
    presence.join("Plumbline", "agent", true); // an agent watching is not a person looking
    const taskId = store.createTask({ id: "Plumbline", kind: "agent" }, { projectId, title: "a card" });
    activity.step();
    const change = lastChange(taskId);
    expect(activity.revealAt(change.auditId, change.at)).toBe(change.at);
  });

  it("remembers where a moved card came from, to draw it there until then", () => {
    const { store, projectId, nikk, lastChange } = boot();
    const taskId = store.createTask(nikk, { projectId, title: "moving" });
    store.transitionTask(nikk, taskId, "assigned");
    expect(lastChange(taskId).previousStatus).toBe("backlog");
  });
});
