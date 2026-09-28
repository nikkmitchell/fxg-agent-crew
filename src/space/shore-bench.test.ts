import { describe, expect, it } from "vitest";
import { wavesWatched } from "./ShoreBench";

describe("the shore bench", () => {
  it("counts whole waves that came in while you sat", () => {
    expect(wavesWatched(1, 7)).toBe(0);
    expect(wavesWatched(7, 9)).toBe(1);
    expect(wavesWatched(0, 80)).toBe(10);
  });
});
