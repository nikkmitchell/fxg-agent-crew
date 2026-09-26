import { afterEach, describe, expect, it } from "vitest";
import { callDeadline, callOverSocket, registerCallSocket, resetCallSocket, settleCall } from "./call-socket";
import { isCallPath } from "../shared/space-wire";

/** Nikk (5047): "add as many things as you can to socket". */
describe("site requests down the room socket", () => {
  afterEach(() => resetCallSocket());

  it("goes by web when there is no socket", async () => {
    expect(await callOverSocket("/bff/me", {})).toBeNull();
  });

  it("sends a small JSON request down the socket and hands back its answer", async () => {
    const frames: unknown[] = [];
    registerCallSocket((frame) => {
      frames.push(frame);
      queueMicrotask(() => settleCall(frame.ref, 201, '{"ok":true}'));
      return true;
    });
    const answer = await callOverSocket("/bff/rooms/saha.ing/messages", { method: "POST", body: '{"content":"hi"}' });
    expect(answer).toEqual({ status: 201, body: '{"ok":true}' });
    expect(frames).toEqual([expect.objectContaining({ type: "call", method: "POST", path: "/bff/rooms/saha.ing/messages", body: '{"content":"hi"}' })]);
  });

  it("leaves files, other sites and the socket itself to the web", async () => {
    registerCallSocket(() => true);
    expect(await callOverSocket("/bff/space/screens/frame", { method: "PUT", body: new Blob(["x"]) })).toBeNull();
    expect(await callOverSocket("https://elsewhere.test/bff/me", {})).toBeNull();
    expect(await callOverSocket("/bff/space/socket", {})).toBeNull();
    expect(await callOverSocket("/api/other", {})).toBeNull();
  });

  it("goes by web when the socket closes before answering", async () => {
    registerCallSocket(() => true);
    const pending = callOverSocket("/bff/me", {});
    registerCallSocket(null);
    expect(await pending).toBeNull();
  });

  it("stops tunnelling for good once the server refuses this page", async () => {
    let sent = 0;
    registerCallSocket((frame) => {
      sent += 1;
      queueMicrotask(() => settleCall(frame.ref, 403, '{"code":"CROSS_SITE"}'));
      return true;
    });
    expect(await callOverSocket("/bff/me", {})).toBeNull();
    expect(await callOverSocket("/bff/me", {})).toBeNull();
    expect(sent).toBe(1);
  });

  it("gives a long poll its whole wait before giving up", () => {
    expect(callDeadline("/bff/rooms/saha.ing/messages?afterId=3&wait=25")).toBe(45_000);
    expect(callDeadline("/bff/me")).toBe(20_000);
  });

  it("only ever names a route on this site", () => {
    for (const bad of ["/bff/../etc", "/bff//x", "/bff/%2e%2e/x", "/bff/a b", "/bff\\x", "/bff/space/socket?x=1", "http://x/bff/me", "/bff/login", "/bff/logout", "/bff/agent-session"]) {
      expect(isCallPath(bad)).toBe(false);
    }
    expect(isCallPath("/bff/space/items/abc/action")).toBe(true);
  });
});

describe("the key a send carries", () => {
  it("is the same for the same words and different for different ones, and rides the socket", async () => {
    const { sendKey } = await import("./call-socket");
    expect(sendKey("chat", "saha.ing", "hello")).toBe(sendKey("chat", "saha.ing", "hello"));
    expect(sendKey("chat", "saha.ing", "hello")).not.toBe(sendKey("chat", "saha.ing", "hello!"));
    const frames: { key?: string }[] = [];
    registerCallSocket((frame) => {
      frames.push(frame);
      queueMicrotask(() => settleCall(frame.ref, 201, "{}"));
      return true;
    });
    await callOverSocket("/bff/rooms/x/messages", { method: "POST", body: "{}", headers: { "idempotency-key": "k" } });
    expect(frames[0]?.key).toBe("k");
  });
});
