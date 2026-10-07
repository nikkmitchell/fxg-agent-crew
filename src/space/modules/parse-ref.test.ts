import { describe, expect, it } from "vitest";
import { parseRef } from "./room-engine";

describe("a part's ref (Mica 7344: Review Studio holds a baseline at an exact deploy)", () => {
  it("reads the three forms that were already there", () => {
    expect(parseRef("orb")).toEqual({ space: null, key: "orb", branch: null, deploy: null });
    expect(parseRef("xr.instruments/drums")).toEqual({ space: "xr.instruments", key: "drums", branch: null, deploy: null });
    expect(parseRef("xr.instruments/drums@skein-arpeggiator")).toMatchObject({ branch: "skein-arpeggiator", deploy: null });
  });

  it("reads space/key~deploy as exactly that deploy, and nothing else", () => {
    expect(parseRef("open.library/library~muy0f687-459f516-4046")).toEqual({ space: "open.library", key: "library", branch: null, deploy: "muy0f687-459f516-4046" });
    expect(parseRef("library~muy0f687-459f516-4046")).toBeNull();
    expect(parseRef("open.library/library@main~muy0f687")).toBeNull();
    expect(parseRef("open.library/library~../../etc")).toBeNull();
  });
});
