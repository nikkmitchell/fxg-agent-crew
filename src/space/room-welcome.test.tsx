// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { space } from "../space-client";
import { onRoomWelcome, roomWelcomed, useRoomRead } from "./room-events";
import { useSpaceSocket } from "./useSpaceSocket";

/**
 * EVERY OBJECT IN THE ROOM READS AGAIN WHEN THE ROOM SAYS WELCOME (Kerf,
 * 2026-10-14): after a dropped socket, a deploy, or a switch to another room.
 * Before, the cairn, the vase, the garden and nine more read once, when they
 * first appeared, and went on showing the room you had left.
 */
afterEach(() => vi.restoreAllMocks());

describe("useRoomRead", () => {
  it("reads at once, again on every welcome, and not after it is gone", () => {
    const read = vi.fn();
    const { unmount } = renderHook(() => useRoomRead(read));
    expect(read).toHaveBeenCalledTimes(1);
    act(() => roomWelcomed());
    act(() => roomWelcomed());
    expect(read).toHaveBeenCalledTimes(3);
    unmount();
    act(() => roomWelcomed());
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("uses the newest read it was given, not the first", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(({ room }) => useRoomRead(() => seen.push(room)), { initialProps: { room: "lobby" } });
    rerender({ room: "meditation.ar" });
    act(() => roomWelcomed());
    expect(seen).toEqual(["lobby", "meditation.ar"]);
  });
});

/** Enough of a WebSocket for the room's socket to open and hear one frame. */
class FakeSocket {
  static made: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener() {}
  send() {}
  close() {}
  fire(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("the room's socket", () => {
  it("says welcome to every object each time the room welcomes it", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.spyOn(space, "meditation").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(space, "helpers").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(space, "said").mockImplementation(() => new Promise(() => {}));
    const heard = vi.fn();
    const stop = onRoomWelcome(heard);
    const { unmount } = renderHook(() => useSpaceSocket(true, 0));
    const socket = FakeSocket.made.at(-1)!;
    const welcome = { type: "welcome", you: "Kerf", now: Date.now(), people: [], panels: [], showing: null, items: [] };
    act(() => {
      socket.readyState = 1;
      socket.fire("open");
      socket.fire("message", { data: JSON.stringify(welcome) });
    });
    expect(heard).toHaveBeenCalledTimes(1);
    // A snapshot of who is here is not a welcome.
    act(() => socket.fire("message", { data: JSON.stringify({ type: "snapshot", people: [] }) }));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    unmount();
    vi.unstubAllGlobals();
  });
});
