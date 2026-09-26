// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { reportClientError } from "./client-errors";

afterEach(() => vi.unstubAllGlobals());

function Broken(): never {
  throw new Error("the scene fell over");
}

describe("reporting what broke on this screen", () => {
  it("sends the same error once a minute, not once a frame", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let n = 0; n < 60; n += 1) reportClientError(new Error("every frame"), "test-frame");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ message: "Error: every frame", where: "test-frame" });
  });

  it("replaces a crashed part with a way back, and reports it", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary where="scene"><Broken /></ErrorBoundary>);
    quiet.mockRestore();
    expect(screen.getByRole("alert").textContent).toMatch(/stopped working/);
    expect(screen.getByText("Try again")).toBeTruthy();
    const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(sent.some((one) => one.where === "scene" && /the scene fell over/.test(one.message))).toBe(true);
  });
});
