import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, STATUSES, STATUS_LABELS } from "../board-rules.js";
import { BOARD_COLUMNS as ROOM_COLUMNS } from "../board-3d.js";
import { BOARD_COLUMNS as WEB_COLUMNS } from "../../src/project-model.js";

describe("what the board's columns are called", () => {
  it("is one list for the web board and the room's board", () => {
    // Three copies once, and the web board said "In progress" where the room said "Doing".
    expect(WEB_COLUMNS).toBe(BOARD_COLUMNS);
    expect(ROOM_COLUMNS).toBe(BOARD_COLUMNS);
  });

  it("names every status, in the rules' order", () => {
    expect(BOARD_COLUMNS.map((column) => column.status)).toEqual([...STATUSES]);
    expect(BOARD_COLUMNS.map((column) => column.label)).toEqual(STATUSES.map((status) => STATUS_LABELS[status]));
  });
});
