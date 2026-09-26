import { afterEach, describe, expect, it, vi } from "vitest";
import { SendStopped, SendTimedOut, withDeadline } from "./send-timeout";

/** Nikk: "I am stuck on ... ready to send". A send must always end. */
describe("a send that cannot hang", () => {
  afterEach(() => vi.useRealTimers());

  it("passes a quick answer through", async () => {
    await expect(withDeadline(async () => "sent", new AbortController().signal, 1000)).resolves.toBe("sent");
  });

  it("gives up at the deadline even when the request never answers or listens", async () => {
    vi.useFakeTimers();
    const never = withDeadline(() => new Promise<string>(() => {}), new AbortController().signal, 1000);
    const caught = never.catch((error) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toBeInstanceOf(SendTimedOut);
  });

  it("aborts the request's own signal, so the fetch itself is cancelled", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | null = null;
    const run = withDeadline((signal) => { seen = signal; return new Promise(() => {}); }, new AbortController().signal, 500).catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    await run;
    expect(seen!.aborted).toBe(true);
  });

  it("stops at once when the person presses ✕", async () => {
    const stop = new AbortController();
    const run = withDeadline(() => new Promise<string>(() => {}), stop.signal, 60_000).catch((error) => error);
    stop.abort();
    expect(await run).toBeInstanceOf(SendStopped);
  });

  it("passes a failure through as it was", async () => {
    await expect(withDeadline(async () => { throw new Error("502"); }, new AbortController().signal)).rejects.toThrow("502");
  });
});
