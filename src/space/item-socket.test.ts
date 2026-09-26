import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../api-request";
import { actOnItem, registerItemSocket, settleItemAction } from "./item-socket";

/** Nikk (5026): moves stalled on a bad connection while the room socket kept flowing. */
describe("a Go move over the room socket", () => {
  afterEach(() => registerItemSocket(null));

  it("uses the web request when there is no socket", async () => {
    expect(await actOnItem("t", { action: "pass" }, async () => "web")).toBe("web");
  });

  it("goes over the socket when it is open, and takes its answer", async () => {
    const sent: { ref: string; id: string; body: Record<string, unknown> }[] = [];
    registerItemSocket((message) => {
      sent.push(message);
      queueMicrotask(() => settleItemAction(message.ref, { status: 200, payload: { item: { id: "t", revision: 5 } } }));
      return true;
    });
    const answer = await actOnItem("t", { action: "place", x: 1, y: 2, revision: 4 }, async () => "web");
    expect(answer).toEqual({ item: { id: "t", revision: 5 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: "t", body: { action: "place", x: 1, y: 2, revision: 4 } });
  });

  it("hands a refusal back exactly as the web request would", async () => {
    registerItemSocket((message) => {
      queueMicrotask(() => settleItemAction(message.ref, { status: 409, payload: { code: "TABLE_CHANGED", error: "The table changed. Try again." } }));
      return true;
    });
    const refusal = await actOnItem("t", { action: "pass" }, async () => "web").catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ status: 409, code: "TABLE_CHANGED" });
  });

  it("falls back to the web when the socket does not answer in time", async () => {
    registerItemSocket(() => true);
    expect(await actOnItem("t", { action: "pass" }, async () => "web", 20)).toBe("web");
  });

  it("falls back at once when the socket closes while waiting", async () => {
    registerItemSocket(() => true);
    const pending = actOnItem("t", { action: "pass" }, async () => "web", 60_000);
    registerItemSocket(null);
    expect(await pending).toBe("web");
  });
});
