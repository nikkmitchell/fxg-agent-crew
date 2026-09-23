import { GO_SURFACE, goBoardWidth, goExtent, goRadius } from "../../shared/go-layout";
import type { GoRoomItem, GoSize } from "../../shared/room-items";
import { GO_SURFACE_LOOKS } from "./go-surfaces";

/**
 * Where the Go table's own controls lie — FLAT, ON THE TABLE, AS TEXT.
 *
 * Nikk, in a headset, about the floating grab bar and gear that were here: "I
 * really don't like the grab for the Go thing being floating above in the air
 * it should be like on the ground the end of Black's turn or something and also
 * the settings those should also be flat on the ground like you can just be
 * [a] text on the ground it doesn't have to actually even be an item".
 *
 * So:
 *   - MOVE and SETTINGS sit on the same line as "BLACK'S TURN", wherever
 *     Moraine's layout already puts that line for this seating — on the deck in
 *     front of the board for two players, on the board's near margin for more.
 *     MOVE is at the end of the line, where Nikk pointed.
 *   - Opening SETTINGS lays its rows flat ON THE BOARD, as text, on a cover
 *     that fades in just above the stones.
 *
 * WHY THE BOARD IS FREE TO WRITE ON. Flat things have no height to hide behind,
 * which is what kept the old floating gear clear of everything; here the
 * clearance comes from TIME instead. The only pressable things on the board are
 * the glowing intersections, and they exist only while a stone is lifted
 * (MoveLights has no instances otherwise, and hand contact is not armed). So
 * the controls and the sheet are shown only while NO stone is in the air —
 * moving the table and changing it are refused then anyway — and the board is
 * theirs.
 *
 * PURE, so every number here is checked by a test at every board size and
 * seating rather than by eye at one of them.
 */

export type FlatRect = { x: number; y: number; z: number; width: number; depth: number };

export type SheetButton = { id: string; label: string; x: number; width: number };
export type SheetRow = { z: number; label: string; value?: string; valueX?: number; buttons: SheetButton[] };

export type GoControls = {
  /** Moraine's turn line: where "BLACK'S TURN" is written. */
  line: { y: number; z: number; fontSize: number };
  move: FlatRect;
  settings: FlatRect;
  /** What the board fades behind while the sheet is open: a board-sized cover, just above the stones. */
  veil: { y: number; width: number; opacity: number };
  sheet: { y: number; width: number; rowDepth: number; fontSize: number; rows: SheetRow[] };
};

/**
 * The top of a stone lying on the board. Stones are spheres squashed to 0.46 of
 * their radius and rest on the surface, so they stand 0.92 of a radius tall —
 * about 3 cm.
 *
 * The sheet used to lie at the surface, UNDER that: on a board with a game on
 * it, the stones stood through the rows and covered the words. Baiwei: "it's
 * not very smooth. Maybe the board with stones could fade out a little bit
 * while the settings appear." So the sheet lies above the stones, on a cover
 * that fades in over the board.
 */
export const GO_STONE_TOP = GO_SURFACE + goRadius() * 0.46 * 2;

/** More than two seats moves the turn line onto the board, as Moraine's layout does. */
const isWide = (item: { colours: unknown[] }) => item.colours.length > 2;

/**
 * Half the width of "BLACK'S TURN" — the longest colour name makes the longest
 * line, so the controls are placed clear of that one whatever the turn is.
 */
function turnTextHalf(fontSize: number): number {
  // Troika's glyphs average a little under 0.6em across; "VIOLET'S TURN" is 13.
  return 13 * 0.6 * fontSize * 0.5;
}

