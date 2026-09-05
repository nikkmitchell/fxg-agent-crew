import { afterEach, describe, expect, it, vi } from "vitest";
import { WebharnessClient } from "../webharness/client.js";
import { pollMessages } from "../webharness/longpoll.js";

const message = (id: number) => ({
  id,
  username: "wilson",
  content: `m${id}`,
  msgType: "text",
  createdAt: "",
  updatedAt: "",
  streaming: false,
});

/**
 * A Response body can only be read once, so mocks must mint a fresh one per
 * call rather than resolving the same object twice.
 */
const jsonOnce = (body: unknown) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("pollMessages", () => {
  it("returns the highest id seen as the next cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [message(7), message(9), message(8)] })),
    );

    const page = await pollMessages(new WebharnessClient("https://x.test"), {
      room: "r",
      token: "t",
      afterId: 5,
    });

    // Highest actually seen, not last-in-array and not a prediction.
    expect(page.cursor).toBe(9);
  });

  it("holds the caller's cursor when nothing arrived", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] })));

    const page = await pollMessages(new WebharnessClient("https://x.test"), {
      room: "r",
      token: "t",
      afterId: 42,
    });

    // Advancing past an empty page would skip anything that landed in the gap.
    expect(page.cursor).toBe(42);
    expect(page.messages).toEqual([]);
  });

  it("only asks the server to wait when it has a cursor to wait from", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WebharnessClient("https://x.test");

    await pollMessages(client, { room: "r", token: "t" });
    expect(fetchMock.mock.calls[0][0]).not.toContain("wait=");

    await pollMessages(client, { room: "r", token: "t", afterId: 1 });
    expect(fetchMock.mock.calls[1][0]).toContain("wait=");
  });

  /**
   * Chat is a RECENT WINDOW by design, not an exhaustive traversal — the
   * opposite of the project replay, and deliberately so: only the browser knows
   * whether it still holds the transcript before a cursor, so the server must
   * not decide on its behalf.
   *
   * That contract existed only as a comment. Asked in review to point at its
   * test, there wasn't one — so the claim that "every room-history reader is
   * page-safe" rested on an untested assertion for this reader. A bound nobody
   * checks is a bound that can be removed by accident.
   */
  it("asks for a bounded recent window when it has no cursor, rather than everything", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WebharnessClient("https://x.test");

    await pollMessages(client, { room: "r", token: "t" });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("limit=50");
    // No cursor AND no limit would ask the server for the whole room, which is
    // the failure this window exists to prevent.
    expect(url).not.toContain("afterId=");
  });

  it("does not impose a window when resuming from a cursor", async () => {
    // Incremental reads are bounded by the cursor itself; adding a limit here
    // would silently drop anything beyond it and the caller could not tell.
    const fetchMock = vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WebharnessClient("https://x.test");

    await pollMessages(client, { room: "r", token: "t", afterId: 100 });

    expect(String(fetchMock.mock.calls[0][0])).not.toContain("limit=");
  });

  it("caps wait at the server's 30s maximum", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await pollMessages(new WebharnessClient("https://x.test"), {
      room: "r",
      token: "t",
      afterId: 1,
      waitSeconds: 300,
    });

    expect(fetchMock.mock.calls[0][0]).toContain("wait=30");
  });

  it("passes the abort signal upstream so a disconnect cancels the poll", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await pollMessages(new WebharnessClient("https://x.test"), {
      room: "r",
      token: "t",
      afterId: 1,
      signal: controller.signal,
    });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("escapes room names so they cannot break out of the path", async () => {
    const fetchMock = vi.fn().mockImplementation(jsonOnce({ roomName: "r", messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await pollMessages(new WebharnessClient("https://x.test"), {
      room: "../admin",
      token: "t",
    });

    expect(fetchMock.mock.calls[0][0]).not.toContain("../");
  });
});
