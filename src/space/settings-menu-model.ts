import type { RoomMenuRow } from "../../shared/room-switch";
import type { MenuRow, MenuSection, MenuTab } from "./menu-layout";

/**
 * WHAT EACH SETTINGS TAB SHOWS, as sections of rows — decided here, without a
 * renderer, so the headset and the preview page draw the same menu and a test
 * can say what is where.
 *
 * ORGANISED, NOT JUST LISTED (Nikk, 5410, 5439): "it can be in multiple
 * sections, you can organize them based off of what you think is needed".
 *
 *   Me              Voice · Moving · View (and Avatar recording in the lobby)
 *   Rooms           this room, your rooms, public rooms
 *   Activity items  the things you can add to the room: the Go table, the orb
 *   Work items      the work and mood boards the room shows, and its panels
 *   Agents          who sees the agents, and where each one stands
 *
 * Activity and work were the wrong way round (Nikk, 5445): the Go table and
 * the breathing orb are activities; the boards are the work.
 */

export type SettingsView = "root" | "work" | "mood" | "panels" | "items" | "rooms" | "agents";
export type SettingsTabId = "me" | "rooms" | "items" | "show" | "agents";

export const SETTINGS_TABS: readonly (MenuTab & { id: SettingsTabId; view: SettingsView })[] = [
  { id: "me", label: "Me", view: "root" },
  { id: "rooms", label: "Rooms", view: "rooms" },
  { id: "items", label: "Activity items", view: "items" },
  { id: "show", label: "Work items", view: "panels" },
  { id: "agents", label: "Agents", view: "agents" },
];

export type ArrangeMode = "locked" | "move" | "resize";

export type SettingsMenuInput = {
  view: SettingsView;
  goTo: (view: SettingsView) => void;

  // ME
  voice: {
    on: boolean;
    starting: boolean;
    /** Others with a microphone open. */
    others: readonly string[];
    isMuted: (name: string) => boolean;
    setOn: (on: boolean) => void;
    setMuted: (name: string, muted: boolean) => void;
  };
  /** Rows the headset asked for: "use the microphone anyway", and the like. */
  voiceExtra: readonly { label: string; onTap: () => void }[];
  hearReplies: boolean;
  setHearReplies: (on: boolean) => void;
  handsShown: boolean;
  setHandsShown: (shown: boolean) => void;
  teleport: boolean;
  setTeleport: (on: boolean) => void;
  resetHead: () => void;
  view3d: {
    dark: boolean;
    setDark: (on: boolean) => void;
    rings: boolean;
    setRings: (on: boolean) => void;
    hideStill: boolean;
    hiddenStill: number;
    setHideStill: (on: boolean) => void;
    pointer: string;
    pointerOn: boolean;
    pointerToggle: () => void;
    pointerLess: () => void;
    pointerMore: () => void;
    passthroughAvailable: boolean;
    passthrough: boolean;
    blendMode: string | null;
    togglePassthrough: () => void;
  };
  /** The lobby's avatar recorder, or null anywhere else. */
  recorder: null | {
    status: "idle" | "recording" | "preparing";
    showPersonalUi: boolean;
    hasTake: boolean;
    playing: boolean;
    notice: string | null;
    start: () => void;
    stop: () => void;
    setShowPersonalUi: (shown: boolean) => void;
    play: () => void;
    stopPlayback: () => void;
    discard: () => void;
  };

  // ROOMS
  roomRows: readonly RoomMenuRow[];
  switching: string | null;
  goRoom: (room: string, join: boolean) => void;
  toLobby: () => void;

  // ACTIVITY ITEMS
  goTables: readonly { size: number; players: number }[];
  orbHere: boolean;
  addGoTable: () => void;
  setOrb: (shown: boolean) => void;

  // WORK ITEMS
  showing: {
    projectId: string | null;
    projectName: string | null;
    boardId: string | null;
    boardName: string | null;
    setBy: string | null;
    refusal: string | null;
  };
  projects: readonly { id: string; name: string }[] | null;
  boards: readonly { id: string; title: string }[] | null;
  choose: (projectId: string | null, boardId: string | null) => void;
  panels: readonly { id: string; label: string; shown: boolean; mode: ArrangeMode }[];
  setPanelShown: (id: string, shown: boolean) => void;
  cyclePanel: (id: string) => void;
  anyUnlocked: boolean;
  lockAll: () => void;
  panelRefusal: string | null;

  // AGENTS
  agents: readonly string[];
  agentsHiddenForEveryone: boolean;
  setAgentsHiddenForEveryone: (hidden: boolean) => void;
  /** Null when there is no room to remember a personal choice against. */
  agentsHiddenForMe: boolean | null;
  setAgentsHiddenForMe: (hidden: boolean) => void;
  placeAgent: (agent: string, where: "facing" | "beside" | "desk") => void;
};

