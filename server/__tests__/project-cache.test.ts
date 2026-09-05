import { describe, expect, it } from "vitest";
import { ProjectStateCache } from "../webharness/project-cache.js";
import { SERVER_MAX_PAGE } from "../webharness/drain-pages.js";

/**
 * The regression that matters: a second load must NOT refetch history.
 *
 * Without it the board's cost grows with the room's conversation volume rather
 * than with project activity, which is how it reached 7-15s and a 30s timeout
 * in a room the team actually talks in.
 */

type Call = { afterId: number };

function fakeClient(messagesById: Record<number, string>, calls: Call[]) {
  return {
    request: async <T,>(path: string): Promise<T> => {
      // Read the store on every call. Snapshotting the ids at construction
      // made messages added later invisible, which looked like the cache
      // failing to fold rather than the fake failing to serve.
      const ids = Object.keys(messagesById).map(Number).sort((a, b) => a - b);
      const afterId = Number(new URL(`http://x${path}`).searchParams.get("afterId") ?? 0);
      calls.push({ afterId });
      const batch = ids
        .filter((id) => id > afterId)
        .slice(0, 50)
        .map((id) => ({
          id,
          roomName: "AgentParty",
          username: "claude-nikk2mbp",
          content: messagesById[id],
          // Real WebHarness messages carry msgType and the adapter requires it.
          // Omitting it made every event reject for a reason unrelated to the
          // cache under test.
          msgType: "text",
          streaming: false,
          createdAt: "2026-09-05T00:00:00Z",
          updatedAt: "2026-09-05T00:00:00Z",
        }));
      return { messages: batch } as T;
    },
  };
}

/**
 * A VALID project event. goals and steps must each carry 1-10 entries and the
 * summary may not be empty — an earlier version of this fixture had all three
 * empty, so every event was correctly rejected and the cache looked broken
 * when it was the fixture that was wrong.
 */
const projectEvent = (id: string, name: string) =>
  "```crew-event\n" +
  JSON.stringify({
    version: 1,
    payload: {
      type: "project.upserted",
      project: {
        id,
        name,
        summary: `${name} summary`,
        goals: ["ship something real"],
        steps: [{ id: "s1", title: "First step", status: "not_started" }],
      },
    },
  }) +
  "\n```";

describe("incremental project replay", () => {
  it("asks for everything once, then only for what is new", async () => {
    const calls: Call[] = [];
    const client = fakeClient({ 1: projectEvent("go", "Multiplayer Go"), 2: "just chatter" }, calls);
    const cache = new ProjectStateCache(client as never);

    const first = await cache.read("AgentParty", "token", () => true);
    expect(first.fullReplay).toBe(true);
    expect(calls[0].afterId).toBe(0);
    expect(cache.cursorFor("AgentParty")).toBe(2);

    const callsAfterFirst = calls.length;
    const second = await cache.read("AgentParty", "token", () => true);

    // THE ASSERTION. The second load resumes from the cached cursor and never
    // asks for message 0 again.
    expect(second.fullReplay).toBe(false);
    expect(calls.slice(callsAfterFirst).every((call) => call.afterId === 2)).toBe(true);
    expect(calls.slice(callsAfterFirst).some((call) => call.afterId === 0)).toBe(false);
  });

  it("folds a new event onto the cached state instead of rebuilding", async () => {
    const calls: Call[] = [];
    const store: Record<number, string> = { 1: projectEvent("go", "Multiplayer Go") };
    const cache = new ProjectStateCache(fakeClient(store, calls) as never);

    const first = await cache.read("AgentParty", "token", () => true);
    expect(first.rejected, JSON.stringify(first.rejected)).toEqual([]);
    expect(first.projects).toHaveLength(1);

    // A second project arrives after the first read.
    store[2] = projectEvent("med", "Meditation Experience");
    const second = await cache.read("AgentParty", "token", () => true);

    // Both present: the increment was folded onto the earlier result, not
    // instead of it. Reduction is a fold, so this must equal a full replay.
    expect(second.projects).toHaveLength(2);
    expect(second.fullReplay).toBe(false);
  });

  it("keeps rooms separate", async () => {
    const calls: Call[] = [];
    const cache = new ProjectStateCache(fakeClient({ 1: projectEvent("go", "Multiplayer Go") }, calls) as never);

    await cache.read("AgentParty", "token", () => true);
    expect(cache.cursorFor("OtherRoom")).toBeUndefined();

    // A different room must start from zero, not inherit AgentParty's cursor.
    const before = calls.length;
    await cache.read("OtherRoom", "token", () => true);
    expect(calls[before].afterId).toBe(0);
  });

  it("shares one refresh between concurrent callers rather than racing the cursor", async () => {
    const calls: Call[] = [];
    const cache = new ProjectStateCache(fakeClient({ 1: projectEvent("go", "Go") }, calls) as never);

    // Two loads at once. If each ran its own refresh they would both read from
    // cursor 0 and duplicate every upstream call.
    const [a, b] = await Promise.all([
      cache.read("AgentParty", "token", () => true),
      cache.read("AgentParty", "token", () => true),
    ]);

    expect(a).toBe(b);
    expect(calls.filter((call) => call.afterId === 0)).toHaveLength(1);
  });

  it("does not advance the cursor when the fetch fails", async () => {
    const calls: Call[] = [];
    let fail = false;
    const inner = fakeClient({ 1: projectEvent("go", "Go") }, calls);
    const client = {
      request: async <T,>(path: string): Promise<T> => {
        if (fail) throw new Error("upstream unavailable");
        return inner.request<T>(path);
      },
    };
    const cache = new ProjectStateCache(client as never);

    await cache.read("AgentParty", "token", () => true);
    const cursor = cache.cursorFor("AgentParty");

    fail = true;
    await expect(cache.read("AgentParty", "token", () => true)).rejects.toThrow();

    // The caller got an error; the cursor did not move on to messages that
    // were never folded. Advancing here would silently drop them forever.
    expect(cache.cursorFor("AgentParty")).toBe(cursor);
  });
});

describe("page size", () => {
  it("never exceeds the size the server actually honours", async () => {
    // WebHarness returns an EMPTY page above 200 rather than an error, and an
    // empty page is how the replay loop detects the end of history. A page size
    // over the cap would therefore stop on the first request and report an
    // empty board as a complete one. Measured against the live server:
    // limit=200 returns 200 messages, limit=500 returns 0.
    const cache = new ProjectStateCache({ request: async () => ({ messages: [] }) } as never);
    const calls: number[] = [];
    await new ProjectStateCache(
      {
        request: async <T,>(path: string): Promise<T> => {
          calls.push(Number(new URL(`http://x${path}`).searchParams.get("limit") ?? 0));
          return { messages: [] } as T;
        },
      } as never,
    ).read("AgentParty", "token", () => true);

    expect(calls[0]).toBeLessThanOrEqual(SERVER_MAX_PAGE);
    expect(cache).toBeDefined();
  });
});
