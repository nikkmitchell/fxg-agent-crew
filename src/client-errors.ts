import { base } from "./router";

/**
 * Tell the server when something breaks on this screen (server/space/client-errors.ts).
 *
 * The same message is sent once a minute at most, so an error thrown every
 * frame is one report, not sixty a second. Sent with `keepalive` and never
 * through the room socket: a report must get out even while the page is
 * unloading, and must not wait behind the room's own traffic.
 */
const SENT_RECENTLY_MS = 60_000;
const lastSent = new Map<string, number>();

/** Whether the page is in a headset session; set by the scene. */
let inXr = false;
export function markInXr(value: boolean): void {
  inXr = value;
}

export function reportClientError(error: unknown, where = "page"): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? error.stack ?? null : null;
  const now = Date.now();
  const key = `${where}\u0000${message}`;
  if ((lastSent.get(key) ?? 0) > now - SENT_RECENTLY_MS) return;
  lastSent.set(key, now);
  if (lastSent.size > 200) lastSent.clear();
  try {
    void fetch(`${base}/bff/client-error`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        stack,
        where,
        page: location.pathname,
        inXr,
        // The entry script's hashed name says which build this page is running.
        build: document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src.split("/").pop() ?? null,
      }),
    }).catch(() => undefined);
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

let installed = false;
/** Report every uncaught error and unhandled rejection from now on. */
export function installErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message, "uncaught"));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, "unhandled-promise"));
}
