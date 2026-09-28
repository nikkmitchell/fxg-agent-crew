import { describe, expect, it, vi } from "vitest";
import { roomMenuRows } from "../../shared/room-switch";
import type { MenuRow, MenuSection } from "./menu-layout";
import { SETTINGS_TABS, roomName, settingsBadge, settingsSections, tabOfView, type SettingsMenuInput, type SettingsView } from "./settings-menu-model";

const noop = () => {};

function input(view: SettingsView, extra: Partial<SettingsMenuInput> = {}): SettingsMenuInput {
  return {
    view,
    goTo: noop,
    voice: { on: true, starting: false, others: ["baiwei2"], isMuted: () => false, setOn: noop, setMuted: noop },
    voiceExtra: [],
    hearReplies: true,
    touchMic: false,
    setTouchMic: () => {},
    setHearReplies: noop,
    handsShown: true,
    setHandsShown: noop,
    teleport: false,
    setTeleport: noop,
    resetHead: noop,
    view3d: {
      dark: true, setDark: noop, rings: true, setRings: noop, hideStill: false, hiddenStill: 0, setHideStill: noop,
      pointer: "60%", pointerOn: true, pointerToggle: noop, pointerLess: noop, pointerMore: noop,
      passthroughAvailable: true, passthrough: true, blendMode: "alpha-blend", togglePassthrough: noop,
    },
    recorder: null,
    roomRows: [],
    switching: null,
    goRoom: noop,
    toLobby: noop,
    goTables: [],
    orbHere: false,
    addGoTable: noop,
    setOrb: noop,
    showing: { projectId: "p", projectName: "Saha", boardId: null, boardName: null, setBy: null, refusal: null },
    projects: [{ id: "p", name: "Saha" }],
    boards: [],
    choose: noop,
    panels: [{ id: "board", label: "Work board", shown: true, mode: "locked" }],
    setPanelShown: noop,
    cyclePanel: noop,
    anyUnlocked: false,
    lockAll: noop,
    panelRefusal: null,
    agents: ["Sill"],
    agentsHiddenForEveryone: false,
    setAgentsHiddenForEveryone: noop,
    agentsHiddenForMe: false,
    setAgentsHiddenForMe: noop,
    placeAgent: noop,
    ...extra,
  };
}

const titles = (sections: MenuSection[]) => sections.map((section) => section.title);
const labels = (sections: MenuSection[]) => sections.flatMap((section) => section.rows.map((row: MenuRow) => row.label));

