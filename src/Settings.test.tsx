// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings";

const api = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("./bff-client", () => ({ bff: api }));
vi.mock("./MyScreenSettings", () => ({ MyScreenSettings: () => null }));
vi.mock("./ProjectChooser", () => ({ ProjectChooser: () => null }));

/** The site had no Sign out at all outside the chat overlay (Nikk, 2026-10-14). */
describe("signing out from Settings", () => {
  afterEach(() => {
    cleanup();
    api.logout.mockReset();
  });

  it("says who you are, signs out, and tells the app", async () => {
    api.logout.mockResolvedValue({ ok: true });
    const onSignedOut = vi.fn();
    render(<Settings you="Nikk2" onClose={vi.fn()} onSignedOut={onSignedOut} />);
    expect(screen.getByText("Nikk2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
    expect(api.logout).toHaveBeenCalledTimes(1);
  });

  it("stays signed in, and says so, when the server does not answer", async () => {
    api.logout.mockRejectedValue(new Error("offline"));
    const onSignedOut = vi.fn();
    render(<Settings you="Nikk2" onClose={vi.fn()} onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toContain("still signed in");
    expect(onSignedOut).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