const note = (label: string): MenuRow => ({ kind: "note", label });

const ARRANGE: Record<ArrangeMode, string> = { locked: "Fixed", move: "Drag to move", resize: "Drag to resize" };

/** The tab a view belongs to, for lighting the right one. */
export function tabOfView(view: SettingsView): SettingsTabId {
  switch (view) {
    case "rooms":
      return "rooms";
    case "items":
      return "items";
    case "panels":
    case "work":
    case "mood":
      return "show";
    case "agents":
      return "agents";
    default:
      return "me";
  }
}

function meSections(s: SettingsMenuInput): MenuSection[] {
  // The update is the badge beside the title (settingsBadge), not a section.
  const sections: MenuSection[] = [];
  const voice = s.voice;
  sections.push({
    title: "Voice",
    rows: [
      {
        kind: "toggle",
        label: "My microphone",
        on: voice.on || voice.starting,
        detail: voice.starting ? "Connecting…" : voice.on ? "On — the room can hear you" : "Muted",
        onTap: () => voice.setOn(!(voice.on || voice.starting)),
      },
      { kind: "toggle", label: "Read the room aloud", on: s.hearReplies, onTap: () => s.setHearReplies(!s.hearReplies) },
      // Mute someone, for yourself only (Nikk, 5423). Nobody else's hearing changes.
      ...voice.others.map((name): MenuRow => {
        const muted = voice.isMuted(name);
        return { kind: "toggle", label: `Hear ${name}`, on: !muted, detail: muted ? "Muted for you" : undefined, onTap: () => voice.setMuted(name, !muted) };
      }),
      ...s.voiceExtra.map((extra): MenuRow => ({ kind: "action", label: extra.label, onTap: extra.onTap })),
    ],
  });
  sections.push({
    title: "Moving",
    rows: [
      { kind: "toggle", label: "Teleport", detail: "Hand pinch or controller trigger", on: s.teleport, onTap: () => s.setTeleport(!s.teleport) },
      { kind: "toggle", label: "Show hand models", on: s.handsShown, onTap: () => s.setHandsShown(!s.handsShown) },
      { kind: "action", label: "Reset my height", onTap: s.resetHead },
    ],
  });
  const v = s.view3d;
  sections.push({
    title: "View",
    rows: [
      { kind: "toggle", label: "Dark mode", on: v.dark, onTap: () => v.setDark(!v.dark) },
      { kind: "toggle", label: "Rings under people", on: v.rings, onTap: () => v.setRings(!v.rings) },
      {
        kind: "toggle",
        label: "Hide idle people",
        on: v.hideStill,
        detail: v.hideStill && v.hiddenStill > 0 ? `Still for 5 min · ${v.hiddenStill} hidden now` : "Still for 5 minutes",
        onTap: () => v.setHideStill(!v.hideStill),
      },
      { kind: "stepper", label: "Pointer", value: v.pointerOn ? v.pointer : "Off", onLess: v.pointerLess, onMore: v.pointerMore, onTap: v.pointerToggle },
      v.passthroughAvailable
        ? { kind: "toggle", label: "Passthrough", detail: v.passthrough ? "Your real room" : "Black void", on: v.passthrough, onTap: v.togglePassthrough }
        : { kind: "toggle", label: "Passthrough", detail: `Not on this headset (${v.blendMode ?? "unknown"})`, on: false, disabled: true, onTap: () => {} },
    ],
  });
  const r = s.recorder;
  if (r) {
    sections.push({
      title: "Avatar recording",
      rows: [
        r.status === "recording"
          ? { kind: "action", label: "Stop recording", tone: "danger", onTap: r.stop }
          : r.status === "idle"
            ? { kind: "action", label: "Record avatar and voice", tone: "accent", onTap: r.start }
            : note("Preparing the recording…"),
        {
          kind: "toggle",
          label: "My menu in the replay",
          on: r.showPersonalUi,
          disabled: r.status !== "idle",
          onTap: () => r.setShowPersonalUi(!r.showPersonalUi),
        },
        ...(r.hasTake && r.status === "idle"
          ? [
              r.playing
                ? ({ kind: "action", label: "Stop the preview", onTap: r.stopPlayback } as MenuRow)
                : ({ kind: "action", label: "Play the preview", onTap: r.play } as MenuRow),
              { kind: "action", label: "Discard the draft", tone: "danger", onTap: r.discard } as MenuRow,
            ]
          : []),
        ...(r.notice ? [note(r.notice)] : []),
      ],
    });
  }
  return sections;
}

