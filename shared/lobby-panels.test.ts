import { describe, expect, it } from "vitest";
import type { LobbyDoor, Wearable } from "./lobby-hall";
import {
  BODIES_PER_PAGE,
  DOOR_PANEL,
  DOORS_PER_PAGE,
  WARDROBE_PANEL,
  doorColour,
  doorPixels,
  doorsAt,
  layOutDoors,
  layOutWardrobe,
  paintDoors,
  paintWardrobe,
  wardrobeAt,
  wardrobePixels,
} from "./lobby-panels";

const door = (room: string, kind: LobbyDoor["kind"] = "enter", detail = ""): LobbyDoor => ({ room, kind, detail });
const measure = (text: string, size: number) => text.length * size * 0.5;

describe("the doors panel: thumbnails under tabs, like the wardrobe (Nikk, 7227)", () => {
  const work = [door("saha.ing", "here"), ...Array.from({ length: 10 }, (_, i) => door(`room-${i}`, i % 2 ? "join" : "enter", "public"))];
  const split = { finished: [{ ...door("desert-camp", "join", "finished space"), label: "Desert Camp" }], work };

  it("puts the two tabs at the top with their counts, then nine doors a page, then a pager and Look again", () => {
    const layout = layOutDoors(split, "work", 0, false);
    expect(layout.tabs.map((t) => [t.id, t.label, t.selected])).toEqual([["tab:finished", "Finished spaces · 1", false], ["tab:work", "Work rooms · 11", true]]);
    expect(layout.tiles).toHaveLength(DOORS_PER_PAGE);
    expect(layout.pager).toMatchObject({ page: 0, pages: 2 });
    expect(Math.min(...layout.tabs.map((t) => t.y))).toBeGreaterThan(Math.max(...layout.tiles.map((t) => t.y)));
    expect(layOutDoors(split, "work", 1, false).tiles).toHaveLength(2);
  });

  it("rings the room you stand in, and says what each other door does", () => {
    const layout = layOutDoors(split, "work", 0, false);
    expect(layout.tiles[0]).toMatchObject({ here: true });
    const ink = paintDoors(layout, measure);
    expect(ink.some((i) => i.kind === "text" && i.text === "enter · public")).toBe(true);
    expect(ink.some((i) => i.kind === "text" && i.text === "join · public")).toBe(true);
    expect(paintDoors(layOutDoors(split, "finished", 0, false), measure).some((i) => i.kind === "text" && i.text === "Desert Camp")).toBe(true);
  });

  it("gives every room its own colour, always the same, and shows a door opening", () => {
    expect(doorColour("saha.ing")).toBe(doorColour("SAHA.ING"));
    expect(new Set(work.map((d) => doorColour(d.room))).size).toBeGreaterThan(3);
    const ink = paintDoors(layOutDoors(split, "work", 0, false, "room-0"), measure);
    expect(ink.some((i) => i.kind === "text" && i.text === "opening…")).toBe(true);
  });

  it("answers a press exactly: a tile goes, a tab switches, the gap between does nothing", () => {
    const layout = layOutDoors(split, "work", 0, false);
    const uv = (x: number, y: number) => ({ x: x / layout.width + 0.5, y: y / layout.height + 0.5 });
    const [first, second] = layout.tiles;
    expect(doorsAt(layout, uv(second.x, second.y))).toBe("door:1");
    expect(doorsAt(layout, uv((first.x + first.width / 2 + second.x - second.width / 2) / 2, first.y))).toBeNull();
    expect(doorsAt(layout, uv(layout.tabs[0].x, layout.tabs[0].y))).toBe("tab:finished");
    expect(doorsAt(layout, uv(layout.pager!.more.x, layout.pager!.more.y))).toBe("page:more");
    expect(doorsAt(layout, uv(layout.refresh.x, layout.refresh.y))).toBe("refresh");
  });

  it("keeps every tile on the panel and apart, and says so when a tab is empty or loading", () => {
    const layout = layOutDoors(split, "work", 0, false);
    for (const t of layout.tiles) {
      expect(Math.abs(t.x) + t.width / 2).toBeLessThanOrEqual(DOOR_PANEL.width / 2);
      expect(Math.abs(t.y) + t.height / 2).toBeLessThanOrEqual(DOOR_PANEL.height / 2);
    }
    expect(layOutDoors({ finished: [], work: [] }, "finished", 0, false).note).toMatch(/finished space/);
    expect(layOutDoors({ finished: [], work: [] }, "work", 0, true).heading.text).toMatch(/finding/);
    const px = doorPixels();
    expect(px.width / px.height).toBeCloseTo(DOOR_PANEL.width / DOOR_PANEL.height, 2);
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
