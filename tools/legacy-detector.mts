/**
 * Catch board writes still being sent the old way, and tell their author.
 *
 * After cutover a `crew-event` fence does nothing. The worst failure this whole
 * migration could produce is an agent posting one, seeing no error, and finding
 * out a fortnight later that a week of work went nowhere. Logging that for
 * ourselves is not delivery — the person who needs to know is the one who sent
 * it.
 *
 * So every fence after the watermark gets a REPLY IN THE ROOM, addressed to its
 * author, correlated to the message id, and saying NOT APPLIED in words no tool
 * can read as success.
 *
 * It does not retire on a date. An arbitrary week is a guess about how long
 * agents take to upgrade; this retires when the table has been empty long
 * enough to believe, which is a measurement.
 *
 *   DATABASE_PATH=… TOKEN=… WEBHARNESS_URL=… tools/legacy-detector.mts [--notify]
 */
import { DatabaseSync } from "node:sqlite";
import { adaptMessages } from "../server/webharness/adapter.js";
import { drainPages } from "../server/webharness/drain-pages.js";
import { openDatabase } from "../server/db/open.js";

const URL_BASE = process.env.WEBHARNESS_URL!;
const TOKEN = process.env.TOKEN!;
const DB_PATH = process.env.DATABASE_PATH ?? "./data/saha.db";
const NOTIFY = process.argv.includes("--notify");

const db = openDatabase(DB_PATH, DatabaseSync);
const cutovers = db.prepare("SELECT room, after_id FROM cutover").all() as Array<{ room: string; after_id: number }>;

if (!cutovers.length) {
  console.log("no cutover recorded — the old write path is still live, nothing to detect");
  process.exit(0);
}

let found = 0;
/** Actors already told this run. */
const told = new Set<string>();

for (const { room, after_id } of cutovers) {
  // Only messages after the watermark — everything before it was applied
  // correctly and reporting it would be a false alarm about work that
  // succeeded. But EXHAUSTIVE after it: a single 200-message page silently
  // stops at the 201st, and the writes it would miss are precisely the ones
  // sent by an agent that has not noticed the cutover and is still going.
  //
  // This is the same defect this project has now had four times, so it uses
  // drainPages like the others rather than a loop of its own.
  const messages = (await drainPages<any>({
    fetchPage: async (afterId, limit) => {
      const response = await fetch(
        `${URL_BASE}/api/rooms/${encodeURIComponent(room)}/messages?afterId=${afterId}&wait=0&limit=${limit}`,
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status} reading ${room}`);
      const body = (await response.json()) as { messages?: unknown };
      return Array.isArray(body.messages) ? (body.messages as any[]) : [];
    },
    idOf: (message) => message.id,
    startAfter: after_id,
  })).items;

  const { events } = adaptMessages(messages, { roomName: room, canMutateProject: () => true });

  for (const event of events) {
    // The adapter's ids are `wh:<room>:<messageId>:<blockIndex>`.
    const messageId = Number(String(event.eventId).split(":")[2]);
    const already = db.prepare("SELECT notified_at FROM legacy_writes WHERE message_id = ?").get(messageId) as
      | { notified_at: string | null } | undefined;
    if (already?.notified_at) continue;

    found += 1;
    db.prepare(`INSERT INTO legacy_writes (message_id, room, actor_id, seen_at, event_type)
                VALUES (?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING`)
      .run(messageId, room, event.source, new Date().toISOString(), event.payload.type);

    const receipt = [
      `@${event.source} NOT APPLIED — this board change did not happen.`,
      "",
      "```json",
      JSON.stringify({
        receipt: "legacy-write-refused",
        applied: false,
        room,
        sourceMessageId: messageId,
        actor: event.source,
        eventType: event.payload.type,
        reason: "crew-event fences stopped being the write path at the cutover below",
        cutoverAfterMessageId: after_id,
        sendInstead: "POST https://saha.ing/bff/board/… (see tools/webharness/README.md)",
      }, null, 1),
      "```",
      "",
      "Machine-readable above, in case a tool is reading this rather than a person.",
      "Your message is still in the room; only its EFFECT on the board was refused.",
    ].join("\n");

    // ONE RECEIPT PER ACTOR PER RUN. An agent whose loop is still posting
    // fences could produce dozens; replying to each would flood the room it is
    // trying to warn, which is the machine-exhaust problem wearing a safety
    // jacket. The rest are recorded and reported in the summary.
    if (NOTIFY && !told.has(event.source)) {
      told.add(event.source);
      const posted = await fetch(`${URL_BASE}/api/rooms/${encodeURIComponent(room)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ content: receipt.slice(0, 2000) }),
      });
      const sent = (await posted.json()) as { id?: number };
      db.prepare("UPDATE legacy_writes SET receipt_id = ?, notified_at = ? WHERE message_id = ?")
        .run(sent.id ?? null, new Date().toISOString(), messageId);
      console.log(`  told ${event.source} that message ${messageId} was NOT APPLIED`);
    } else if (!NOTIFY) {
      console.log(`  would tell ${event.source}: message ${messageId} (${event.payload.type}) NOT APPLIED`);
    } else {
      console.log(`  ${event.source} already told this run; message ${messageId} recorded, not replied`);
    }
  }
}

const outstanding = db.prepare("SELECT COUNT(*) c FROM legacy_writes").get() as { c: number };
const quietSince = db.prepare("SELECT MAX(seen_at) latest FROM legacy_writes").get() as { latest: string | null };

console.log(`\n${found} new legacy write(s) this run; ${outstanding.c} recorded in total.`);
if (outstanding.c === 0) {
  console.log("No legacy writer has ever been seen since cutover.");
} else {
  console.log(`Most recent: ${quietSince.latest}.`);
}
// Deliberately no "safe to retire" verdict. That is a judgement about whether
// every offline agent has come back, and this process cannot see the ones that
// have not started yet.
console.log("Retire this detector when a PERSON is satisfied no legacy writer remains — not on a date.");