/** "Go to x", "Join and go to x", "● x — you are here" → "x". */
export function roomName(row: RoomMenuRow): string {
  return row.label.replace(/^● /, "").replace(/ — you are here$/, "").replace(/^Join and go to /, "").replace(/^Go to /, "");
}

function roomSections(s: SettingsMenuInput): MenuSection[] {
  const sections: MenuSection[] = [];
  let current: MenuSection | null = null;
  for (const row of s.roomRows) {
    if (row.kind === "heading") {
      current = { title: row.label, rows: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: "Rooms", rows: [] };
      sections.push(current);
    }
    if (row.kind === "note") current.rows.push(note(row.label));
    else if (row.kind === "here") current.rows.push({ kind: "choice", label: roomName(row), selected: true, onTap: () => {} });
    else if (row.kind === "switch")
      current.rows.push({ kind: "action", label: roomName(row), value: s.switching === row.room ? "Going…" : "Go", onTap: () => s.goRoom(row.room, false) });
    else current.rows.push({ kind: "action", label: roomName(row), tone: "accent", value: s.switching === row.room ? "Joining…" : "Join", onTap: () => s.goRoom(row.room, true) });
  }
  sections.push({
    title: "Somewhere else",
    rows: [{ kind: "link", label: "Go to the lobby", onTap: s.toLobby }, note("Make a room there, or join one by its name.")],
  });
  return sections;
}

function activitySections(s: SettingsMenuInput): MenuSection[] {
  return [
    {
      title: "Add to this room",
      rows: [
        { kind: "action", label: "Add a Go table", tone: "accent", value: "for everyone", onTap: s.addGoTable },
        { kind: "toggle", label: "Breathing orb", detail: s.orbHere ? "In this room for everyone" : "Not in this room", on: s.orbHere, onTap: () => s.setOrb(!s.orbHere) },
      ],
    },
    {
      title: "In this room",
      rows: [
        ...s.goTables.map((table) => note(`Go table · ${table.size}×${table.size} · ${table.players} playing`)),
        note(s.goTables.length ? "Set a table up with the gear on its corner; drag its base to move it." : "No Go tables yet. Add one, then use the gear on its corner."),
      ],
    },
  ];
}

function workSections(s: SettingsMenuInput): MenuSection[] {
  const showing = s.showing;
  const showRows: MenuRow[] = [
    { kind: "link", label: "Work board", value: showing.projectName ?? showing.projectId ?? "None", onTap: () => s.goTo("work") },
    { kind: "link", label: "Mood board", value: showing.boardName ?? showing.boardId ?? "None", onTap: () => s.goTo("mood") },
  ];
  if (showing.refusal) showRows.push(note(showing.refusal));
  else if (showing.setBy) showRows.push(note(`Set by ${showing.setBy}`));

  const panels: MenuRow[] = s.panels.map((panel) => ({ kind: "toggle", label: panel.label, on: panel.shown, onTap: () => s.setPanelShown(panel.id, !panel.shown) }));
  if (s.panelRefusal) panels.push(note(s.panelRefusal));

  const shown = s.panels.filter((panel) => panel.shown);
  const arrange: MenuRow[] = shown.map((panel) => ({ kind: "action", label: panel.label, value: ARRANGE[panel.mode], onTap: () => s.cyclePanel(panel.id) }));
  if (s.anyUnlocked) arrange.push({ kind: "action", label: "Fix every panel in place", tone: "accent", onTap: s.lockAll });
  if (!shown.length) arrange.push(note("Show a panel to arrange it."));

  return [
    { title: "The room shows · for everyone", rows: showRows },
    { title: "Panels · for everyone", rows: panels },
    { title: "Arrange · tap to change", rows: arrange },
  ];
}

