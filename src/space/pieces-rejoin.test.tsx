// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { space } from "../space-client";
import { useHiddenPieces } from "./pieces-events";

afterEach(() => vi.restoreAllMocks());

describe("the room's hidden pieces after a rejoin (Nikk, 2026-09-28)", () => {
  it("reads them again when the connection or room changes, and takes the server's list whole", async () => {
    const answers = [
      { pieces: { hidden: [], revision: 5 } },
      { pieces: { hidden: ["Moon"], revision: 2 } },
    ];
    const read = vi.spyOn(space, "pieces").mockImplementation(async () => answers.shift() ?? { pieces: { hidden: ["Moon"], revision: 2 } });
    const { result, rerender } = renderHook(({ key }) => useHiddenPieces(key), { initialProps: { key: "connecting:meditation.AR" } });
    await waitFor(() => expect(result.current.revision).toBe(5));
    rerender({ key: "open:meditation.AR" });
    // A lower revision still wins: it is the server's truth for the room now.
    await waitFor(() => expect([...result.current.hidden]).toEqual(["Moon"]));
    expect(read).toHaveBeenCalledTimes(2);
  });
});
