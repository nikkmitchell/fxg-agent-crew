import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetRoom, rememberRoom, rememberedRoom, roomMemoryKey, shouldForgetRoom } from "./ChatFeed";

afterEach(() => vi.unstubAllGlobals());

describe("remembering a lobby room", () => {
  it("keeps the room choice with the signed-in username", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    rememberRoom(" Alice ", "private-room");
    expect(roomMemoryKey("alice")).toBe(roomMemoryKey(" ALICE "));
    expect(rememberedRoom("alice")).toBe("private-room");
    expect(rememberedRoom("bob")).toBeNull();
    expect(rememberedRoom("")).toBeNull();
    forgetRoom("Alice", "private-room");
    expect(rememberedRoom("Alice")).toBeNull();
  });

  it("forgets invalid prior choices only after a successful membership read", () => {
    const rooms = [{ roomName: "saha.ing" }];
    expect(shouldForgetRoom("old-private-room", true, null, rooms)).toBe(false);
    expect(shouldForgetRoom("old-private-room", false, "Room list unavailable", rooms)).toBe(false);
    expect(shouldForgetRoom("old-private-room", false, null, rooms)).toBe(true);
    expect(shouldForgetRoom("saha.ing", false, null, rooms)).toBe(false);
  });
});
