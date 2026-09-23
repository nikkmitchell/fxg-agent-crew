import { describe, expect, it } from "vitest";
import { GO_PLAYERS, GO_SIZES, defaultGoItem, type GoRoomItem } from "../../shared/room-items.js";
import { BOARD, GEAR, GO_PANEL, gearClearance, goSettingCost, goSettingFor, goSettingsFit, goSettingsItems, stoneTargetRadius } from "./GoTableSettings.js";
import { layOutSettings, settingAt } from "../../shared/settings-3d.js";

const table = (over: Partial<GoRoomItem> = {}): GoRoomItem => ({ ...defaultGoItem("t"), ...over });

describe("what the table's settings panel offers", () => {
  it("says the size and the seating in the words the table uses", () => {
    const items = goSettingsItems(table({ size: 13, colours: ["a", "b", "c"] }));
    expect(items.find((i) => "id" in i && i.id === "go:size")).toMatchObject({ value: "13×13" });
    expect(items.find((i) => "id" in i && i.id === "go:players")).toMatchObject({ value: "3" });
  });

  it("offers clearing the board and a way out", () => {
    const ids = goSettingsItems(table()).flatMap((i) => ("id" in i ? [i.id] : []));
    expect(ids).toContain("go:reset");
    expect(ids).toContain("go:close");
  });

  it("FITS ON THE PANEL, every row of it", () => {
    // The room's own settings panel drops what does not fit and says "4 more,
    // not shown" — honest, and still a setting nobody can reach. This one is
    // small enough to hide a board under, so it is worth asserting.
    expect(goSettingsFit(table())).toBe(true);
    expect(goSettingsFit(table({ size: 25, colours: Array.from({ length: 8 }, (_, i) => `c${i}`) }))).toBe(true);
  });

  it("gives every row a target that can actually be pressed", () => {
    const layout = layOutSettings(goSettingsItems(table()), GO_PANEL);
    for (const id of ["go:size:less", "go:size:more", "go:players:less", "go:players:more", "go:reset", "go:close"]) {
      const at = layout.targets.find((t) => t.id === id);
      expect(at, id).toBeDefined();
      const uv = { x: at!.x / layout.width + 0.5, y: at!.y / layout.height + 0.5 };
      expect(settingAt(layout, uv)).toBe(id);
    }
  });
});

describe("what a press means", () => {
  it("steps the board up and down through the sizes there are", () => {
    expect(goSettingFor(table({ size: 9 }), "go:size:more")).toEqual({ kind: "size", size: 13 });
    expect(goSettingFor(table({ size: 9 }), "go:size:less")).toEqual({ kind: "size", size: 5 });
  });

  it("STOPS AT THE ENDS AND SAYS SO instead of doing nothing", () => {
    const biggest = GO_SIZES[GO_SIZES.length - 1];
    const smallest = GO_SIZES[0];
    expect(goSettingFor(table({ size: biggest }), "go:size:more")).toMatchObject({ kind: "refused" });
    expect(goSettingFor(table({ size: smallest }), "go:size:less")).toMatchObject({ kind: "refused" });
    // A press that silently does nothing reads as a broken button.
    expect((goSettingFor(table({ size: biggest }), "go:size:more") as { why: string }).why).toMatch(/biggest/);
  });

  it("seats one more and one fewer", () => {
    expect(goSettingFor(table({ colours: ["a", "b"] }), "go:players:more")).toEqual({ kind: "players", players: 3 });
    expect(goSettingFor(table({ colours: ["a", "b", "c"] }), "go:players:less")).toEqual({ kind: "players", players: 2 });
  });

  it("will not seat fewer than two or more colours than exist", () => {
    expect(goSettingFor(table({ colours: ["a", "b"] }), "go:players:less")).toMatchObject({ kind: "refused" });
    const full = Array.from({ length: GO_PLAYERS.max }, (_, i) => `c${i}`);
    expect(goSettingFor(table({ colours: full }), "go:players:more")).toMatchObject({ kind: "refused" });
  });

  it("ignores a press on a heading, and on nothing at all", () => {
    expect(goSettingFor(table(), "go:nothing")).toBeNull();
    expect(goSettingFor(table(), "")).toBeNull();
  });
});

describe("saying what a press will cost", () => {
  it("warns that changing the size clears a board with stones on it", () => {
    const played = table({ stones: [{ x: 1, y: 1, colour: 0 }] });
    expect(goSettingCost(played, { kind: "size", size: 13 })).toMatch(/clears the board/);
    expect(goSettingCost(table(), { kind: "size", size: 13 })).toBeNull();
  });

  it("counts the stones a leaving player takes with them", () => {
    const four = table({
      colours: ["a", "b", "c", "d"],
      stones: [
        { x: 0, y: 0, colour: 0 },
        { x: 1, y: 0, colour: 2 },
        { x: 2, y: 0, colour: 3 },
      ],
    });
    expect(goSettingCost(four, { kind: "players", players: 2 })).toMatch(/takes 2 stones off/);
    expect(goSettingCost(four, { kind: "players", players: 3 })).toMatch(/takes 1 stone off/);
    // Adding a seat costs nothing.
    expect(goSettingCost(four, { kind: "players", players: 5 })).toBeNull();
  });

  it("says nothing about a seating that loses nobody's stones", () => {
    const four = table({ colours: ["a", "b", "c", "d"], stones: [{ x: 0, y: 0, colour: 0 }] });
    expect(goSettingCost(four, { kind: "players", players: 2 })).toBeNull();
  });
});

describe("where the gear sits", () => {
  /**
   * FOUND BY CLICKING IT AND WATCHING NOTHING HAPPEN.
   *
   * The first gear sat on the tabletop at (0.62, 0.62) and was unreachable: the
   * board's stone targets are drawn above it and reach past the outermost
   * intersections by their own radius, so the press went to one of those and
   * came back 409 "lift the glowing stone first", which the room does not show.
   * A dead-looking button, no error, nothing in the console.
   *
   * The trap is that it depends on the BOARD SIZE, and the smallest board is
   * the worst case because its intersections are furthest apart. Checked at
   * 19x19 by eye it would have looked perfectly fine.
   */
  it("is clear of every stone target, at every board size", () => {
    for (const size of GO_SIZES) {
      expect(gearClearance(size), `${size}x${size}`).toBeGreaterThan(0);
    }
  });

  it("is worst on the SMALLEST board, which is the one nobody would check", () => {
    const smallest = gearClearance(GO_SIZES[0]);
    for (const size of GO_SIZES.slice(1)) {
      expect(gearClearance(size)).toBeGreaterThanOrEqual(smallest - 1e-9);
    }
    // The old placement, for the record: on the top at 0.62, which a 5x5
    // board's targets reach straight through.
    const corner = BOARD.extent / 2;
    const oldClearance = Math.hypot(0.62 - corner, 0.62 - corner) - stoneTargetRadius(GO_SIZES[0]) - GEAR.radius;
    expect(oldClearance).toBeLessThan(0);
  });

  it("keeps a real margin rather than only just clearing", () => {
    // A hair of clearance is a miss waiting for a slightly different radius.
    for (const size of GO_SIZES) expect(gearClearance(size)).toBeGreaterThan(0.05);
  });

  it("stands above the stones so a ray meets it first", () => {
    // The stone targets sit at 0.845 and the board surface at 0.827.
    expect(GEAR.y).toBeGreaterThan(0.845);
  });
});