export function goControls(item: Pick<GoRoomItem, "size" | "colours" | "scale" | "deskVisible" | "surface">): GoControls {
  const size = item.size as GoSize;
  const extent = goExtent(size);
  const boardWidth = goBoardWidth(size);
  const wide = isWide(item);

  const line = {
    y: wide ? GO_SURFACE + 0.002 : 0.752,
    z: wide ? extent / 2 + 0.035 : boardWidth / 2 + 0.16,
    fontSize: wide ? 0.025 : 0.043,
  };

  // How far out along the line there is room: the board's margin when the line
  // is on the board, a little past the board's edge when it is on the deck.
  const span = wide ? boardWidth / 2 - 0.015 : boardWidth / 2 + 0.25;
  const inner = turnTextHalf(line.fontSize) + 0.02;
  const depth = Math.max(0.06, line.fontSize * 2.4);
  const width = Math.min(0.26, span - inner);
  const centre = inner + width / 2;
  const move: FlatRect = { x: centre, y: line.y + 0.001, z: line.z, width, depth };
  const settings: FlatRect = { x: -centre, y: line.y + 0.001, z: line.z, width, depth };

  // The sheet: rows flat on the board, sized to it, never past its edge — in
  // depth as well as width: seven rows are taller than a 5×5 board at the row
  // height the bigger boards use.
  const ROWS = 7;
  const gap = 0.01;
  const sheetWidth = Math.min(1.1, Math.max(0.46, boardWidth * 0.92));
  const rowDepth = Math.min(0.12, Math.max(0.068, sheetWidth * 0.14), (boardWidth - 0.01 - (ROWS - 1) * gap) / ROWS);
  const pad = 0.02;
  const button = rowDepth;
  const value = rowDepth * 1.6;
  const right = sheetWidth / 2 - pad;
  const stepper = (id: string, label: string, shown: string): Omit<SheetRow, "z"> => ({
    label,
    value: shown,
    valueX: right - button - value / 2,
    buttons: [
      { id: `${id}:less`, label: "−", x: right - button - value - button / 2, width: button },
      { id: `${id}:more`, label: "+", x: right - button / 2, width: button },
    ],
  });
  const whole = (id: string, label: string): Omit<SheetRow, "z"> => ({
    label: "",
    buttons: [{ id, label, x: 0, width: sheetWidth - pad * 2 }],
  });

  const rows: Omit<SheetRow, "z">[] = [
    stepper("go:surface", "BOARD", GO_SURFACE_LOOKS[item.surface].label),
    stepper("go:size", "SIZE", `${size}×${size}`),
    stepper("go:players", "PLAYERS", `${item.colours.length}`),
    stepper("go:scale", "TABLE", `${Math.round(item.scale * 100)}%`),
    {
      label: "DESK",
      buttons: [{ id: "go:desk", label: item.deskVisible ? "ON" : "OFF", x: right - (button + value) / 2, width: button + value }],
    },
    whole("go:reset", "CLEAR THE STONES"),
    whole("go:close", "DONE"),
  ];
  if (rows.length !== ROWS) throw new Error(`the sheet is laid out for ${ROWS} rows, not ${rows.length}`);
  const total = rows.length * rowDepth + (rows.length - 1) * gap;
  const first = -total / 2 + rowDepth / 2;

  return {
    line,
    move,
    settings,
    veil: { y: GO_STONE_TOP + 0.003, width: boardWidth, opacity: 0.84 },
    sheet: {
      y: GO_STONE_TOP + 0.006,
      width: sheetWidth,
      rowDepth,
      fontSize: rowDepth * 0.36,
      rows: rows.map((row, index) => ({ ...row, z: first + index * (rowDepth + gap) })),
    },
  };
}

/**
 * Which of a headset's pointers the Go table answers: NOT THE GRAB SPHERE OR
 * THE TOUCH SPHERE — only the laser.
 *
 * Baiwei, in a headset: "When I walk over the board or stand close to the
 * bowls with stones, my pointer doesn't work. I have to go away and then it
 * starts working."
 *
 * Each hand carries three pointers — a ray, a 7 cm grab sphere and a 10 cm
 * touch sphere — and only ONE is live at a time: whichever hits something
 * NEAREST (@pmndrs/pointer-events, CombinedPointer.computeActivePointer). A
 * sphere that touches anything hits it at distance ~0, so the moment a hand is
 * near the desk, the rim, a bowl or the board, a sphere wins and the laser
 * switches off. `raycast={noRaycast}` does not help: that stops rays, and the
 * spheres never ask `raycast` — they test the mesh's triangles themselves.
 *
 * Nothing on the table wants the spheres. Stones are lifted and placed by
 * Moraine's fingertip loop, which reads the hand's joints directly, not through
 * these pointers; everything else is pressed with the laser.
 */
export const GO_TABLE_POINTERS: { deny: string[] } = { deny: ["grab", "touch"] };

/** Whether the table's own controls may be shown: never while a stone is in the air. */
export function goControlsShown(item: Pick<GoRoomItem, "liftedColour">): boolean {
  return item.liftedColour === null;
}
