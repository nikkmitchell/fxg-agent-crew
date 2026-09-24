import { describe, expect, it } from "vitest";
import { GO_SIZES, defaultGoItem, type GoRoomItem, type GoSize } from "../../shared/room-items.js";
import { GO_SURFACE, goBoardWidth, goBowl, goRadius } from "../../shared/go-layout.js";
import { GO_STONE_TOP, goControls, goControlsShown, type FlatRect } from "./go-controls.js";

/**
 * The Go table's controls lie flat on the table — Nikk: "it should be like on
 * the ground the end of Black's turn... the settings those should also be flat
 * on the ground like you can just be [a] text on the ground".
 *
 * Flat means no height to keep them clear of anything, so these hold, at EVERY
 * board size and EVERY seating: they fit where they are put, they are big
 * enough to hit, and they keep clear of the bowls. The last three handles on
 * this table each failed one of those, and each was found by hand.
 */

const SEATINGS = [2, 3, 4, 5, 6, 7, 8];
const table = (size: GoSize, seats: number, over: Partial<GoRoomItem> = {}): GoRoomItem => ({
  ...defaultGoItem("t"),
  size,
  colours: Array.from({ length: seats }, (_, i) => `c${i}`),
  ...over,
});

/** The gap from a bowl's centre to the nearest point of a flat rect, in the table's frame. */
function gapTo(rect: FlatRect, at: { x: number; z: number }): number {
  const dx = Math.max(Math.abs(at.x - rect.x) - rect.width / 2, 0);
  const dz = Math.max(Math.abs(at.z - rect.z) - rect.depth / 2, 0);
  return Math.hypot(dx, dz);
}
const BOWL_REACH = 0.19;

describe("MOVE and SETTINGS, on the turn line", () => {
  it("MOVE is at the END of the line, where Nikk pointed; SETTINGS at its start", () => {
    const c = goControls(table(9, 2));
    expect(c.move.x).toBeGreaterThan(0);
    expect(c.settings.x).toBeLessThan(0);
    expect(c.move.z).toBe(c.line.z);
  });

  it("is big enough to hit, at every size and seating", () => {
    for (const size of GO_SIZES) {
      for (const seats of SEATINGS) {
        const { move, settings } = goControls(table(size, seats));
        for (const rect of [move, settings]) {
          expect(rect.width, `${size}x${size}, ${seats} seats`).toBeGreaterThanOrEqual(0.08);
          expect(rect.depth, `${size}x${size}, ${seats} seats`).toBeGreaterThanOrEqual(0.055);
        }
      }
    }
  });

  it("does not sit on top of the turn text", () => {
    for (const size of GO_SIZES) {
      for (const seats of SEATINGS) {
        const { move, settings, line } = goControls(table(size, seats));
        const half = 13 * 0.6 * line.fontSize * 0.5;
        expect(move.x - move.width / 2).toBeGreaterThanOrEqual(half);
        expect(-(settings.x + settings.width / 2)).toBeGreaterThanOrEqual(half);
      }
    }
  });

  it("stays on the board's margin when the line is on the board", () => {
    for (const size of GO_SIZES) {
      for (const seats of SEATINGS.filter((s) => s > 2)) {
        const { move } = goControls(table(size, seats));
        expect(move.x + move.width / 2, `${size}x${size}, ${seats} seats`).toBeLessThanOrEqual(goBoardWidth(size) / 2);
      }
    }
  });

  it("keeps clear of every bowl, at every size and seating", () => {
    for (const size of GO_SIZES) {
      for (const seats of SEATINGS) {
        const { move, settings } = goControls(table(size, seats));
        for (let bowl = 0; bowl < seats; bowl += 1) {
          const at = goBowl(bowl, seats, size);
          expect(gapTo(move, at), `MOVE, ${size}x${size}, ${seats} seats, bowl ${bowl}`).toBeGreaterThan(BOWL_REACH);
          expect(gapTo(settings, at), `SETTINGS, ${size}x${size}, ${seats} seats, bowl ${bowl}`).toBeGreaterThan(BOWL_REACH);
        }
      }
    }
  });
});

