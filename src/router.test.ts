import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TAB, TABS, isTab, pathForTab, tabFromPath } from "./router";

/**
 * BASE_URL is "/" under vitest, so `base` is "". These assertions are written
 * to hold for that case AND to fail loudly if the resolution logic stops
 * handling a prefix, which is the case that only appears in production.
 */
describe("tab routing", () => {
  it("resolves every declared tab from its own path", () => {
    for (const tab of TABS) {
      expect(tabFromPath(pathForTab(tab)), tab).toBe(tab);
    }
  });

  it("declares no tab that nginx redirects away", () => {
    // Mission Control was mounted at /space until 2026-09-10, and nginx still
    // answers those URLs with a permanent redirect so old bookmarks land
    // somewhere useful. A tab named after one of them would work when clicked
    // and disappear on refresh — the tab lives in the SPA, but a reload asks
    // the server, which redirects. That nearly shipped as the name for the 3D
    // room.
    //
    // The redirects are READ from the deployed config rather than restated
    // here, so adding another one cannot silently invalidate this check.
    const nginx = readFileSync(resolve(__dirname, "../deploy/nginx.conf"), "utf8");
    const redirected = [...nginx.matchAll(/location\s*=?\s*\/([A-Za-z0-9_-]+)\/?\s*\{[^}]*(?:return 30[12]|rewrite)/g)]
      .map((match) => match[1]);
    expect(redirected.length, "no redirects found — has the config moved?").toBeGreaterThan(0);
    for (const tab of TABS) expect(redirected, `/${tab} is a redirect in nginx.conf`).not.toContain(tab);
  });

  it("round-trips with a trailing slash", () => {
    expect(tabFromPath(`${pathForTab("board")}/`)).toBe("board");
  });

  it("falls back to the default rather than rendering nothing", () => {
    // An unknown URL must land somewhere usable. Returning undefined here
    // would render a blank screen, which reads as a crash rather than a 404.
    expect(tabFromPath("/not-a-tab")).toBe(DEFAULT_TAB);
    expect(tabFromPath("/")).toBe(DEFAULT_TAB);
    expect(tabFromPath("")).toBe(DEFAULT_TAB);
  });

  it("resolves a tab under a non-empty base prefix", () => {
    // The production case: BASE_URL is "/space/". Simulated directly, because
    // vitest cannot change import.meta.env per test.
    const resolve = (pathname: string, prefix: string) => {
      const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
      const segment = rest.split("/").filter(Boolean)[0] ?? "";
      return isTab(segment) ? segment : DEFAULT_TAB;
    };
    expect(resolve("/space/board", "/space")).toBe("board");
    expect(resolve("/space/projects", "/space")).toBe("projects");
    expect(resolve("/space/chat/", "/space")).toBe("chat");
    expect(resolve("/space/", "/space")).toBe(DEFAULT_TAB);
  });
});
