import { describe, expect, it } from "vitest";
import { retryDelay } from "./use-webharness-room";

describe("room reconnect backoff", () => {
  it("backs off exponentially and caps at fifteen seconds", () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  });
});

