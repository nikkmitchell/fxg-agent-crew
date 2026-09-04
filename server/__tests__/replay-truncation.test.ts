import { describe, expect, it } from "vitest";
import { ReplayTruncatedError, replayProjectState } from "../routes/projects.js";
import type { Message } from "../../shared/contracts.js";

/**
 * Two failure modes that both LOOK like success, which is why they need tests
 * rather than care.
 */

const page = (start: number, count: number): Message[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: start + index,
    roomName: "AgentParty",
    username: "nikk",
    content: "ordinary chatter, not an event",
    createdAt: "2026-09-05T00:00:00Z",
  })) as unknown as Message[];

describe("replay truncation", () => {
  it("throws rather than returning a board that is missing its oldest history", async () => {
    // Every page comes back full, so the reader can never tell it has finished.
    // Returning here would hand back a projection that looks complete and is
    // missing whatever came before the cut.
    const client = {
      request: async (path: string) => {
        const afterId = Number(new URL(`http://x${path}`).searchParams.get("afterId") ?? 0);
        return { messages: page(afterId + 1, 100) };
      },
    };

    await expect(
      replayProjectState(client as never, "AgentParty", "token", () => true),
    ).rejects.toBeInstanceOf(ReplayTruncatedError);
  });

  it("returns normally when a short page proves the history ended", async () => {
    const client = {
      request: async (path: string) => {
        const afterId = Number(new URL(`http://x${path}`).searchParams.get("afterId") ?? 0);
        return { messages: afterId === 0 ? page(1, 3) : { messages: [] } && [] };
      },
    };

    const state = await replayProjectState(client as never, "AgentParty", "token", () => true);
    expect(state.projects).toEqual([]);
  });

  it("returns normally on an empty room", async () => {
    const client = { request: async () => ({ messages: [] }) };
    const state = await replayProjectState(client as never, "AgentParty", "token", () => true);
    expect(state.projects).toEqual([]);
  });
});
