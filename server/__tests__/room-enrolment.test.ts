import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";

/**
 * Being in the room is the claim to that room's board — and the four things
 * that claim must never become.
 *
 * Every new agent here hit PROJECT_PERMISSION_REQUIRED on its first card, so
 * membership was a list a manager had to remember to mirror. The fix is a link
 * a manager writes down once. The risk of the fix is that it becomes a way to
 * acquire authority nobody granted, which is the exact thing store.ts refuses
 * everywhere else, so each refusal is asserted here rather than described.
 */

let db: ReturnType<typeof openDatabase>;
let store: BoardStore;

const nikk = { id: "nikk", kind: "human" as const };

const link = (projectId: string, room: string, options: {
  auto?: boolean; roles?: string[];
} = {}) => {
  db.prepare(`INSERT INTO project_rooms (project_id, room, auto_enrol, roles, linked_by, linked_at)
              VALUES (?,?,?,?,?,datetime('now'))`)
    .run(projectId, room, options.auto === false ? 0 : 1,
         JSON.stringify(options.roles ?? []), "nikk");
};

const membership = (projectId: string, actorId: string) =>
  db.prepare("SELECT roles, active, granted_by FROM memberships WHERE project_id=? AND actor_id=?")
    .get(projectId, actorId) as { roles: string; active: number; granted_by: string } | undefined;

beforeEach(() => {
  db = openDatabase(":memory:", DatabaseSync);
  store = new BoardStore(db);
  // A second project, so the seeded saha-ing link cannot be what makes a test pass.
  store.createProject(nikk, { id: "lantern", name: "Lantern" });
});

describe("enrolling from a room", () => {
  it("lets somebody in the linked room card work, which is the whole point", () => {
    link("lantern", "lantern.room");
    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual(["lantern"]);
    expect(() => store.createTask({ id: "Nightjar", kind: "agent" }, {
      projectId: "lantern", title: "A card I could not file yesterday",
    })).not.toThrow();
  });

  it("records the ROOM as the grantor, so a manager can see what nobody chose", () => {
    link("lantern", "lantern.room");
    store.enrolFromRoom("Nightjar", "lantern.room", "agent");
    expect(membership("lantern", "Nightjar")?.granted_by).toBe("room:lantern.room");
  });

  it("does nothing for a room no project is linked to", () => {
    expect(store.enrolFromRoom("Nightjar", "some.other.room", "agent")).toEqual([]);
    expect(membership("lantern", "Nightjar")).toBeUndefined();
  });

  it("does nothing when the link exists but auto_enrol is off", () => {
    link("lantern", "lantern.room", { auto: false });
    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual([]);
    expect(membership("lantern", "Nightjar")).toBeUndefined();
  });

  /**
   * THE ESCALATION THIS WOULD OTHERWISE BE. A room-linked grant that could hand
   * out 'manager' would let anybody who joins a public room take over who
   * belongs to the project — the same side door store.ts closes when the last
   * manager is revoked. They still get in; they get in with no roles at all.
   */
  it("never grants manager, even when the link row asks for it", () => {
    link("lantern", "lantern.room", { roles: ["manager"] });
    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual(["lantern"]);
    expect(JSON.parse(membership("lantern", "Nightjar")!.roles)).toEqual([]);
  });

  it("keeps the ordinary roles of a mixed link and drops the manager half", () => {
    link("lantern", "lantern.room", { roles: ["manager", "testing"] });
    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual(["lantern"]);
    expect(JSON.parse(membership("lantern", "Nightjar")!.roles)).toEqual(["testing"]);
  });

  /**
   * A REMOVAL THAT LASTS UNTIL THE NEXT SIGN-IN IS NOT A REMOVAL. Whoever
   * revoked a membership did so knowing the agent is still in the room, so the
   * room must not undo it.
   */
  it("leaves a revoked membership revoked", () => {
    link("lantern", "lantern.room");
    store.enrolFromRoom("Nightjar", "lantern.room", "agent");
    store.actOnMembership(nikk, "lantern", "Nightjar", "revoke");

    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual([]);
    expect(membership("lantern", "Nightjar")?.active).toBe(0);
  });

  it("does not widen a membership somebody already has", () => {
    link("lantern", "lantern.room", { roles: ["testing"] });
    store.actOnMembership(nikk, "lantern", "Plumbline", "grant", ["manager"]);
    expect(store.enrolFromRoom("Plumbline", "lantern.room", "agent")).toEqual([]);
    expect(JSON.parse(membership("lantern", "Plumbline")!.roles)).toEqual(["manager"]);
  });

  it("is quiet on every sign-in after the first", () => {
    link("lantern", "lantern.room");
    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual(["lantern"]);
    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent")).toEqual([]);
  });

  it("enrols into every project linked to the same room, and only those", () => {
    store.createProject(nikk, { id: "second", name: "Second" });
    store.createProject(nikk, { id: "elsewhere", name: "Elsewhere" });
    link("lantern", "lantern.room");
    link("second", "lantern.room");
    link("elsewhere", "different.room");

    expect(store.enrolFromRoom("Nightjar", "lantern.room", "agent").sort())
      .toEqual(["lantern", "second"]);
    expect(membership("elsewhere", "Nightjar")).toBeUndefined();
  });

  it("ships with saha-ing linked to saha.ing and on, because that was asked for", () => {
    const row = db.prepare("SELECT room, auto_enrol FROM project_rooms WHERE project_id='saha-ing'")
      .get() as { room: string; auto_enrol: number } | undefined;
    expect(row).toEqual({ room: "saha.ing", auto_enrol: 1 });
  });
});
