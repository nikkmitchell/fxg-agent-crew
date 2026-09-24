import { legalGoMoves } from "./go-rules.js";
import type { GoRoomItem } from "./room-items.js";
import { countGo, goLeaders } from "./go-score.js";

/**
 * A Go table AS TEXT, for agents that play through code.
 *
 * Nikk: "maybe put in a way for agents to read the board through code and
 * place their pieces through code". An agent reads a board far better as a
 * grid of characters with real Go coordinates than as a list of stones, and a
 * program wants the same coordinates the agent writes. So both directions live
 * here: a board drawn as text, and a coordinate like "D4" read back to the
 * table's own (x, y).
 *
 * COORDINATES ARE GO'S OWN: columns are letters from the left, SKIPPING "I" (it
 * is too like "J" and "1"), and rows are numbers counted up from the near side.
 * "Near" is where the turn line is written — the side a person stands at to
 * read it. In the table's own terms x runs left to right from there, and y runs
 * away from the far edge toward it, so row 1 is y = size − 1.
 */

/** The players' names, by bowl, as the table says them ("BLACK'S TURN"). */
export const GO_NAMES = ["Black", "White", "Coral", "Blue", "Gold", "Jade", "Violet", "Rose"] as const;

/**
 * One character per colour on the text board. X and O for the two that start
 * every table, as any Go diagram draws them; after that a letter of the name
 * that is not already taken (Blue is U, because Black has B's place as X).
 */
export const GO_GLYPHS = ["X", "O", "C", "U", "G", "J", "V", "R"] as const;

/** Column letters, left to right: A to Z without I — 25, the biggest board there is. */
export const GO_COLUMNS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export function goCoordName(x: number, y: number, size: number): string {
  return `${GO_COLUMNS[x]}${size - y}`;
}

/**
 * "D4" (any case) → the table's (x, y), or null for anything that is not a
 * point on this board — including "I", which is not a column.
 */
export function parseGoCoord(text: string, size: number): { x: number; y: number } | null {
  const match = /^\s*([A-Za-z])\s*(\d{1,2})\s*$/.exec(text);
  if (!match) return null;
  const x = GO_COLUMNS.indexOf(match[1].toUpperCase());
  const row = Number(match[2]);
  if (x < 0 || x >= size || row < 1 || row > size) return null;
  return { x, y: size - row };
}

/** Which colour a name, glyph or bowl number means at this table, or null. */
export function goColourOf(text: string, players: number): number | null {
  const wanted = text.trim().toLowerCase();
  const index = /^\d+$/.test(wanted)
    ? Number(wanted)
    : GO_NAMES.findIndex((name, at) => name.toLowerCase() === wanted || GO_GLYPHS[at].toLowerCase() === wanted);
  return index >= 0 && index < players ? index : null;
}

/** The star points on a board of this size: the table draws these, and the text marks them. */
export function goStarPoints(size: number): number[] {
  if (size >= 13) return [3, (size - 1) / 2, size - 4];
  if (size === 9) return [2, 4, 6];
  return [(size - 1) / 2];
}

/**
 * The whole table as text: the grid with coordinates, whose turn it is, the
 * last move, captures, and how many legal moves there are — everything a
 * player needs to choose a move, and nothing about the room.
 */
export function goBoardText(item: Pick<GoRoomItem, "id" | "size" | "colours" | "stones" | "captures" | "activeColour" | "liftedColour" | "carrier" | "revision"> & Partial<Pick<GoRoomItem, "passes" | "ended">>): string {
  const { size } = item;
  const at = new Map(item.stones.map((stone) => [`${stone.x},${stone.y}`, stone.colour]));
  const stars = new Set(goStarPoints(size).flatMap((x) => goStarPoints(size).map((y) => `${x},${y}`)));
  const width = String(size).length;
  const header = `${" ".repeat(width + 1)}${GO_COLUMNS.slice(0, size).split("").join(" ")}`;
  const lines = [header];
  for (let y = 0; y < size; y += 1) {
    const cells: string[] = [];
    for (let x = 0; x < size; x += 1) {
      const colour = at.get(`${x},${y}`);
      cells.push(colour !== undefined ? GO_GLYPHS[colour] : stars.has(`${x},${y}`) ? "+" : ".");
    }
    const row = String(size - y).padStart(width);
    lines.push(`${row} ${cells.join(" ")} ${row}`);
  }
  lines.push(header);

  const players = item.colours.length;
  const who = (colour: number) => `${GO_NAMES[colour]} (${GO_GLYPHS[colour]})`;
  const last = item.stones[item.stones.length - 1];
  const taken = (colour: number) => item.captures.filter((stone) => stone.by === colour).length;
  lines.push("");
  lines.push(`table ${item.id}  ${size}×${size}  revision ${item.revision}`);
  lines.push(`players: ${Array.from({ length: players }, (_, colour) => `${who(colour)} captured ${taken(colour)}`).join(", ")}`);
  if (last) lines.push(`last move: ${GO_NAMES[last.colour]} ${goCoordName(last.x, last.y, size)}`);
  /**
   * THE END, in words an agent can act on (Nikk 4504): everybody passed, the
   * board is counted by area, and nothing more can be played.
   */
  if (item.ended) {
    const { scores } = countGo(item.stones, size, players);
    const leaders = goLeaders(scores);
    lines.push(`GAME OVER: everybody passed. ${leaders.length === 1 ? `${GO_NAMES[leaders[0]]} wins` : "A tie"}.`);
    lines.push(`count (stones + surrounded points): ${scores.map((score) => `${GO_NAMES[score.colour]} ${score.total}`).join(", ")}`);
    return lines.join("\n");
  }
  if (item.passes) lines.push(`passes in a row: ${item.passes} of ${players}; when all ${players} pass, the game ends.`);
  if (item.liftedColour !== null) {
    lines.push(`${GO_NAMES[item.liftedColour]}'s stone is in the air, carried by ${item.carrier?.by ?? "somebody"} — wait for it to land.`);
  } else {
    const legal = legalGoMoves(item.stones, size, item.activeColour).length;
    lines.push(`to play: ${who(item.activeColour)}, ${legal} legal move${legal === 1 ? "" : "s"}`);
  }
  return lines.join("\n");
}
