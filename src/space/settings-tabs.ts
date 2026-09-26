/**
 * The settings, as two scopes and eight tabs.
 *
 * Nikk (4785): "we have a tab for me, view, movement, voice, rooms ... then
 * you have settings for this room which are also other tabs ... eight tabs,
 * let's move forward." Shaped by Moraine's v0.2 and its addendum (4788, 4789):
 * a scope first, ME or THIS ROOM, then only that scope's tabs, so a headset
 * never shows eight across; ME follows the person between rooms, THIS ROOM
 * changes what everybody here sees and says so.
 *
 * Every row that existed before is kept and regrouped; nothing is dropped.
 */

export type SettingsScope = "me" | "room";
export type SettingsTab = "me" | "view" | "moving" | "voice" | "rooms" | "show" | "items" | "agents";

export const SCOPES: { id: SettingsScope; label: string }[] = [
  { id: "me", label: "ME" },
  { id: "room", label: "THIS ROOM" },
];

export const TABS: Record<SettingsScope, { id: SettingsTab; label: string }[]> = {
  me: [
    { id: "me", label: "Me" },
    { id: "view", label: "View" },
    { id: "moving", label: "Moving" },
    { id: "voice", label: "Voice" },
    { id: "rooms", label: "Rooms" },
  ],
  room: [
    { id: "show", label: "Show" },
    { id: "items", label: "Items" },
    { id: "agents", label: "Agents" },
  ],
};

export function scopeOf(tab: SettingsTab): SettingsScope {
  return TABS.room.some((t) => t.id === tab) ? "room" : "me";
}

/**
 * Which existing screen a tab opens. The screens were already there (Rooms,
 * Items, Panels, Agents, and the root list); the tabs choose between them
 * instead of a list of "…" rows that did.
 */
export function screenOf(tab: SettingsTab): "root" | "rooms" | "items" | "panels" | "agents" {
  switch (tab) {
    case "rooms":
      return "rooms";
    case "items":
      return "items";
    case "agents":
      return "agents";
    case "show":
      return "panels";
    default:
      return "root";
  }
}
