import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";

/**
 * Changing what an item SAYS, as opposed to where it sits.
 *
 * Separate from moveBoardItem because the two have opposite audit rules:
 * dragging is noise and is deliberately not recorded, rewriting a note is a
 * change of content and is. The tests that matter are the ones that would let
 * the two blur back together.
 */

const nikk = { id: "nikk", kind: "human" as const };

const boot = () => {
  const db = openDatabase(":memory:", DatabaseSync);
  const store = new BoardStore(db);
  const projectId = store.createProject(nikk, { name: "p" });
  const boardId = store.createBoard(nikk, projectId, "Look and feel");
  return { db, store, boardId };
};

const auditFor = (db: DatabaseSync, itemId: string) =>
  db.prepare("SELECT action FROM audit WHERE entity='board_item' AND entity_id=?").all(itemId) as {
    action: string;
  }[];

describe("editing an item's words", () => {
  it("rewrites a note and records that it happened", () => {
    const { db, store, boardId } = boot();
    const id = store.addBoardItem(nikk, boardId, { kind: "note", text: "first thought" });
    store.editBoardItem(nikk, id, { text: "second thought" });

    const row = db.prepare("SELECT text FROM board_items WHERE id=?").get(id) as { text: string };
    expect(row.text).toBe("second thought");
    expect(auditFor(db, id).map((a) => a.action)).toContain("update");
  });

  it("does NOT record a drag", () => {
    // A board is arranged dozens of times. An audit row per drag buries the
    // changes that actually matter.
    const { db, store, boardId } = boot();
    const id = store.addBoardItem(nikk, boardId, { kind: "note", text: "here" });
    const before = auditFor(db, id).length;
    store.moveBoardItem(nikk, id, { x: 40, y: 90 });
    expect(auditFor(db, id).length).toBe(before);
  });

  it("refuses to empty a note", () => {
    // An empty note is an invisible rectangle somebody has to hunt for.
    const { store, boardId } = boot();
    const id = store.addBoardItem(nikk, boardId, { kind: "note", text: "something" });
    expect(() => store.editBoardItem(nikk, id, { text: "   " })).toThrow();
  });

  it("lets a swatch be recoloured", () => {
    const { db, store, boardId } = boot();
    const id = store.addBoardItem(nikk, boardId, { kind: "swatch", text: "#3156d8" });
    store.editBoardItem(nikk, id, { text: "#e45338" });
    const row = db.prepare("SELECT text FROM board_items WHERE id=?").get(id) as { text: string };
    expect(row.text).toBe("#e45338");
  });

  it("refuses an edit from somebody with no authority on the project", () => {
    const { store, boardId } = boot();
    const id = store.addBoardItem(nikk, boardId, { kind: "note", text: "mine" });
    expect(() => store.editBoardItem({ id: "stranger", kind: "human" }, id, { text: "yours" })).toThrow();
  });

  it("refuses an item that does not exist", () => {
    const { store } = boot();
    expect(() => store.editBoardItem(nikk, "no-such-item", { text: "hello" })).toThrow();
  });
});
