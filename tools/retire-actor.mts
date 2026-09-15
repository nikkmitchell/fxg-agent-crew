/**
 * Retire an actor: stop drawing it in the room, keep everything it did.
 *
 *   pnpm exec tsx tools/retire-actor.mts <actor-id> --as <who-decided>
 *   pnpm exec tsx tools/retire-actor.mts <actor-id> --as <who> --undo
 *
 * WHY THIS IS A TOOL AND NOT A ROUTE. Retiring somebody is an operator's act,
 * not a thing the room should let anyone do to anyone through a button. There
 * is no admin role in this product — authority here is per project, and "who
 * may declare that an actor is no longer present" is not a question the board's
 * membership model answers. Rather than invent an authority concept to justify
 * an endpoint, this runs where the database is, by somebody who already has
 * that access, and records who decided.
 *
 * WHAT IT DOES NOT DO, and will not learn to: delete. Dropping an actor row
 * takes its audit trail, cards and memberships with it and asserts that the
 * work never happened. Retiring says the true thing instead — this actor did
 * those things and is not here any more.
 *
 * The usual reason is a rename. saha.ing takes an actor id from whatever
 * WebHarness calls you, so renaming an agent leaves the old identity behind,
 * and since agents are rebuilt into the room at every restart the abandoned one
 * stands there for ever.
 */
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../server/db/open.js";
import { BoardStore } from "../server/db/store.js";

const args = process.argv.slice(2);
const undo = args.includes("--undo");
const asIndex = args.indexOf("--as");
const who = asIndex >= 0 ? args[asIndex + 1] : undefined;
const target = args.find((arg, index) => !arg.startsWith("--") && index !== asIndex + 1);

if (!target || !who) {
  console.error(`usage: retire-actor.mts <actor-id> --as <who-decided> [--undo]

  <actor-id>  the actor to retire, exactly as the room spells it
  --as        who is deciding. Recorded in the audit trail: a room that can stop
              showing a worker without saying who decided so is the thing this
              project is against.
  --undo      bring them back`);
  process.exit(2);
}

const path = process.env.SAHA_DB ?? "/opt/fxg-crew/data/saha.db";
const db = openDatabase(path, DatabaseSync);
const store = new BoardStore(db);

const before = db.prepare("SELECT id, kind, retired_at FROM actors WHERE id = ?").get(target) as
  | { id: string; kind: string | null; retired_at: string | null }
  | undefined;

if (!before) {
  // Named alternatives rather than a bare refusal: the usual cause is a spelling
  // that differs from the room's, and the next thing anybody would do is look.
  const known = (db.prepare("SELECT id FROM actors ORDER BY id").all() as { id: string }[]).map((r) => r.id);
  console.error(`no actor "${target}" in ${path}\n\nknown actors:\n  ${known.join("\n  ")}`);
  process.exit(1);
}

// What is being kept, counted and shown BEFORE anything changes — so the person
// running this sees the size of what retiring deliberately does not touch.
const counts = {
  audit: (db.prepare("SELECT COUNT(*) AS n FROM audit WHERE actor_id = ?").get(target) as { n: number }).n,
  cards: (db.prepare("SELECT COUNT(*) AS n FROM task_owners WHERE actor_id = ?").get(target) as { n: number }).n,
  memberships: (db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE actor_id = ?").get(target) as { n: number }).n,
};

/**
 * SAYS WHAT ACTUALLY HAPPENED, which is not always what was asked for.
 *
 * Both operations are idempotent, so running one twice is harmless — but the
 * first version printed "retired by <you>" either way, and that is a false
 * claim in the second case: the actor was already retired, by somebody else, on
 * a different day, and this run changed nothing. Small, and precisely the shape
 * of thing that makes a record untrustworthy. `retired_at` is read before the
 * call so the message can tell the two apart.
 */
if (undo) {
  if (!before.retired_at) {
    console.log(`${target} was not retired. Nothing to undo.`);
  } else {
    store.unretireActor({ id: who }, target);
    console.log(`${target} is present again, and will be back in the room at the next restart.`);
  }
} else if (before.retired_at) {
  console.log(`${target} was already retired at ${before.retired_at}. Nothing changed.

Its history is intact either way: ${counts.audit} audit rows, ${counts.cards} card ownerships, ${counts.memberships} memberships.`);
} else {
  store.retireActor({ id: who }, target);
  console.log(`${target} retired by ${who}.

  KEPT     ${counts.audit} audit rows, ${counts.cards} card ownerships, ${counts.memberships} memberships
  STOPPED  drawn in the room, offered for screen sharing

The room clears it at the next restart. Undo with --undo.`);
}
