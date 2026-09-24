/**
 * Go, from a terminal: read a table as text and play a move through code.
 *
 * Nikk: "can we set up a way for agents to play? ... maybe put in a way for
 * agents to read the board through code and place their pieces through code."
 *
 *   export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
 *   pnpm exec tsx tools/go.mts tables                      # the Go tables in your room
 *   pnpm exec tsx tools/go.mts show [table]                # one table as text
 *   pnpm exec tsx tools/go.mts play [table] D4 --as white  # one move, in one request
 *   pnpm exec tsx tools/go.mts pass [table] --as white     # pass; when every player passes, the game ends
 *   pnpm exec tsx tools/go.mts wait [table] --as white     # returns when it is your turn, or the game ends
 *
 * To try it in a local room first: run tools/dev-room-harness.mts, then set
 * SAHA_COOKIE to one of the cookies it prints (and SAHA_URL if not :4174).
 *
 * [table] may be left out when the room has one table, or given as the start
 * of its id. --as takes a colour's name, its letter on the text board (X, O…)
 * or its bowl number.
 *
 * COORDINATES ARE GO'S OWN, as the text board prints them: columns are letters
 * from the left with no "I", rows are numbers up from the near side — the side
 * where "BLACK'S TURN" is written, which is where a person stands to play. A1 is
 * the near-left corner.
 *
 * THREE WAYS TO PLAY, all on this:
 *   - Think for yourself: `wait`, read the board it prints, `play`. A move costs
 *     the tokens it takes to read about a hundred lines and think.
 *   - Hand the game to a sub-agent that loops on `wait` → think → `play` while
 *     you work. `wait` polls the server, not a model: waiting costs nothing.
 *   - Write your own Go program and let it play. It calls the same two
 *     endpoints this does, on your own machine — nobody's code runs on the
 *     server — and costs no tokens per move at all:
 *       GET  /bff/space/items                       → { items: [table…] }
 *       POST /bff/space/items/<id>/action
 *            { "action": "play", "x": 3, "y": 5, "colour": 1, "revision": 12 }
 *     x runs left to right, y from the far side to the near side, both from 0;
 *     colour is the bowl number. A refusal says why: NOT_YOUR_TURN, a stone in
 *     somebody's hand, TABLE_CHANGED (read again and retry), or an illegal move.
 *
 * People see an agent's move land on the table exactly as if it had been
 * placed by hand. A stone in a person's hand is never taken: `play` refuses
 * until it lands.
 */
import { signIn } from "./saha-session.mts";
import { GO_NAMES, goBoardText, goColourOf, goCoordName, parseGoCoord } from "../shared/go-text.ts";
import type { GoRoomItem } from "../shared/room-items.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const words = process.argv.slice(2).filter((word, index, all) => {
  if (word.startsWith("--")) return false;
  return !(index > 0 && all[index - 1]?.startsWith("--"));
});
const [command, ...rest] = words;

const usage = (): never => {
  console.error("usage: go.mts tables | show [table] | play [table] <D4> --as <colour> | pass [table] --as <colour> | wait [table] --as <colour> [--every <seconds>]");
  process.exit(2);
};
if (!command) usage();

// SAHA_COOKIE (with SAHA_URL) plays in a local tools/dev-room-harness.mts room,
// using one of the cookies it prints — how this was tried before it shipped.
const { cookie, site: SITE } = process.env.SAHA_COOKIE
  ? { cookie: process.env.SAHA_COOKIE, site: process.env.SAHA_URL ?? "http://127.0.0.1:4174" }
  : await signIn();

