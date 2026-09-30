import { describe, expect, it } from "vitest";
import { goTarget } from "./space-kit";
import { isPreviewableBranch } from "./spaces";

describe("where /go/<space> leads", () => {
  const go = (branch?: unknown, page?: unknown) => goTarget("meditation.ar", branch, page, isPreviewableBranch);
  it("is the live site by default, or a branch preview and a page in it", () => {
    expect(go()).toBe("/s/meditation.ar/");
    expect(go("main")).toBe("/s/meditation.ar/");
    expect(go("mica-sky")).toBe("/s/meditation.ar/@mica-sky/");
    expect(go("mica-sky", "rain/index.html")).toBe("/s/meditation.ar/@mica-sky/rain/index.html");
    expect(go(undefined, "test/vr.html")).toBe("/s/meditation.ar/test/vr.html");
  });
  it("never follows a branch or page that could lead elsewhere", () => {
    expect(go("../x")).toBe("/s/meditation.ar/");
    expect(go(undefined, "../../bff/x")).toBe("/s/meditation.ar/");
    expect(go(undefined, "//evil.example/x")).toBe("/s/meditation.ar/evil.example/x");
    expect(go(undefined, "a?b#c")).toBe("/s/meditation.ar/");
    expect(go(undefined, ".git/config")).toBe("/s/meditation.ar/");
  });
});