describe("what each settings tab holds", () => {
  it("has the five tabs Nikk named, in one row, with activity and work the right way round (5445)", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual(["Me", "Rooms", "Activity items", "Work items", "Agents"]);
    expect(labels(settingsSections(input("items")))).toContain("Add a Go table");
    expect(labels(settingsSections(input("items")))).toContain("Breathing orb");
    expect(labels(settingsSections(input("panels")))).toContain("Work board");
    expect(labels(settingsSections(input("panels")))).toContain("Mood board");
  });

  it("lights the tab a sub-list belongs to", () => {
    expect(tabOfView("work")).toBe("show");
    expect(tabOfView("mood")).toBe("show");
    expect(tabOfView("items")).toBe("items");
    expect(tabOfView("root")).toBe("me");
  });

  it("puts voice, moving and view under Me, and voice first (5410)", () => {
    const me = settingsSections(input("root"));
    expect(titles(me)).toEqual(["Voice", "Moving", "View"]);
    const voice = me[0].rows;
    expect(voice[0]).toMatchObject({ kind: "toggle", label: "My microphone", on: true });
    // Mute somebody else, for yourself only (5423).
    expect(voice.map((row) => row.label)).toContain("Hear baiwei2");
  });

  it("mutes and unmutes your own microphone from its switch", () => {
    const setOn = vi.fn();
    const on = settingsSections(input("root", { voice: { on: true, starting: false, others: [], isMuted: () => false, setOn, setMuted: noop } }));
    (on[0].rows[0] as { onTap: () => void }).onTap();
    expect(setOn).toHaveBeenLastCalledWith(false);
    const off = settingsSections(input("root", { voice: { on: false, starting: false, others: [], isMuted: () => false, setOn, setMuted: noop } }));
    (off[0].rows[0] as { onTap: () => void }).onTap();
    expect(setOn).toHaveBeenLastCalledWith(true);
  });

  it("adds the avatar recorder only where there is one (the lobby)", () => {
    expect(titles(settingsSections(input("root")))).not.toContain("Avatar recording");
    const recorder = {
      status: "idle" as const, showPersonalUi: true, hasTake: false, playing: false, notice: null,
      start: noop, stop: noop, setShowPersonalUi: noop, play: noop, stopPlayback: noop, discard: noop,
    };
    expect(titles(settingsSections(input("root", { recorder })))).toContain("Avatar recording");
  });

  it("offers publishing and first-visit playback in the headset menu", () => {
    const publish = vi.fn(), playWelcome = vi.fn(), skipWelcome = vi.fn();
    const recorder = {
      status: "idle" as const, showPersonalUi: false, hasTake: true, playing: false, notice: null,
      start: noop, stop: noop, setShowPersonalUi: noop, play: noop, stopPlayback: noop, discard: noop,
      canPublish: true, publishedMine: false, hasPublished: true, welcomeCompleted: false,
      publish, unpublish: noop, playWelcome, skipWelcome,
    };
    const rows = settingsSections(input("root", { recorder })).find((section) => section.title === "Avatar recording")!.rows;
    (rows.find((row) => row.label === "Upload tutorial to server") as { onTap: () => void }).onTap();
    (rows.find((row) => row.label === "Play welcome tutorials") as { onTap: () => void }).onTap();
    (rows.find((row) => row.label === "Skip welcome") as { onTap: () => void }).onTap();
    expect(publish).toHaveBeenCalledOnce();
    expect(playWelcome).toHaveBeenCalledOnce();
    expect(skipWelcome).toHaveBeenCalledOnce();
  });

  it("offers the update as the header's button, only while there is one", () => {
    const update = vi.fn();
    expect(settingsBadge(false, update)).toBeNull();
    settingsBadge(true, update)?.onTap();
    expect(update).toHaveBeenCalled();
  });

  it("splits Rooms at its headings and says which rooms join and which go", () => {
    const goRoom = vi.fn();
    const rows = roomMenuRows(
      [{ roomName: "saha.ing", visibility: "public" }, { roomName: "lobby", visibility: "public" }] as never[],
      [{ roomName: "go-club", visibility: "public" }] as never[],
      "saha.ing",
    );
    const sections = settingsSections(input("rooms", { roomRows: rows, goRoom }));
    expect(titles(sections)).toEqual(["This room", "Your rooms", "Public rooms to join", "Somewhere else"]);
    const join = sections[2].rows[0] as { label: string; onTap: () => void };
    expect(join.label).toBe("go-club");
    join.onTap();
    expect(goRoom).toHaveBeenCalledWith("go-club", true);
    expect(sections[1].rows[0]).toMatchObject({ kind: "choice", label: "saha.ing", selected: true });
  });

  it("names a room without the words around it", () => {
    expect(roomName({ kind: "switch", room: "x", label: "Go to lobby" })).toBe("lobby");
    expect(roomName({ kind: "join", room: "x", label: "Join and go to go-club · baiwei2's" })).toBe("go-club · baiwei2's");
    expect(roomName({ kind: "here", room: "x", label: "● saha.ing — you are here" })).toBe("saha.ing");
  });

  it("gathers who sees the agents and where each stands under Agents", () => {
    const placeAgent = vi.fn();
    const sections = settingsSections(input("agents", { placeAgent }));
    expect(titles(sections)).toEqual(["Show agents", "Where they stand"]);
    const sill = sections[1].rows[0] as { kind: string; buttons: { label: string; onTap: () => void }[] };
    expect(sill.buttons.map((button) => button.label)).toEqual(["Face me", "Beside", "Desk"]);
    sill.buttons[1].onTap();
    expect(placeAgent).toHaveBeenCalledWith("Sill", "beside");
    // No room to remember a personal choice against: no personal switch.
    expect(settingsSections(input("agents", { agentsHiddenForMe: null }))[0].rows).toHaveLength(1);
  });

  it("chooses a work board and goes back to Work items", () => {
    const choose = vi.fn();
    const goTo = vi.fn();
    const rows = settingsSections(input("work", { choose, goTo }))[0].rows;
    const saha = rows.find((row) => row.label === "Saha") as { onTap: () => void };
    saha.onTap();
    expect(choose).toHaveBeenCalledWith("p", null);
    expect(goTo).toHaveBeenCalledWith("panels");
  });
});
