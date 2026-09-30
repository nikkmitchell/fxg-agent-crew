import { describe, expect, it } from "vitest";
import { canFrame, screenAddress, screenTitle } from "./screen";

describe("a screen's address (Sill's plan for spaces, B)", () => {
  it("resolves a space's path against the server, and keeps a full address as it is", () => {
    expect(screenAddress("/s/xr.instruments/", "https://saha.ing")).toBe("https://saha.ing/s/xr.instruments/");
    expect(screenAddress("/s/xr.instruments/", "https://saha.ing/")).toBe("https://saha.ing/s/xr.instruments/");
    expect(screenAddress("https://example.com/app", "https://saha.ing")).toBe("https://example.com/app");
  });

  it("never shows anything but a web page, so it cannot be made to run code", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "blob:https://saha.ing/x", "file:///etc/passwd"]) {
      expect(() => screenAddress(bad, "https://saha.ing")).toThrow(/web pages only/);
    }
  });

  it("names a space by its space, and anything else by its host", () => {
    expect(screenTitle("https://saha.ing/s/meditation.ar/@wip/")).toBe("meditation.ar");
    expect(screenTitle("https://example.com/app")).toBe("example.com");
  });

  it("knows before trying that a saha.ing page cannot be framed from inside a space (Sill, 6468)", () => {
    // Inside a space: the page is sandboxed, its origin is "null".
    expect(canFrame("https://saha.ing/s/xr.instruments/", "null", "https://saha.ing")).toBe(false);
    // On saha.ing itself, or for another site, it is worth trying.
    expect(canFrame("https://saha.ing/s/xr.instruments/", "https://saha.ing", "https://saha.ing")).toBe(true);
    expect(canFrame("https://example.com/app", "null", "https://saha.ing")).toBe(true);
  });
});
