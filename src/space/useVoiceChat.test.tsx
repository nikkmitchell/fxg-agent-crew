// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "../../shared/space-wire";
import { useVoiceChat } from "./useVoiceChat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("the room voice toggle", () => {
  const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  afterEach(() => {
    cleanup();
    if (previousMediaDevices) Object.defineProperty(navigator, "mediaDevices", previousMediaDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("does not open two microphone streams while permission is pending", async () => {
    const prompt = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => prompt.promise);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const send = vi.fn<(message: ClientMessage) => void>();
    // The hook only subscribes to server messages; this room is otherwise empty.
    const listen = vi.fn<(handler: (message: ServerMessage) => void) => () => void>(() => () => {});
    const { result } = renderHook(() => useVoiceChat(send, listen, "Moraine", ["Moraine"]));

    act(() => {
      result.current.setOn(true);
      result.current.setOn(true);
    });
    expect(result.current.starting).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const track = { stop: vi.fn() };
    prompt.resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await waitFor(() => expect(result.current.on).toBe(true));
    expect(result.current.starting).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: "voicePresence", on: true });
  });

  it("keeps a cancelled permission prompt from turning the microphone back on", async () => {
    const prompt = deferred<MediaStream>();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => prompt.promise) },
    });
    const send = vi.fn<(message: ClientMessage) => void>();
    const listen = vi.fn<(handler: (message: ServerMessage) => void) => () => void>(() => () => {});
    const { result } = renderHook(() => useVoiceChat(send, listen, "Moraine", ["Moraine"]));

    act(() => result.current.setOn(true));
    act(() => result.current.setOn(false));
    const track = { stop: vi.fn() };
    prompt.resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());

    expect(result.current.on).toBe(false);
    expect(result.current.starting).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: "voicePresence", on: false });
  });
});
