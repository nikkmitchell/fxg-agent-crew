/**
 * An agent's helpers, as the agent reports them.
 *
 * Nikk's proposal (saha-ing-737ee1ae, from Baiwei's list): "when an agent
 * spawns helpers to work on a task, show a few small, semi-transparent, playful
 * spirit companions around the parent agent". The card is explicit about what
 * this must NOT be: "do not invent presence or count a spirit as an agent".
 *
 * THE AGENT SAYS, THE ROOM DRAWS. Nothing in saha.ing can see another
 * process's subagents; the only honest source is the parent agent itself. So
 * an agent posts the helpers it has running (a short label and a state) and
 * the room draws that, for as long as the agent keeps saying it. Helpers are
 * never people: they are not in presence, the roster or any count of who is
 * here.
 *
 * STALE IS GONE. A report the agent stops refreshing expires, so a parent that
 * crashed does not leave spirits circling it forever.
 */

export type HelperState = "working" | "done";
export type Helper = { label: string; state: HelperState };
export type HelperReport = { helpers: Helper[]; at: number };

/** Most helpers a report may list; more than this is a crowd, not a cue. */
export const MAX_HELPERS = 8;
/** A report older than this is dropped: the agent must keep saying it. */
export const HELPERS_TTL_MS = 10 * 60_000;
/** A finished helper lingers this long, so the fade is seen, then goes. */
export const DONE_LINGER_MS = 4_000;

/** A report from the wire, checked; null says why it was refused. */
export function parseHelpers(value: unknown): { helpers: Helper[] } | { refused: string } {
  const list = (value as { helpers?: unknown } | null)?.helpers;
  if (!Array.isArray(list)) return { refused: "send { helpers: [{ label, state }] }, an empty list to clear" };
  if (list.length > MAX_HELPERS) return { refused: `at most ${MAX_HELPERS} helpers` };
  const helpers: Helper[] = [];
  for (const one of list) {
    const label = typeof one?.label === "string" ? one.label.trim().slice(0, 60) : "";
    const state = one?.state === "done" ? "done" : one?.state === "working" || one?.state === undefined ? "working" : null;
    if (!label || !state) return { refused: "each helper needs a label, and a state of working or done" };
    helpers.push({ label, state });
  }
  return { helpers };
}

/**
 * What to draw now, from the reports: expired reports gone, finished helpers
 * gone once their linger is over, and agents left with nothing dropped.
 */
export function liveHelpers(
  reports: Readonly<Record<string, HelperReport>>,
  now: number,
): Record<string, Helper[]> {
  const out: Record<string, Helper[]> = {};
  for (const [actorId, report] of Object.entries(reports)) {
    const age = now - report.at;
    if (age > HELPERS_TTL_MS) continue;
    const shown = report.helpers.filter((helper) => helper.state === "working" || age <= DONE_LINGER_MS);
    if (shown.length > 0) out[actorId] = shown;
  }
  return out;
}

/** The words for a hover or a screen reader: how many, and who. */
export function helperSummary(helpers: readonly Helper[]): string {
  const working = helpers.filter((h) => h.state === "working");
  if (working.length === 0) return "helpers finished";
  return `${working.length} helper${working.length === 1 ? "" : "s"} working: ${working.map((h) => h.label).join(", ")}`;
}