function boardChoiceSections(s: SettingsMenuInput, which: "work" | "mood"): MenuSection[] {
  const back: MenuRow = { kind: "action", label: "‹ Back to Work items", tone: "accent", onTap: () => s.goTo("panels") };
  const rows: MenuRow[] = [back];
  if (which === "work") {
    if (s.projects === null) rows.push(note("Projects could not be read"));
    else if (s.projects.length === 0) rows.push(note("There are no projects yet"));
    else {
      rows.push({ kind: "choice", label: "Show nothing", selected: s.showing.projectId === null, onTap: () => s.choose(null, null) });
      for (const project of s.projects) {
        rows.push({
          kind: "choice",
          label: project.name,
          selected: s.showing.projectId === project.id,
          onTap: () => {
            s.choose(project.id, null);
            s.goTo("panels");
          },
        });
      }
    }
    return [{ title: "Work board · for everyone", rows }];
  }
  if (!s.showing.projectId) rows.push(note("Choose a work board first"));
  else if (s.boards === null) rows.push(note("Mood boards could not be read"));
  else if (s.boards.length === 0) rows.push(note("This project has no mood boards"));
  else {
    rows.push({ kind: "choice", label: "Show none", selected: s.showing.boardId === null, onTap: () => s.choose(s.showing.projectId, null) });
    for (const board of s.boards) {
      rows.push({
        kind: "choice",
        label: board.title,
        selected: s.showing.boardId === board.id,
        onTap: () => {
          s.choose(s.showing.projectId, board.id);
          s.goTo("panels");
        },
      });
    }
  }
  return [{ title: "Mood board · for everyone", rows }];
}

function agentSections(s: SettingsMenuInput): MenuSection[] {
  const seen: MenuRow[] = [
    // HIDE THE AGENTS FOR EVERYONE in this room, their screens too (Nikk 5384).
    {
      kind: "toggle",
      label: "To everyone here",
      detail: s.agentsHiddenForEveryone ? "Hidden for everyone here" : undefined,
      on: !s.agentsHiddenForEveryone,
      onTap: () => s.setAgentsHiddenForEveryone(!s.agentsHiddenForEveryone),
    },
  ];
  // For you alone, in this room (Nikk 5299): see agents-hidden.ts.
  if (s.agentsHiddenForMe !== null) {
    const hidden = s.agentsHiddenForMe;
    seen.push({ kind: "toggle", label: "To me", detail: hidden ? "Hidden just for you" : undefined, on: !hidden, onTap: () => s.setAgentsHiddenForMe(!hidden) });
  }
  const where: MenuRow[] = s.agents.length
    ? s.agents.map((agent) => ({
        kind: "buttons",
        label: agent,
        buttons: [
          { label: "Face me", onTap: () => s.placeAgent(agent, "facing") },
          { label: "Beside", onTap: () => s.placeAgent(agent, "beside") },
          { label: "Desk", onTap: () => s.placeAgent(agent, "desk") },
        ],
      }))
    : [note("No agents in the room")];
  return [
    { title: "Show agents", rows: seen },
    { title: "Where they stand", rows: where, wide: true },
  ];
}

export function settingsSections(s: SettingsMenuInput): MenuSection[] {
  switch (s.view) {
    case "root":
      return meSections(s);
    case "rooms":
      return roomSections(s);
    case "items":
      return activitySections(s);
    case "panels":
      return workSections(s);
    case "work":
      return boardChoiceSections(s, "work");
    case "mood":
      return boardChoiceSections(s, "mood");
    case "agents":
      return agentSections(s);
  }
}

/** The header's update button, while a new version is waiting. */
export function settingsBadge(newVersion: boolean, update: () => void): { label: string; onTap: () => void } | null {
  return newVersion ? { label: "Update now", onTap: update } : null;
}
