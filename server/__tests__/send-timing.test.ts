import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerSendTimingRoutes } from "../space/send-timing.js";
import { MemorySessionStore } from "../session.js";
import type { Config } from "../config.js";

/** Where a headset's voice send spends its time: logged, never stored. */
const config: Config = { webharnessUrl: "https://example.test", port: 0, cookieName: "fxg_sid", sessionTtlMs: 60_000, secureCookies: false };

function setup() {
  const sessions = new MemorySessionStore(60_000);
  const sid = sessions.create("Nikk2", "upstream-secret");
  const lines: unknown[] = [];
  const app = Fastify({ logger: { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line)) } } });
  app.register(cookie);
  registerSendTimingRoutes(app, { config, sessions });
  return { app, sid, lines };
}

describe("POST /bff/space/send-timing", () => {
  it("writes how long each part waited to the log, for the person who sent it", async () => {
    const { app, sid, lines } = setup();
    const response = await app.inject({
      method: "POST", url: "/bff/space/send-timing", cookies: { fxg_sid: sid },
      payload: { inXr: true, visible: "visible", parts: [
        { to: "room", startedAt: 1_000, answeredAt: 1_300, outcome: "sent" },
        { to: "group-chat", startedAt: 1_300, answeredAt: null, outcome: "timed out" },
      ] },
    });
    expect(response.statusCode).toBe(204);
    const logged = lines.find((line) => (line as { msg?: string }).msg === "send timing") as { sendTiming: { who: string; inXr: boolean; parts: { waitedS: number | null }[] } };
    expect(logged.sendTiming.who).toBe("Nikk2");
    expect(logged.sendTiming.inXr).toBe(true);
    expect(logged.sendTiming.parts.map((p) => p.waitedS)).toEqual([0.3, null]);
  });

  it("refuses anything that is not a timing report, and anyone not signed in", async () => {
    const { app, sid } = setup();
    expect((await app.inject({ method: "POST", url: "/bff/space/send-timing", cookies: { fxg_sid: sid }, payload: { parts: "no" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/bff/space/send-timing", payload: { parts: [] } })).statusCode).toBe(401);
  });
});
