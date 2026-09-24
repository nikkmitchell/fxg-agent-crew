import { afterEach, describe, expect, it, vi } from "vitest";
import { bff } from "./bff-client";
import { ApiError } from "./api-request";

afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("bff client", () => {
  it("uses same-origin credentials without exposing an authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ username: "nikk" }));
    vi.stubGlobal("fetch", fetchMock);
    await bff.me();
    expect(fetchMock).toHaveBeenCalledWith("/bff/me", expect.objectContaining({ credentials: "same-origin" }));
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("authorization");
  });

  it("posts login credentials only in the JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ username: "nikk" }));
    vi.stubGlobal("fetch", fetchMock);
    await bff.login({ username: "nikk", password: "secret" });
    expect(fetchMock).toHaveBeenCalledWith("/bff/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "nikk", password: "secret" }),
    }));
    expect(fetchMock.mock.calls[0][0]).not.toContain("secret");
  });

  it("preserves stable error codes and retry semantics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: "UPSTREAM_UNAVAILABLE", error: "try again" }, 502)));
    const error = await bff.rooms().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 502, retryable: true, reauth: false });
  });

  it("encodes room names and exact long-poll options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ roomName: "A/B room", messages: [], cursor: 12 }));
    vi.stubGlobal("fetch", fetchMock);
    await bff.messages("A/B room", { afterId: 12, wait: 25 });
    expect(fetchMock.mock.calls[0][0]).toBe("/bff/rooms/A%2FB%20room/messages?afterId=12&wait=25");
  });

  it("forwards abort signals to held requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ roomName: "AgentParty", messages: [], cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await bff.messages("AgentParty", { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("sends messages through the same-origin BFF", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7, username: "nikk", content: "hello" }));
    vi.stubGlobal("fetch", fetchMock);
    await bff.sendMessage("A/B", "hello");
    expect(fetchMock).toHaveBeenCalledWith("/bff/rooms/A%2FB/messages", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ content: "hello" }),
    }));
  });

  it("keeps discovery, existing-room join, explicit create, and space entry separate", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ roomName: "garden", joined: true }))
      .mockResolvedValueOnce(jsonResponse({ roomName: "haven", created: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ roomName: "haven" }))
      .mockResolvedValueOnce(jsonResponse({ roomName: "haven" }));
    vi.stubGlobal("fetch", fetchMock);

    await bff.publicRooms();
    await bff.joinRoom("garden", "shared-pass");
    await bff.createRoom("haven", "private");
    await bff.enterSpaceRoom("haven");
    await bff.currentSpaceRoom();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/bff/rooms/public",
      "/bff/rooms/garden/join",
      "/bff/rooms/create",
      "/bff/space/enter",
      "/bff/space/room",
    ]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST", credentials: "same-origin", body: JSON.stringify({ password: "shared-pass" }),
    });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST", body: JSON.stringify({ roomName: "haven", visibility: "private" }),
    });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: "POST", body: JSON.stringify({ roomName: "haven" }),
    });
  });

  it("sends a password to lock a new room only when one was given", async () => {
    // "Private" on webharness.chat is unlisted, not locked: a password is the lock.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ roomName: "haven", created: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ roomName: "open", created: true }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await bff.createRoom("haven", "private", "our-secret");
    await bff.createRoom("open", "private");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ roomName: "haven", visibility: "private", password: "our-secret" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ roomName: "open", visibility: "private" });
  });
});
