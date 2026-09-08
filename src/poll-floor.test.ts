import { describe, expect, it } from "vitest";
import { MIN_POLL_INTERVAL_MS, retryDelay } from "./use-webharness-room";

/**
 * The poll loop trusts the server to hold the connection for `wait=25`. When
 * something in the path does not — a proxy that terminates long polls, a
 * gateway that buffers, a server that ignores the parameter — every request
 * returns instantly and the loop reissues instantly.
 *
 * Measured against a stand-in upstream that ignores `wait`: over a hundred
 * thousand requests from a single idle tab, bounded only by network speed.
 * Locally that is invisible. In front of a real server it is one browser tab
 * quietly performing a denial of service.
 */
describe("polling has a floor", () => {
  it("bounds the abnormal case without slowing the normal one", () => {
    expect(MIN_POLL_INTERVAL_MS).toBeGreaterThan(0);
    // Small enough that a genuinely new message is not delayed noticeably.
    expect(MIN_POLL_INTERVAL_MS).toBeLessThanOrEqual(1_000);
  });

  it("is far below the long-poll window it is protecting", () => {
    // If the floor ever approached the 25s wait it would be throttling the
    // normal path rather than the broken one.
    expect(MIN_POLL_INTERVAL_MS).toBeLessThan(25_000 / 10);
  });

  it("leaves the failure backoff alone, which is a different problem", () => {
    // The floor spaces SUCCESSFUL polls. Failures already back off
    // exponentially, and conflating the two would either hammer a failing
    // server or add seconds of latency to a healthy one.
    expect(retryDelay(1)).toBeGreaterThan(MIN_POLL_INTERVAL_MS);
  });
});