type Answer = { status: number; body: Record<string, unknown> };
const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
  const response = await fetch(`${SITE}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = { text };
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Keep a non-JSON body as it came.
  }
  return { status: response.status, body: parsed };
};

const tables = async (): Promise<GoRoomItem[]> => {
  const answer = await call("GET", "/bff/space/items");
  if (answer.status !== 200) {
    console.error(`${answer.status} ${JSON.stringify(answer.body)}`);
    process.exit(1);
  }
  return ((answer.body.items as GoRoomItem[] | undefined) ?? []).filter((item) => item.kind === "go");
};

/** The table meant: the only one, or the one whose id starts with what was given. */
const pick = (all: GoRoomItem[], given: string | undefined): GoRoomItem => {
  const matches = given ? all.filter((table) => table.id.startsWith(given)) : all;
  if (matches.length === 1) return matches[0];
  console.error(matches.length === 0
    ? given ? `no Go table starts with "${given}"` : "there is no Go table in your room"
    : `${matches.length} tables — say which: ${matches.map((table) => table.id.slice(0, 8)).join(", ")}`);
  process.exit(1);
};

const colourFor = (table: GoRoomItem): number => {
  const given = flag("--as");
  if (!given) {
    console.error(`say which colour you are playing: --as ${GO_NAMES.slice(0, table.colours.length).join(" | ").toLowerCase()}`);
    process.exit(2);
  }
  const colour = goColourOf(given, table.colours.length);
  if (colour === null) {
    console.error(`"${given}" is not seated at this table; it has ${GO_NAMES.slice(0, table.colours.length).join(", ")}`);
    process.exit(2);
  }
  return colour;
};

if (command === "tables") {
  const all = await tables();
  if (all.length === 0) console.log("no Go tables in your room");
  for (const table of all) {
    const turn = table.ended ? "game over" : table.liftedColour !== null ? `${GO_NAMES[table.liftedColour]}'s stone in the air` : `${GO_NAMES[table.activeColour]} to play`;
    console.log(`${table.id}  ${table.size}×${table.size} ${table.surface ?? "bamboo"}  ${table.colours.length} players  ${table.stones.length} stones  ${turn}`);
  }
} else if (command === "show") {
  console.log(goBoardText(pick(await tables(), rest[0])));
} else if (command === "play") {
  // The coordinate is the last word; a table, if given, comes before it.
  const coordText = rest[rest.length - 1];
  if (!coordText) usage();
  const table = pick(await tables(), rest.length > 1 ? rest[0] : undefined);
  const colour = colourFor(table);
  const point = parseGoCoord(coordText, table.size);
  if (!point) {
    console.error(`"${coordText}" is not a point on a ${table.size}×${table.size} board (columns A–${goCoordName(table.size - 1, 0, table.size)[0]} without I, rows 1–${table.size})`);
    process.exit(2);
  }
  const answer = await call("POST", `/bff/space/items/${table.id}/action`, { action: "play", ...point, colour, revision: table.revision });
  if (answer.status === 200) {
    console.log(`played ${GO_NAMES[colour]} ${goCoordName(point.x, point.y, table.size)}\n`);
    console.log(goBoardText(answer.body.item as GoRoomItem));
  } else {
    console.error(`refused: ${String(answer.body.error ?? answer.status)}\n`);
    console.error(goBoardText((await tables()).find((one) => one.id === table.id) ?? table));
    process.exit(1);
  }
} else if (command === "pass") {
  // Passing is a move: it names the colour, like `play`, so it can never land
  // on somebody else's turn. When every seated colour has passed in a row, the
  // game is over and the board is counted.
  const table = pick(await tables(), rest[0]);
  const colour = colourFor(table);
  const answer = await call("POST", `/bff/space/items/${table.id}/action`, { action: "pass", colour, revision: table.revision });
  if (answer.status === 200) {
    console.log(`${GO_NAMES[colour]} passed\n`);
    console.log(goBoardText(answer.body.item as GoRoomItem));
  } else {
    console.error(`refused: ${String(answer.body.error ?? answer.status)}`);
    process.exit(1);
  }
} else if (command === "wait") {
  const every = Math.max(2, Number(flag("--every") ?? 5)) * 1000;
  const first = pick(await tables(), rest[0]);
  const colour = colourFor(first);
  for (;;) {
    const table = (await tables()).find((one) => one.id === first.id);
    if (!table) {
      console.error("the table is gone");
      process.exit(1);
    }
    // A game that has ended will never be your turn again: say so and stop,
    // or a sub-agent looping on `wait` waits for ever.
    if (table.ended) {
      console.log(goBoardText(table));
      process.exit(0);
    }
    if (table.activeColour === colour && table.liftedColour === null) {
      console.log(`${GO_NAMES[colour]} to play\n`);
      console.log(goBoardText(table));
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, every));
  }
} else usage();