describe("the settings sheet, flat on the board", () => {
  it("fits on the board, every row and every button, at every size", () => {
    for (const size of GO_SIZES) {
      const { sheet } = goControls(table(size, 2));
      const half = goBoardWidth(size) / 2;
      expect(sheet.width).toBeLessThanOrEqual(goBoardWidth(size));
      for (const row of sheet.rows) {
        expect(Math.abs(row.z) + sheet.rowDepth / 2, `${size}x${size} row ${row.label}`).toBeLessThanOrEqual(half);
        for (const button of row.buttons) {
          expect(Math.abs(button.x) + button.width / 2, `${size}x${size} ${button.id}`).toBeLessThanOrEqual(half);
        }
      }
    }
  });

  it("has every setting on it, and a way out", () => {
    const ids = goControls(table(9, 2)).sheet.rows.flatMap((row) => row.buttons.map((b) => b.id));
    expect(ids).toEqual(expect.arrayContaining([
      "go:surface:less", "go:surface:more",
      "go:size:less", "go:size:more", "go:players:less", "go:players:more",
      "go:scale:less", "go:scale:more", "go:desk", "go:land", "go:reset", "go:delete", "go:close",
    ]));
  });

  it("says what the second press on DELETE will do, once it has been pressed", () => {
    const label = (armed: boolean) =>
      goControls(table(9, 2), armed).sheet.rows.flatMap((row) => row.buttons).find((b) => b.id === "go:delete")!.label;
    expect(label(false)).toBe("DELETE BOARD");
    expect(label(true)).toBe("SURE? DELETE");
  });

  it("never overlaps two buttons, or two rows", () => {
    for (const size of GO_SIZES) {
      const { sheet } = goControls(table(size, 2));
      for (const row of sheet.rows) {
        const spans = row.buttons.map((b) => [b.x - b.width / 2, b.x + b.width / 2]).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < spans.length; i += 1) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
      }
      for (let i = 1; i < sheet.rows.length; i += 1) {
        expect(sheet.rows[i].z - sheet.rows[i - 1].z).toBeGreaterThanOrEqual(sheet.rowDepth);
      }
    }
  });

  it("gives even the smallest board buttons a pointer can hit", () => {
    const { sheet } = goControls(table(5, 2));
    for (const row of sheet.rows) for (const button of row.buttons) expect(button.width).toBeGreaterThanOrEqual(0.06);
    expect(sheet.rowDepth).toBeGreaterThanOrEqual(0.06);
  });

  it("lies ABOVE the stones, on a cover that hides the game behind it", () => {
    // Baiwei: the board with stones should fade while the settings appear. The
    // rows used to lie at the surface, and a game's stones stood through them.
    const stoneTop = GO_SURFACE + goRadius() * 0.46 * 2;
    expect(GO_STONE_TOP).toBeCloseTo(stoneTop, 9);
    for (const size of GO_SIZES) {
      const { veil, sheet } = goControls(table(size, 2));
      expect(veil.y, `${size}x${size} cover`).toBeGreaterThan(stoneTop);
      expect(sheet.y, `${size}x${size} rows`).toBeGreaterThan(veil.y);
      expect(veil.width, `${size}x${size} cover covers the board`).toBeGreaterThanOrEqual(goBoardWidth(size));
      expect(veil.opacity).toBeGreaterThan(0.5);
      expect(veil.opacity).toBeLessThan(1); // faded, not gone: the game is still there
    }
  });

  it("says the table's own values", () => {
    const rows = goControls(table(13, 3, { scale: 1.2, deskVisible: false, surface: "stone", territoryShown: true })).sheet.rows;
    expect(rows.find((r) => r.label === "BOARD")?.value).toBe("STONE");
    expect(rows.find((r) => r.label === "SIZE")?.value).toBe("13×13");
    expect(rows.find((r) => r.label === "PLAYERS")?.value).toBe("3");
    expect(rows.find((r) => r.label === "TABLE")?.value).toBe("120%");
    const show = rows.find((r) => r.label === "SHOW")!.buttons;
    expect(show.map((b) => [b.id, b.label])).toEqual([["go:desk", "DESK OFF"], ["go:land", "LAND ON"]]);
  });
});

describe("when the controls are there at all", () => {
  it("NEVER WHILE A STONE IS IN THE AIR, which is what keeps the board free to write on", () => {
    // The glowing intersections exist only while a stone is lifted; the flat
    // controls are shown only while none is. They can never be under the same
    // pointer at once.
    expect(goControlsShown({ liftedColour: null })).toBe(true);
    expect(goControlsShown({ liftedColour: 0 })).toBe(false);
  });
});

/** Baiwei: SETTINGS overflowed its outline at the smallest board. */
describe("every label fits inside its own outline", () => {
  const within = (label: string, width: number, font: number) => [...label].length * 0.62 * font <= width - 0.024 + 1e-9;

  it("shrinks a label only as much as it must", async () => {
    const { fitFont } = await import("./go-controls");
    expect(fitFont("DONE", 0.4, 0.03)).toBe(0.03);
    expect(within("PASS · ENDS GAME", 0.34, fitFont("PASS · ENDS GAME", 0.34, 0.04))).toBe(true);
  });

  it("holds for SETTINGS, MOVE and every sheet button at every size and seating", async () => {
    const { fitFont, goControls: controlsOf } = await import("./go-controls");
    const { defaultGoItem, GO_SIZES } = await import("../../shared/room-items");
    for (const size of GO_SIZES) for (const players of [2, 3, 8]) for (const armed of [false, true]) {
      const item = { ...defaultGoItem("t"), size, colours: Array.from({ length: players }, (_, i) => `#${i}${i}${i}`) };
      const c = controlsOf(item, armed);
      const top = c.labels.fontSize;
      for (const label of [c.labels.settings, c.labels.move, c.labels.moving]) {
        const box = label === c.labels.settings ? c.settings.width : c.move.width;
        expect(within(label, box, fitFont(label, box, top)), `${size} ${players} ${label}`).toBe(true);
      }
      for (const row of c.sheet.rows) for (const b of row.buttons) {
        expect(within(b.label, b.width, fitFont(b.label, b.width, c.sheet.fontSize)), `${size} ${b.label}`).toBe(true);
      }
    }
  });
});

/** Lumenfold (4692): icons only on the smallest board, words everywhere else. */
describe("SETTINGS and MOVE as icons on the smallest board", () => {
  it("drops the words at 5x5 only", async () => {
    const { goControls: controlsOf } = await import("./go-controls");
    const { defaultGoItem } = await import("../../shared/room-items");
    const at = (size: 5 | 9) => controlsOf({ ...defaultGoItem("t"), size }).labels;
    expect(at(5)).toMatchObject({ settings: "⚙", move: "✥" });
    expect(at(9)).toMatchObject({ settings: "⚙ SETTINGS", move: "MOVE ✥", moving: "MOVING" });
  });
});
