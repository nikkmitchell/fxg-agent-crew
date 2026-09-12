import { afterEach, describe, expect, it, vi } from "vitest";
import { space } from "./space-client";
import { ApiError } from "./api-request";

afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("reading what was said", () => {
  it("hands the transcript on in the order the server sent it", async () => {
    /**
     * THE BUG THIS EXISTS FOR. The server queries `ORDER BY id DESC` and then
     * reverses, so a transcript arrives oldest-first and reads downward like a
     * conversation. `SaidPanel` reversed it a second time and displayed the
     * room backwards on production for an hour. The server's own ordering was
     * tested; nothing tested what the client did with it.
     */
    const server = [
      { id: 1, say: "first" },
      { id: 2, say: "second" },
      { id: 3, say: "third" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ utterances: server })));
    const body = await space.said(40);
    expect(body.utterances.map((u) => u.say)).toEqual(["first", "second", "third"]);
  });

  it("asks for the limit it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ utterances: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await space.said(7);
    expect(fetchMock.mock.calls[0][0]).toContain("limit=7");
  });
});

describe("refusals from the room", () => {
  it("raises the server's sentence rather than a status code", async () => {
    // The refusal is written for a person and says what to do next. A generic
    // "request failed" throws away the only useful part.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ code: "REFUSED", error: "that is too low to read without crouching" }, 422),
      ),
    );
    await expect(
      space.placePanel({ id: "taskBoard", position: { x: 0, y: 0.1, z: 0 }, rotationY: 0 }),
    ).rejects.toThrow("too low to read");
  });

  it("carries the code so callers can branch without matching prose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "SESSION_EXPIRED", error: "not signed in" }, 401)),
    );
    await expect(space.panels()).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
  });

  it("still refuses usefully when the server sends no body at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(space.panels()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("writing to the room", () => {
  it("sends an utterance as JSON and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await space.say({ say: "hello", source: "voice", confidence: 0.8 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/bff/space/utterances");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ say: "hello", source: "voice", confidence: 0.8 });
  });

  it("sends only the position and rotation when placing a panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ placement: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await space.placePanel({ id: "chat", position: { x: 1, y: 2, z: 3 }, rotationY: 0.4 });
    // The id belongs in the path; sending it in the body as well would be a
    // second place for the two to disagree.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotationY: 0.4,
    });
    expect(fetchMock.mock.calls[0][0]).toContain("/panels/chat/place");
  });
});
