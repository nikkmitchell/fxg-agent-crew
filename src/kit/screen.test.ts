import { describe, expect, it } from "vitest";
import { screenAddress, screenTitle } from "./screen";

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
});
