import { describe, expect, it } from "vitest";
import type { LobbyDoor, Wearable } from "./lobby-hall";
import { layOutSettings, settingAt } from "./settings-3d";
import {
  BODIES_PER_PAGE,
  DOOR_PANEL,
  DOORS_PER_PAGE,
  WARDROBE_PANEL,
  doorItems,
  layOutWardrobe,
  paintWardrobe,
  wardrobeAt,
  wardrobePixels,
} from "./lobby-panels";

const door = (room: string, kind: LobbyDoor["kind"] = "enter", detail = ""): LobbyDoor => ({ room, kind, detail });
const measure = (text: string, size: number) => text.length * size * 0.5;

describe("the doors panel (Nikk2, 6974: the settings template)", () => {
  const work = [door("saha.ing", "here"), ...Array.from({ length: 8 }, (_, i) => door(`room-${i}`, i % 2 ? "join" : "enter", "public"))];
  const split = { finished: [{ ...door("desert-camp", "join", "finished space"), label: "Desert Camp" }], work };

  it("is two tabs with their counts, then the doors of the chosen tab, then a pager and a refresh", () => {
    const { items, pages } = doorItems(split, "work", 0, false);
    expect(items.slice(0, 3)).toEqual([
      { kind: "heading", label: "Rooms · tap one to go" },
      { kind: "choice", id: "tab:finished", label: "Finished spaces · 1", selected: false },
      { kind: "choice", id: "tab:work", label: "Work rooms · 9", selected: true },
    ]);
    expect(pages).toBe(2);
    expect(items.filter((i) => "id" in i && i.id.startsWith("door:"))).toHaveLength(DOORS_PER_PAGE);
    expect(items.at(-2)).toEqual({ kind: "stepper", id: "page", label: "Page", value: "1 of 2" });
    expect(items.at(-1)).toMatchObject({ id: "refresh" });
  });

  it("marks the room you stand in as the chosen one, and says what pressing each other door does", () => {
    const { items } = doorItems(split, "work", 0, false);
    expect(items[3]).toEqual({ kind: "choice", id: "door:0", label: "saha.ing · you are here", selected: true });
    expect(items[4]).toEqual({ kind: "cycle", id: "door:1", label: "room-0 · public", value: "enter" });
    expect(items[5]).toMatchObject({ value: "join" });
    const finished = doorItems(split, "finished", 0, false).items;
    expect(finished[3]).toEqual({ kind: "cycle", id: "door:0", label: "Desert Camp · finished space", value: "join" });
  });

  it("keeps the pager where it was on a short last page", () => {
    const first = layOutSettings(doorItems(split, "work", 0, false).items, DOOR_PANEL);
    const last = layOutSettings(doorItems(split, "work", 1, false).items, DOOR_PANEL);
    const pagerY = (l: typeof first) => l.targets.find((t) => t.id === "page:more")?.y;
    expect(pagerY(last)).toBe(pagerY(first));
  });

  it("fits on its panel with nothing hidden, and every row can be pressed exactly", () => {
    const layout = layOutSettings(doorItems(split, "work", 0, false).items, DOOR_PANEL);
    expect(layout.hidden).toBe(0);
    for (const t of layout.targets) {
      expect(settingAt(layout, { x: t.x / layout.width + 0.5, y: t.y / layout.height + 0.5 })).toBe(t.id);
    }
  });

  it("says so when a tab is empty, and while the list is loading", () => {
    expect(doorItems({ finished: [], work: [] }, "finished", 0, false).items).toContainEqual({ kind: "note", label: "Nothing has been published as a finished space yet." });
    expect(doorItems({ finished: [], work: [] }, "work", 0, true).items[0]).toEqual({ kind: "heading", label: "Rooms · finding them…" });
  });
});

describe("the wardrobe panel", () => {
  const body = (name: string, ai = false, pictured = true): Wearable => ({ name, key: name.toLowerCase(), pictured, ...(ai ? { ai: true } : {}) });
  const bodies = [...Array.from({ length: 15 }, (_, i) => body(`Public${i}`)), body("Mica", true), body("Sill", true), body("Skein", true, false)];

  it("has Public and AI made tabs with their counts, and twelve bodies a page", () => {
    const layout = layOutWardrobe(bodies, "public", 0, null, null);
    expect(layout.tabs.map((t) => [t.id, t.label, t.selected])).toEqual([["tab:public", "Public · 15", true], ["tab:ai", "AI made · 3", false]]);
    expect(layout.tiles).toHaveLength(BODIES_PER_PAGE);
    expect(layout.pager).toMatchObject({ page: 0, pages: 2 });
    expect(layOutWardrobe(bodies, "ai", 0, null, null).tiles.map((t) => t.body.name)).toEqual(["Mica", "Sill", "Skein"]);
    expect(layOutWardrobe(bodies, "ai", 0, null, null).pager).toBeNull();
  });

  it("keeps every tile on the panel, apart from the others, and about the shape of a 2:3 picture", () => {
    const layout = layOutWardrobe(bodies, "public", 0, null, null);
    for (const t of layout.tiles) {
      expect(Math.abs(t.x) + t.width / 2).toBeLessThanOrEqual(WARDROBE_PANEL.width / 2);
      expect(Math.abs(t.y) + t.height / 2).toBeLessThanOrEqual(WARDROBE_PANEL.height / 2);
      expect(t.width / t.height).toBeGreaterThan(0.55);
      expect(t.width / t.height).toBeLessThan(0.85);
    }
    for (const a of layout.tiles) for (const b of layout.tiles) {
      if (a === b) continue;
      const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
      expect(apart).toBe(true);
    }
  });

  it("answers a press exactly: a tile wears that body, a tab switches, the gap between does nothing", () => {
    const layout = layOutWardrobe(bodies, "public", 0, null, null);
    const uv = (x: number, y: number) => ({ x: x / layout.width + 0.5, y: y / layout.height + 0.5 });
    const [first, second] = layout.tiles;
    expect(wardrobeAt(layout, uv(first.x, first.y))).toBe("wear:public0");
    expect(wardrobeAt(layout, uv((first.x + first.width / 2 + second.x - second.width / 2) / 2, first.y))).toBeNull();
    expect(wardrobeAt(layout, uv(layout.tabs[1].x, layout.tabs[1].y))).toBe("tab:ai");
    expect(wardrobeAt(layout, uv(layout.pager!.more.x, layout.pager!.more.y))).toBe("page:more");
    expect(wardrobeAt(layout, uv(layout.pager!.less.x, layout.pager!.less.y))).toBe("page:less");
  });

  it("paints pictures where there are thumbnails, a plain plate where there are none, and rings the one you wear", () => {
    const layout = layOutWardrobe(bodies, "ai", 0, "sill", null);
    const ink = paintWardrobe(layout, measure);
    expect(ink.filter((i) => i.kind === "image").map((i) => (i as { key: string }).key)).toEqual(["mica", "sill"]);
    expect(layout.tiles.find((t) => t.worn)?.body.name).toBe("Sill");
    expect(ink.some((i) => i.kind === "text" && i.text === "Sill" && i.weight === "bold")).toBe(true);
  });

  it("says why when a tab is empty, and its bitmap is shaped like the panel", () => {
    expect(layOutWardrobe([body("Public0")], "ai", 0, null, null).note).toMatch(/workshop/);
    expect(layOutWardrobe(null, "ai", 0, null, null).heading.text).toMatch(/loading/);
    const px = wardrobePixels();
    expect(px.width / px.height).toBeCloseTo(WARDROBE_PANEL.width / WARDROBE_PANEL.height, 2);
  });
});
