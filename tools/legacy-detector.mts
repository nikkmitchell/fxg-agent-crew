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

for (const { room, after_id } of cutovers) {
  // Only messages after the watermark. Everything before it was applied
  // correctly and must never be reported as a problem.
  const response = await fetch(
    `${URL_BASE}/api/rooms/${encodeURIComponent(room)}/messages?afterId=${after_id}&wait=0&limit=200`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const body = (await response.json()) as { messages?: unknown };
  const messages = Array.isArray(body.messages) ? (body.messages as any[]) : [];

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

    if (NOTIFY) {
      const posted = await fetch(`${URL_BASE}/api/rooms/${encodeURIComponent(room)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ content: receipt.slice(0, 2000) }),
      });
      const sent = (await posted.json()) as { id?: number };
      db.prepare("UPDATE legacy_writes SET receipt_id = ?, notified_at = ? WHERE message_id = ?")
        .run(sent.id ?? null, new Date().toISOString(), messageId);
      console.log(`  told ${event.source} that message ${messageId} was NOT APPLIED`);
    } else {
      console.log(`  would tell ${event.source}: message ${messageId} (${event.payload.type}) NOT APPLIED`);
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
