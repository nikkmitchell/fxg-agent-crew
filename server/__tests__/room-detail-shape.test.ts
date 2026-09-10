import { describe, expect, it } from "vitest";
import { normaliseRoomDetail } from "../routes/rooms.js";

/**
 * `client.request<T>()` casts. It does not check.
 *
 * That was already found once, on /bff/rooms, where an upstream `{rooms: [...]}`
 * wrapper passed straight through a `RoomSummary[]` annotation and sixty tests
 * believed it. This route was left doing the same thing, and the consequence
 * was worse: against an upstream that omits `onlineUsers`, the panel reached
 * `state.room.onlineUsers.length`, threw during render, and React unmounted the
 * whole tree. A BLANK PAGE, 200 in the access log, evidence only in a console
 * nobody has open.
 *
 * Found by running the real app against a server I control — not by a test, and
 * not by review.
 */

describe("normaliseRoomDetail", () => {
  it("survives the shape that actually crashed the panel", () => {
    const detail = normaliseRoomDetail({ roomName: "AgentParty", isPublic: true, members: ["a", "b"] }, "AgentParty");

    expect(detail.onlineUsers).toEqual([]);
    expect(detail.onlineCount).toBe(0);
    expect(detail.roomName).toBe("AgentParty");
  });

  it("says zero rather than inventing a count", () => {
    // The alternative — inferring presence from `members`, or from anything
    // else lying around — would put a number on screen that nothing measured.
    // This screen exists to not do that.
    const detail = normaliseRoomDetail({ members: ["a", "b", "c"] }, "AgentParty");

    expect(detail.onlineCount).toBe(0);
  });

  it("keeps what upstream did send", () => {
    const detail = normaliseRoomDetail(
      {
        roomName: "AgentParty",
        ownerName: "nikk",
        onlineUsers: [{ username: "claude-nikk2mbp", lastSeenAt: "2026-09-09T00:00:00Z" }],
        onlineCount: 4,
        isOwner: true,
        muted: false,
        myPermissions: { canSpeak: true, canUpload: false },
      },
      "AgentParty",
    );

    expect(detail.onlineUsers).toEqual([{ username: "claude-nikk2mbp", lastSeenAt: "2026-09-09T00:00:00Z" }]);
    expect(detail.onlineCount).toBe(4);
    expect(detail.isOwner).toBe(true);
    expect(detail.myPermissions).toEqual({ canSpeak: true, canUpload: false });
  });

  it("drops entries that are not users, rather than rendering undefined", () => {
    const detail = normaliseRoomDetail(
      { onlineUsers: [null, "nope", { notAUsername: 1 }, { username: "real" }] },
      "AgentParty",
    );

    expect(detail.onlineUsers).toEqual([{ username: "real", lastSeenAt: "" }]);
    expect(detail.onlineCount).toBe(1);
  });

  it("rebuilds rather than spreading, so nothing unchecked rides through", () => {
    const detail = normaliseRoomDetail(
      { roomName: "AgentParty", surprise: "from upstream", onlineUsers: "not an array" },
      "AgentParty",
    );

    expect(detail).not.toHaveProperty("surprise");
    expect(detail.onlineUsers).toEqual([]);
  });

  it("never throws, whatever it is handed", () => {
    // The point of this function is that the panel keeps rendering. A validator
    // that throws on a surprise trades a blank page for a different blank page.
    for (const raw of [null, undefined, 42, "string", [], { onlineCount: "many" }]) {
      expect(() => normaliseRoomDetail(raw, "AgentParty")).not.toThrow();
      expect(normaliseRoomDetail(raw, "AgentParty").roomName).toBe("AgentParty");
    }
  });
});
