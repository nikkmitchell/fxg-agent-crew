import { describe, expect, it } from "vitest";
import {
  isRoomPreferenceHistoryState,
  roomHistoryState,
  roomNavigationForChoice,
  roomSelectionFrom,
  roomSelectionFromStorage,
  roomUrlForSelection,
  roomUrlWithoutPreferenceMarker,
  shouldNormalizePreferredRoomUrl,
  shouldRememberRoom,
  shouldSyncRoomHistory,
} from "./room-selection";

describe("joined-room selection sources", () => {
  it("keeps a URL room explicit and separate from the saved preference", () => {
    expect(roomSelectionFrom("?room=AgentParty", "saha.ing")).toEqual({
      requestedRoom: "AgentParty",
      preferredRoom: "saha.ing",
    });
  });

  it("uses a remembered room only as a preference when there is no URL request", () => {
    expect(roomSelectionFrom("?embed=1", "  AgentParty  ")).toEqual({
      requestedRoom: null,
      preferredRoom: "AgentParty",
    });
  });

  it("treats only the embedded panel's marked URL room as a preference", () => {
    expect(roomSelectionFrom("?embed=1&room=AgentParty&room-preference=1", "saha.ing")).toEqual({
      requestedRoom: null,
      preferredRoom: "AgentParty",
    });
    expect(roomSelectionFrom("?room=AgentParty", "saha.ing")).toEqual({
      requestedRoom: "AgentParty",
      preferredRoom: "saha.ing",
    });
  });

  it("distinguishes a local history choice from a copied strict room link", () => {
    const localHistoryState = roomHistoryState({ routerKey: "keep-me" }, true);
    expect(localHistoryState.routerKey).toBe("keep-me");
    expect(isRoomPreferenceHistoryState(localHistoryState)).toBe(true);
    expect(roomSelectionFrom("?room=AgentParty", "saha.ing", isRoomPreferenceHistoryState(localHistoryState))).toEqual({
      requestedRoom: null,
      preferredRoom: "AgentParty",
    });
    expect(isRoomPreferenceHistoryState({ routerKey: "keep-me" })).toBe(false);
  });

  it("ignores an empty URL room and blank memory", () => {
    expect(roomSelectionFrom("?room=%20", "  ")).toEqual({
      requestedRoom: null,
      preferredRoom: null,
    });
  });

  it("reads only a valid room selection from a sibling-frame storage event", () => {
    expect(roomSelectionFromStorage(JSON.stringify({ requestedRoom: "AgentParty", preferredRoom: "AgentParty", nonce: "1" }))).toEqual({
      requestedRoom: "AgentParty",
      preferredRoom: "AgentParty",
    });
    expect(roomSelectionFromStorage("not-json")).toBeNull();
    expect(roomSelectionFromStorage(JSON.stringify({ requestedRoom: 4, preferredRoom: null }))).toBeNull();
  });

  it("mirrors explicit sibling-frame navigation while preserving unrelated URL state", () => {
    expect(roomUrlForSelection("https://saha.ing/room?tab=chat&room=old#lobby", "AgentParty"))
      .toBe("/room?tab=chat&room=AgentParty#lobby");
    expect(roomUrlForSelection("https://saha.ing/room?tab=chat&room=old#lobby", null))
      .toBe("/room?tab=chat#lobby");
  });

  it("updates preference mode in sibling history even when the room URL is unchanged", () => {
    const href = "/room?room=AgentParty";
    expect(shouldSyncRoomHistory(href, href, { routerKey: "keep-me" }, true)).toBe(true);
    expect(shouldSyncRoomHistory(href, href, roomHistoryState({}, true), true)).toBe(false);
    expect(shouldSyncRoomHistory(href, "/room?room=saha.ing", {}, false)).toBe(true);
  });

  it("normalizes a stale local-preference URL after falling back to a joined room", () => {
    const localPreference = roomHistoryState({}, true);
    expect(shouldNormalizePreferredRoomUrl(
      "https://saha.ing/room?tab=chat&room=old-room#lobby",
      "saha.ing",
      null,
      localPreference,
    )).toBe(true);
    expect(roomUrlForSelection("https://saha.ing/room?tab=chat&room=old-room#lobby", "saha.ing"))
      .toBe("/room?tab=chat&room=saha.ing#lobby");
    expect(shouldNormalizePreferredRoomUrl(
      "https://saha.ing/room?room=old-room",
      "saha.ing",
      "old-room",
      {},
    )).toBe(false);
    expect(shouldNormalizePreferredRoomUrl(
      "https://saha.ing/room?room=old-room",
      "saha.ing",
      null,
      {},
    )).toBe(false);
  });

  it("removes the embedded-only marker from the visible URL after recording it in history state", () => {
    const visibleUrl = roomUrlWithoutPreferenceMarker("https://saha.ing/chat?embed=1&room=AgentParty&room-preference=1#lobby");
    expect(visibleUrl).toBe("/chat?embed=1&room=AgentParty#lobby");
    expect(roomSelectionFrom(new URL(visibleUrl, "https://saha.ing").search, "saha.ing")).toEqual({
      requestedRoom: "AgentParty",
      preferredRoom: "saha.ing",
    });
  });

  it("does not persist an old feed room while the new selection is resolving", () => {
    expect(shouldRememberRoom(false, "AgentParty", "saha.ing", null)).toBe(false);
    expect(shouldRememberRoom(true, "AgentParty", "AgentParty", null)).toBe(false);
    expect(shouldRememberRoom(false, "saha.ing", "saha.ing", null)).toBe(true);
    expect(shouldRememberRoom(false, "AgentParty", "AgentParty", "AgentParty")).toBe(false);
  });

  it("keeps the current room as the back-button destination on the first switch", () => {
    expect(roomNavigationForChoice("https://saha.ing/room?tab=chat#lobby", "AgentParty", "saha.ing")).toEqual({
      replace: "/room?tab=chat&room=AgentParty#lobby",
      push: "/room?tab=chat&room=saha.ing#lobby",
    });
  });

  it("preserves explicit room history for back and forward navigation", () => {
    const navigation = roomNavigationForChoice("https://saha.ing/room?room=AgentParty", "AgentParty", "saha.ing");
    expect(navigation).toEqual({ replace: null, push: "/room?room=saha.ing" });
    expect(roomSelectionFrom("?room=AgentParty", null).requestedRoom).toBe("AgentParty");
    expect(roomSelectionFrom(new URL(navigation.push!, "https://saha.ing").search, null).requestedRoom).toBe("saha.ing");
  });
});
