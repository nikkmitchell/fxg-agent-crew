// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSummary } from "../shared/contracts";
import { ApiError } from "./api-request";
import { Home } from "./Home";

const roomApi = vi.hoisted(() => ({
  rooms: vi.fn(),
  publicRooms: vi.fn(),
  joinRoom: vi.fn(),
}));

vi.mock("./bff-client", () => ({ bff: roomApi }));

describe("room join announcements and focus", () => {
  let joinedRooms: RoomSummary[];

  beforeEach(() => {
    joinedRooms = [{ roomName: "saha.ing", ownerName: "Nikk2", visibility: "public" }];
    roomApi.rooms.mockImplementation(() => Promise.resolve(joinedRooms));
    roomApi.publicRooms.mockResolvedValue([]);
    roomApi.joinRoom.mockReset();
  });

  afterEach(() => cleanup());

  it("keeps the pending room announcement stable and focuses Enter after success", async () => {
    let finishJoin!: (result: { roomName: string; joined: boolean }) => void;
    roomApi.joinRoom.mockImplementation(() => new Promise((resolve) => { finishJoin = resolve; }));
    render(<Home onEnter={vi.fn(async () => undefined)} />);

    await screen.findByRole("button", { name: "Enter saha.ing" });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    expect(status.closest('[aria-busy="true"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Join by name" }));
    const nameField = screen.getByRole("textbox", { name: "Room name" });
    fireEvent.change(nameField, { target: { value: "quiet room" } });
    fireEvent.submit(nameField.closest("form")!);

    await waitFor(() => expect(roomApi.joinRoom).toHaveBeenCalledWith("quiet room", undefined));
    expect(status.textContent).toBe("Joining quiet room…");
    fireEvent.change(nameField, { target: { value: "edited draft" } });
    expect(status.textContent).toBe("Joining quiet room…");

    joinedRooms = [...joinedRooms, { roomName: "quiet room", ownerName: "Moraine", visibility: "private" }];
    finishJoin({ roomName: "quiet room", joined: true });

    const enter = await screen.findByRole("button", { name: "Enter quiet room" });
    await waitFor(() => expect(document.activeElement).toBe(enter));
    expect(status.textContent).toBe("");
  });

  it("returns focus to Room name after a failed join", async () => {
    roomApi.joinRoom.mockRejectedValue(new ApiError("No room", 404, "ROOM_NOT_FOUND"));
    render(<Home onEnter={vi.fn(async () => undefined)} />);

    await screen.findByRole("button", { name: "Enter saha.ing" });
    fireEvent.click(screen.getByRole("button", { name: "Join by name" }));
    const nameField = screen.getByRole("textbox", { name: "Room name" });
    fireEvent.change(nameField, { target: { value: "mistyped room" } });
    fireEvent.submit(nameField.closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("No room has that name");
    await waitFor(() => expect(document.activeElement).toBe(nameField));
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
