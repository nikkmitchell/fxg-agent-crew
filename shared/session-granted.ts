/**
 * STAYING IN VR ACROSS A DOOR (Nikk, 2026-09-29: "every time I go to one of
 * the spaces or I come back to saha.ing, it takes me out of WebXR. Is it
 * possible to stay in WebXR while traveling to different web addresses?").
 *
 * A browser ends a VR session when the page changes. The Quest browser has an
 * experimental way through: when you followed a link from inside VR, the new
 * page gets a `sessiongranted` event, and a session requested in answer to it
 * starts without anybody pressing Enter VR. Where the event does not exist,
 * or the browser only grants it between pages of one site, this does nothing
 * and you press Enter VR as before.
 *
 * Shared by saha.ing's own room (src/space/xr-store.ts) and the space kit
 * (src/kit/index.ts), so both sides of a door behave the same.
 */
type XRSystemLike = { addEventListener?: (type: string, listener: () => void) => void };

let listening = false;

export function enterWhenGranted(enter: () => Promise<unknown>, xr: XRSystemLike | undefined = (globalThis.navigator as { xr?: XRSystemLike } | undefined)?.xr): boolean {
  if (listening || !xr?.addEventListener) return false;
  listening = true;
  xr.addEventListener("sessiongranted", () => {
    void enter().catch(() => undefined);
  });
  return true;
}

/** For tests: forget that a listener was added. */
export function resetGranted(): void {
  listening = false;
}
