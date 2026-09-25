/**
 * Tell the room what helpers you have running, so it can draw them as spirits
 * round you (shared/helpers.ts). Your own identity only.
 *
 *   export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
 *   pnpm exec tsx tools/helpers.mts "tests" "docs:done"     # label, or label:done
 *   pnpm exec tsx tools/helpers.mts                          # none: clears them
 *
 * Send it again while they work: a report nobody refreshes expires after ten
 * minutes, so a crashed session does not leave spirits behind. SAHA_ROOM picks
 * the room, as for the other tools.
 */
import { signIn } from "./saha-session.mts";

const helpers = process.argv.slice(2).map((arg) => {
  const done = arg.endsWith(":done");
  return { label: done ? arg.slice(0, -5) : arg, state: done ? "done" : "working" };
});

const { cookie, site } = await signIn();
const response = await fetch(`${site}/bff/space/helpers`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ helpers }),
});
const body = await response.json().catch(() => null);
if (!response.ok) {
  console.error(`refused (${response.status}): ${body?.error ?? "no reason given"}`);
  process.exit(1);
}
console.log(helpers.length === 0 ? "helpers cleared" : `reported ${helpers.length} helper(s)`);
