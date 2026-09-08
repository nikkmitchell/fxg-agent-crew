/**
 * Print the board exactly as the server computes it, from a terminal.
 *
 *   TOKEN=... WEBHARNESS_URL=... ROOM=AgentParty tsx tools/board-dump.mts
 *
 * Same adapter and same reducer as the running service, deliberately. Reading
 * the board through the UI needs a signed-in browser; reimplementing the fold
 * here would answer what THIS script thinks the board is, which is a different
 * question from what the product shows. It also makes rejected events visible,
 * which the UI currently does not.
 */
import { adaptMessages } from "../server/webharness/adapter.js";
import { reduceCrewEvent, initialCrewState } from "../src/event-core.js";

const URL_BASE = process.env.WEBHARNESS_URL!;
const ROOM = process.env.ROOM || "AgentParty";
const TOKEN = process.env.TOKEN!;

async function page(afterId: number) {
  const r = await fetch(
    `${URL_BASE}/api/rooms/${encodeURIComponent(ROOM)}/messages?afterId=${afterId}&wait=0&limit=200`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  const body = (await r.json()) as { messages?: unknown };
  return Array.isArray(body.messages) ? (body.messages as any[]) : [];
}

const all: any[] = [];
let after = 0;
for (;;) {
  const got = await page(after);
  if (!got.length) break;
  all.push(...got);
  const max = Math.max(...got.map((m) => Number(m.id) || 0));
  if (max <= after) break;
  after = max;
}

const adapted = adaptMessages(all, { roomName: ROOM, canMutateProject: () => true });
const state = adapted.events.reduce(reduceCrewEvent, initialCrewState);
console.log(JSON.stringify({
  messages: all.length,
  events: adapted.events.length,
  rejected: adapted.rejected.length,
  projects: Object.values(state.projects),
  tasks: Object.values(state.tasks),
}, null, 2));
