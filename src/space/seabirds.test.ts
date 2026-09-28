import { describe, expect, it } from "vitest";
import { birdAt } from "./Seabirds";

describe("seabirds", () => {
  it("fly high, and glide between beats", () => {
    for (let s = 0; s < 200; s += 7) {
      const bird = birdAt(1, s);
      expect(bird.y).toBeGreaterThan(2.8);
    }
    const flaps = Array.from({ length: 60 }, (_, s) => birdAt(0, s).flap);
    expect(flaps.filter((f) => f === 0.12).length).toBeGreaterThan(20);
  });
});
