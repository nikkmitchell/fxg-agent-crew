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
  // Pure text: Baiwei (5028), the icon squeezed it and no other tab has one.
  { id: "room", label: "THIS ROOM" },
];

export const TABS: Record<SettingsScope, { id: SettingsTab; label: string }[]> = {
  // Nikk (5410): Me, View, Moving and Voice are one tab now, "me", in sections.
  me: [
    { id: "me", label: "Me" },
    { id: "rooms", label: "Rooms" },
  ],
  // And this room's three renamed: activity items (what the room shows), work
  // items (the things in it), agents.
  room: [
    { id: "show", label: "Activity items" },
    { id: "items", label: "Work items" },
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
