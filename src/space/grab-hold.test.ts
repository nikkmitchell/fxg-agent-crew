import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RENEW_MS, grabHold } from "./grab-hold";

/**
 * The client's half of "if somebody's already grabbed it then it's not
 * movable". The server's half is server/__tests__/holds.test.ts.
 */
const held = (by: string) => Object.assign(new Error(`${by} is moving this right now.`), { code: "HELD" });

/** A server whose answers are handed out by the test, one at a time. */
function server() {
  const calls: { thing: string; held: boolean; answer: (error?: Error) => void }[] = [];
  const api = (thing: string, isHeld: boolean) =>
    new Promise<unknown>((resolve, reject) => {
      calls.push({ thing, held: isHeld, answer: (error) => (error ? reject(error) : resolve({ ok: true })) });
    });
  return { api, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());

describe("a grab's hold", () => {
  /** Nikk: "allow me to change it first and then it should update the server". */
  it("never makes the grab wait: take returns before the server has answered", () => {
    const { api, calls } = server();
    const hold = grabHold({ thing: "panel:said", api, refused: vi.fn() });
    hold.take();
    expect(calls).toEqual([expect.objectContaining({ thing: "panel:said", held: true })]);
  });

  it("lets go and names the holder when somebody else has it", async () => {
    const { api, calls } = server();
    const refused = vi.fn();
    const hold = grabHold({ thing: "panel:said", api, refused });
    hold.take();
    calls[0].answer(held("Nikk2"));
    await settle();
    expect(refused).toHaveBeenCalledWith("Nikk2 is moving this right now.");

    // Refused means nothing of ours to let go of, and no more renewing.
    hold.release();
    vi.advanceTimersByTime(RENEW_MS * 3);
    await settle();
    expect(calls).toHaveLength(1);
  });

  /** A dropped connection or a deploy mid-drag is not somebody else holding it. */
  it("carries on through any other failure", async () => {
    const { api, calls } = server();
    const refused = vi.fn();
    const hold = grabHold({ thing: "panel:said", api, refused });
    hold.take();
    calls[0].answer(Object.assign(new Error("offline"), { code: "NETWORK" }));
    await settle();
    expect(refused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RENEW_MS);
    expect(calls).toHaveLength(2);
  });

  it("keeps saying 'still mine' while the drag goes on, and stops when it ends", async () => {
    const { api, calls } = server();
    const hold = grabHold({ thing: "panel:said", api, refused: vi.fn() });
    hold.take();
    vi.advanceTimersByTime(RENEW_MS * 3);
    expect(calls.filter((call) => call.held)).toHaveLength(4);

    calls.forEach((call) => call.answer());
    hold.release();
    await settle();
    vi.advanceTimersByTime(RENEW_MS * 3);
    await settle();
    expect(calls.filter((call) => call.held)).toHaveLength(4);
    expect(calls.at(-1)).toMatchObject({ held: false });
  });

  /**
   * THE ORDER THAT MATTERS. Released at once, the release could overtake the
   * save, somebody else could take hold in the gap, and this very drop would
   * then be refused as theirs.
   */
  it("lets go only after the save has landed", async () => {
    const { api, calls } = server();
    const hold = grabHold({ thing: "panel:said", api, refused: vi.fn() });
    hold.take();
    calls[0].answer();
    let landed!: () => void;
    const saved = new Promise<void>((resolve) => (landed = resolve));
    hold.release(saved);
    await settle();
    expect(calls.some((call) => !call.held)).toBe(false);

    landed();
    await settle();
    expect(calls.at(-1)).toMatchObject({ thing: "panel:said", held: false });
  });

  it("lets go only after its own claim has been answered, never ahead of it", async () => {
    const { api, calls } = server();
    const hold = grabHold({ thing: "panel:said", api, refused: vi.fn() });
    hold.take();
    hold.release(Promise.resolve());
    await settle();
    expect(calls).toHaveLength(1);

    calls[0].answer();
    await settle();
    expect(calls.at(-1)).toMatchObject({ held: false });
  });

  it("lets go even when the save failed — a refused save is still the end of the drag", async () => {
    const { api, calls } = server();
    const hold = grabHold({ thing: "panel:said", api, refused: vi.fn() });
    hold.take();
    calls[0].answer();
    hold.release(Promise.reject(new Error("refused")));
    await settle();
    expect(calls.at(-1)).toMatchObject({ held: false });
  });

  /** Press, release, press again inside one round trip. */
  it("is not cancelled by a refusal that was about an earlier grab", async () => {
    const { api, calls } = server();
    const refused = vi.fn();
    const hold = grabHold({ thing: "panel:said", api, refused });
    hold.take();
    hold.release();
    hold.take();
    calls[0].answer(held("Nikk2"));
    await settle();
    expect(refused).not.toHaveBeenCalled();

    calls[1].answer(held("Nikk2"));
    await settle();
    expect(refused).toHaveBeenCalledTimes(1);
  });
});
