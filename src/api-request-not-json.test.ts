import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "./api-request";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: string, type = "application/json") =>
  new Response(body, { status, headers: { "content-type": type } });

describe("requestJson with an answer that is not JSON (Lumenfold, 5702)", () => {
  it("refuses a 200 HTML page instead of handing back something to crash on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => answer(200, "<!doctype html><html></html>", "text/html")));
    await expect(requestJson("/bff/space/pieces")).rejects.toMatchObject({ code: "NOT_JSON" });
    await expect(requestJson("/bff/space/pieces")).rejects.toBeInstanceOf(ApiError);
  });
  it("still reads JSON, refuses an empty 200, and lets a 204 be empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, '{"pieces":{"hidden":[],"revision":0}}')));
    await expect(requestJson("/bff/space/pieces")).resolves.toEqual({ pieces: { hidden: [], revision: 0 } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => answer(200, "")));
    await expect(requestJson("/x")).rejects.toMatchObject({ code: "EMPTY_ANSWER" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status: 204 })));
    await expect(requestJson("/x")).resolves.toBeUndefined();
  });
  it("keeps a refusal's own message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(422, '{"code":"REFUSED","error":"no"}')));
    await expect(requestJson("/x")).rejects.toMatchObject({ code: "REFUSED", message: "no" });
  });
});
