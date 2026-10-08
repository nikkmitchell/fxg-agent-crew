import { describe, expect, it, vi } from "vitest";
import { closeRoomMenu, onRoomMenuClose } from "./room-menu";

describe("the room's menu closes when the room changes (Mica 7513)", () => {
  it("tells every open menu, and stops telling one that has gone", () => {
    const close = vi.fn();
    const off = onRoomMenuClose(close);
    closeRoomMenu();
    expect(close).toHaveBeenCalledTimes(1);
    off();
    closeRoomMenu();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
