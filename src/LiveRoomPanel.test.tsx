// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialConnectionState } from "./connection-state";
import { LiveRoomPanel } from "./LiveRoomPanel";

const room = vi.hoisted(() => ({ logout: vi.fn(async () => undefined) }));

vi.mock("./use-webharness-room", () => ({
  useWebharnessRoom: () => ({
    state: { ...initialConnectionState, phase: "selecting_room", rooms: [] },
    login: vi.fn(),
    logout: room.logout,
    selectRoom: vi.fn(),
    showRoomPicker: vi.fn(),
    retry: vi.fn(),
    sendMessage: vi.fn(),
    retryMessage: vi.fn(),
    dismissMessage: vi.fn(),
  }),
}));

/**
 * Signing out in the chat overlay ends the saha.ing session itself. The app
 * kept drawing signed-in pages whose every call then failed, until a reload.
 */
describe("signing out in the chat overlay", () => {
  afterEach(() => cleanup());

  it("signs out, then tells the app so it can show the sign-in page", async () => {
    const onSignedOut = vi.fn();
    render(<LiveRoomPanel onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
    expect(room.logout).toHaveBeenCalledTimes(1);
    expect(room.logout.mock.invocationCallOrder[0]).toBeLessThan(onSignedOut.mock.invocationCallOrder[0]);
  });
});
