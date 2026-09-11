import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { readSurfaces } from "../space/surfaces.js";
import { LANES } from "../../shared/space-surfaces.js";

/**
 * What is hanging on the walls.
 *
 * A projection of the board, so the thing worth testing is that it projects
 * rather than invents: the right cards in the right lanes, the arrangement of a
 * mood board preserved, and nothing filled in where the board has nothing.
 */

const nikk = { id: "nikk", kind: "human" as const };

const boot = () => {
  const db = openDatabase(":memory:", DatabaseSync);
  return { db, store: new BoardStore(db) };
};

describe("reading the walls", () => {
  it("says there is nothing rather than inventing a project", () => {
    const { db } = boot();
    const surfaces = readSurfaces(db);
    expect(surfaces.projectId).toBeNull();
    expect(surfaces.cards).toEqual([]);
    expect(surfaces.boards).toEqual([]);
  });

  it("follows the CARDS, not the project row, when picking a default", () => {
    const { db, store } = boot();
    const dormant = store.createProject(nikk, { id: "aaa", name: "Alphabetically first" });
    const busy = store.createProject(nikk, { id: "zzz", name: "Actually being worked on" });
    store.createTask(nikk, { projectId: dormant, title: "done months ago" });

    // Make the busy project's newest card genuinely newer.
    const card = store.createTask(nikk, { projectId: busy, title: "todays work" });
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run("2099-01-01T00:00:00.000Z", card);

    // `projects.updated_at` never moved for either, so anything reading that
    // column alone would still be picking between two identical timestamps.
    expect(readSurfaces(db).projectId).toBe(busy);
  });

  it("falls back to a real project when asked for one that does not exist", () => {
    const { db, store } = boot();
    const id = store.createProject(nikk, { name: "p" });
    // An empty wall and a wall for a project that is not there look identical.
    expect(readSurfaces(db, "no-such-project").projectId).toBe(id);
  });

  it("puts each card in the lane its status says", () => {
    const { db, store } = boot();
    const projectId = store.createProject(nikk, { name: "p" });
    const a = store.createTask(nikk, { projectId, title: "first" });
    const b = store.createTask(nikk, { projectId, title: "second" });
    store.transitionTask(nikk, b, "assigned");
    store.transitionTask(nikk, b, "in_progress");

    const { cards } = readSurfaces(db, projectId);
    expect(cards.find((card) => card.id === a)?.status).toBe("backlog");
    expect(cards.find((card) => card.id === b)?.status).toBe("in_progress");
    for (const card of cards) expect(LANES).toContain(card.status);
  });

  it("reports owners without claiming one for an unowned card", () => {
    const { db, store } = boot();
    const projectId = store.createProject(nikk, { name: "p" });
    const owned = store.createTask(nikk, { projectId, title: "owned", owners: ["nikk"] });
    const loose = store.createTask(nikk, { projectId, title: "nobody's" });

    const { cards } = readSurfaces(db, projectId);
    expect(cards.find((card) => card.id === owned)?.owners).toEqual(["nikk"]);
    expect(cards.find((card) => card.id === loose)?.owners).toEqual([]);
  });

  it("keeps a mood board's arrangement rather than re-laying it out", () => {
    const { db, store } = boot();
    const projectId = store.createProject(nikk, { name: "p" });
    const boardId = store.createBoard(nikk, projectId, "Look and feel");
    store.addBoardItem(nikk, boardId, { kind: "note", text: "left", x: 10, y: 20, w: 100, h: 80 });
    store.addBoardItem(nikk, boardId, { kind: "note", text: "right", x: 400, y: 300, w: 100, h: 80 });

    const board = readSurfaces(db, projectId).boards.find((one) => one.id === boardId);
    const left = board?.items.find((item) => item.text === "left");
    const right = board?.items.find((item) => item.text === "right");
    // The coordinates come through untouched; the wall does the fitting.
    expect(left).toMatchObject({ x: 10, y: 20, w: 100, h: 80 });
    expect(right).toMatchObject({ x: 400, y: 300 });
  });

  it("carries no card contents — a wall is read from across a room", () => {
    const { db, store } = boot();
    const projectId = store.createProject(nikk, { name: "p" });
    const taskId = store.createTask(nikk, { projectId, title: "a card", description: "a long brief" });
    store.addComment(nikk, taskId, "something private-ish");

    const card = readSurfaces(db, projectId).cards.find((one) => one.id === taskId)!;
    expect(JSON.stringify(card)).not.toContain("a long brief");
    expect(JSON.stringify(card)).not.toContain("private-ish");
  });
});
