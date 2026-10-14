import { describe, expect, it } from "vitest";
import { connectSaha } from "./connect";

/** A socket that says hello as saha.ing would, with saha.ing's clock `ahead` ms from this device's. */
function fakeSocket(ahead: number | null) {
  return class {
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      setTimeout(() => {
        this.onopen?.();
        const hello = { t: "hello", you: null, guest: true, space: "kerf.beats", state: {}, people: [], ...(ahead === null ? {} : { now: Date.now() + ahead }) };
        this.onmessage?.({ data: JSON.stringify(hello) });
      }, 0);
    }
    send() {}
    close() {}
  } as unknown as typeof WebSocket;
}

const ready = (ahead: number | null) =>
  new Promise<ReturnType<typeof connectSaha>>((resolve) => {
    const room = connectSaha({ server: "https://saha.test", space: "kerf.beats", ticket: null, href: "https://saha.test/s/kerf.beats/", WebSocket: fakeSocket(ahead) });
    room.on("ready", () => resolve(room));
  });

describe("the space's clock (Kerf, 2026-10-14)", () => {
  it("is saha.ing's, however far this device's clock is out", async () => {
    const room = await ready(60_000);
    expect(room.now() - Date.now()).toBeGreaterThan(59_000);
    expect(room.now() - Date.now()).toBeLessThan(61_000);
    room.leave();
  });

  it("counts from when the hello arrived, not from when a busy page read it", async () => {
    // Arrived 1.5 s before the page handled it: the clock is set as of arrival.
    const room = await new Promise<ReturnType<typeof connectSaha>>((resolve) => {
      const Socket = class {
        readyState = 1;
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string; timeStamp: number }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          setTimeout(() => {
            this.onopen?.();
            const arrived = performance.now() - 1500;
            const hello = { t: "hello", you: null, guest: true, space: "kerf.beats", state: {}, people: [], now: Date.now() - 1500 };
            this.onmessage?.({ data: JSON.stringify(hello), timeStamp: arrived });
          }, 0);
        }
        send() {}
        close() {}
      } as unknown as typeof WebSocket;
      const joined = connectSaha({ server: "https://saha.test", space: "kerf.beats", ticket: null, href: "https://saha.test/s/kerf.beats/", WebSocket: Socket });
      joined.on("ready", () => resolve(joined));
    });
    // Same clocks, read 1.5 s late: a clock set from Date.now() would be 1.5 s behind.
    expect(Math.abs(room.now() - Date.now())).toBeLessThan(100);
    room.leave();
  });

  it("is this device's own when an older server sends no time", async () => {
    const room = await ready(null);
    expect(Math.abs(room.now() - Date.now())).toBeLessThan(50);
    room.leave();
  });
});
