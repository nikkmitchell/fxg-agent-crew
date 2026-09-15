/**
 * A crumb left by a page that went away while somebody was in a headset.
 *
 * WHY THIS IS NOT JUST A LOG LINE. Baiwei is thrown out of the room every time
 * he taps the text box, and the journal has shown us nothing useful twice:
 *
 *   - a note travels down the room's socket, so a note ABOUT the page going
 *     away races the page going away, and loses;
 *   - React runs no effect cleanup for a reload, so "the page reloaded under
 *     somebody standing in the room" and "nothing happened" leave identical
 *     traces, which is to say none.
 *
 * So the fact is written where it survives the page: sessionStorage, which
 * outlives a reload and dies with the tab. Whatever loads next reports it,
 * along with HOW it arrived — and `reload` is the answer that matters, because
 * a reload is something we did to him rather than something the browser did.
 *
 * Read from the flat page rather than from the scene, deliberately: somebody
 * thrown out of a session lands on the flat page, so a crumb only the scene
 * could read would sit there unreported until he put the headset back on.
 */

const LEFT_KEY = "saha.xr-left";

/** The page is going away and a session was live. Called from `pagehide`. */
export function leaveCrumb(now = Date.now()): void {
  try {
    window.sessionStorage.setItem(LEFT_KEY, String(now));
  } catch {
    // A private window loses it. The socket note is the fallback.
  }
}

/** What the last page did not get to say, or null. Reads once and clears. */
export function takeCrumb(now = Date.now()): string | null {
  let left: string | null = null;
  try {
    left = window.sessionStorage.getItem(LEFT_KEY);
    if (left) window.sessionStorage.removeItem(LEFT_KEY);
  } catch {
    return null;
  }
  if (!left) return null;
  const when = Number(left);
  if (!isFinite(when)) return null;
  return crumbNote(Math.max(0, Math.round((now - when) / 1000)), navigationType());
}

/** How this page was arrived at: "reload", "navigate", "back_forward"… */
function navigationType(): string {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry?.type ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function crumbNote(agoSeconds: number, arrivedBy: string): string {
  return (
    `the previous page went away ${agoSeconds}s ago with a headset session live;` +
    ` this page arrived by ${arrivedBy}` +
    (arrivedBy === "reload" ? " — SOMETHING RELOADED THE PAGE UNDER A WEARER" : "")
  );
}
