/**
 * Tab routing on real URLs, not component state.
 *
 * A tab you cannot link to, refresh, or send to someone is not a location —
 * and "it broke when I refreshed" stops being testable, because there is
 * nothing to refresh back into. Every tab here is a real path under the app's
 * base, so a reload lands where you were.
 *
 * This depends on the server serving index.html for unknown paths beneath the
 * base path, which it does (see the notFoundHandler in server/index.ts). It
 * must keep doing so: without that, these URLs 404 on refresh while working
 * fine when clicked, which is the confusing half-broken state.
 */

export const TABS = ["projects", "board", "rooms", "activity"] as const;
export type Tab = (typeof TABS)[number];

export const DEFAULT_TAB: Tab = "projects";

/** Base path with no trailing slash: "/space" in production, "" in dev. */
export const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

/**
 * The tab for a pathname. Anything unrecognised resolves to the default rather
 * than rendering nothing — an unknown URL should land somewhere usable, not on
 * a blank screen that looks like a crash.
 */
export function tabFromPath(pathname: string): Tab {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const segment = rest.split("/").filter(Boolean)[0] ?? "";
  return isTab(segment) ? segment : DEFAULT_TAB;
}

export function pathForTab(tab: Tab): string {
  return `${base}/${tab}`;
}
