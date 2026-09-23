import { describe, expect, it } from "vitest";
import { wrapLabel } from "./label-texture";
import {
  joinedRoomChoiceLabel,
  joinedRoomPage,
  joinedRoomSelectionPage,
  JOINED_ROOM_PAGE_SIZE,
  roomNamePages,
} from "./joined-room-menu";

describe("headset joined-room menu", () => {
  it("keeps pages within the number of choices the headset menu can show", () => {
    const rooms = Array.from({ length: 11 }, (_, index) => `Room ${index + 1}`);
    expect(JOINED_ROOM_PAGE_SIZE).toBe(3);
    expect(joinedRoomPage(rooms, 0)).toMatchObject({
      pageIndex: 0,
      pageCount: 4,
      rooms: ["Room 1", "Room 2", "Room 3"],
      hasPrevious: false,
      hasNext: true,
    });
    expect(joinedRoomPage(rooms, 99)).toMatchObject({
      pageIndex: 3,
      pageCount: 4,
      rooms: ["Room 10", "Room 11"],
      hasPrevious: true,
      hasNext: false,
    });
    expect(joinedRoomPage([], 4)).toMatchObject({
      pageIndex: 0,
      pageCount: 1,
      rooms: [],
      hasPrevious: false,
      hasNext: false,
    });
  });

  it("preserves the room name so similarly named destinations remain distinguishable", () => {
    const alpha = "Studio for shared creative collaboration alpha";
    const beta = "Studio for shared creative collaboration beta";
    const alphaLabel = joinedRoomChoiceLabel(alpha, true, 2);
    const betaLabel = joinedRoomChoiceLabel(beta, true, 2);
    const visibleAlpha = wrapLabel(alphaLabel, 3, (line) => line.length <= 25).join(" ");
    const visibleBeta = wrapLabel(betaLabel, 3, (line) => line.length <= 25).join(" ");
    expect(alphaLabel).toBe(`✓ 2. ${alpha}`);
    expect(visibleAlpha).toContain("alpha");
    expect(visibleAlpha).not.toBe(visibleBeta);
  });

  it("opens on the page containing the selected room", () => {
    const rooms = Array.from({ length: 8 }, (_, index) => ({ roomName: `Room ${index + 1}` }));
    expect(joinedRoomSelectionPage(rooms, "Room 5")).toBe(1);
    expect(joinedRoomSelectionPage(rooms, "not joined")).toBe(0);
    expect(joinedRoomSelectionPage([], null)).toBe(0);
  });

  it("paginates long room names losslessly so the full destination can be inspected before selection", () => {
    const alpha = `${"Shared creative collaboration room ".repeat(7)}alpha`;
    const beta = `${"Shared creative collaboration room ".repeat(7)}beta`;
    const alphaPages = roomNamePages(alpha);
    const betaPages = roomNamePages(beta);
    expect(alphaPages.join("")).toBe(alpha);
    expect(betaPages.join("")).toBe(beta);
    expect(alphaPages.at(-1)).not.toBe(betaPages.at(-1));
    expect(alphaPages.every((page) => Array.from(page).length <= 36)).toBe(true);
  });
});
