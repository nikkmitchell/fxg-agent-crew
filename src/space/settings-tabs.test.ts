import { describe, expect, it } from "vitest";
import { SCOPES, TABS, scopeOf, screenOf } from "./settings-tabs";

describe("the settings tabs", () => {
  it("are the ones Nikk named (5410), in two scopes, with the canonical labels", () => {
    expect(TABS.me.map((t) => t.label)).toEqual(["Me", "Rooms"]);
    expect(TABS.room.map((t) => t.label)).toEqual(["Activity items", "Work items", "Agents"]);
    expect(SCOPES.map((s) => s.id)).toEqual(["me", "room"]);
  });

  it("never shows more than five across, because only one scope's tabs are drawn", () => {
    expect(Math.max(TABS.me.length, TABS.room.length)).toBeLessThanOrEqual(5);
  });

  it("knows which scope each tab is in", () => {
    expect(scopeOf("voice")).toBe("me");
    expect(scopeOf("items")).toBe("room");
  });

  it("opens the screen that already held those settings", () => {
    expect(screenOf("rooms")).toBe("rooms");
    expect(screenOf("show")).toBe("panels");
    expect(screenOf("view")).toBe("root");
  });
});
