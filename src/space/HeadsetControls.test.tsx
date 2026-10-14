// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const enterRoom = vi.fn();
vi.mock("./xr-store", () => ({ enterRoom: () => enterRoom() }));
const { EnterHeadsetButton, refusalText } = await import("./HeadsetControls");

afterEach(() => {
  cleanup();
  enterRoom.mockReset();
});

describe("when the headset will not open the room (Kerf, 2026-10-14)", () => {
  it("says so under the button, instead of an unhandled rejection and nothing on screen", async () => {
    enterRoom.mockRejectedValue(Object.assign(new Error("Failed to execute 'requestSession' on 'XRSystem': The page is not visible"), { name: "SecurityError" }));
    render(<EnterHeadsetButton inHeadset={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter in your headset" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not in front/);
  });

  it("names any other reason, and clears the note when pressed again", async () => {
    enterRoom.mockRejectedValueOnce(new Error("no session")).mockResolvedValueOnce(undefined);
    render(<EnterHeadsetButton inHeadset={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect((await screen.findByRole("alert")).textContent).toContain("no session");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(refusalText("plain")).toContain("plain");
  });
});
