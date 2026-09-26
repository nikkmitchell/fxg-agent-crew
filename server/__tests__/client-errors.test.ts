import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerClientErrorRoutes } from "../space/client-errors.js";
import { MemorySessionStore } from "../session.js";
import { testConfig } from "./test-config.js";

/** What broke on somebody's screen reaches the server log, and nothing else. */
function setup() {
  const sessions = new MemorySessionStore(60_000);
  const sid = sessions.create("Nikk2", "upstream-secret");
  const lines: { msg?: string; clientError?: Record<string, unknown> }[] = [];
  const app = Fastify({ logger: { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line)) } } });
  app.register(cookie);
  let clock = 0;
  registerClientErrorRoutes(app, { config: testConfig(), sessions, now: () => clock });
  const report = (body: unknown, withCookie = true) =>
    app.inject({ method: "POST", url: "/bff/client-error", ...(withCookie ? { cookies: { fxg_sid: sid } } : {}), payload: body as object });
  return { report, lines, tick: (ms: number) => { clock += ms; } };
}

describe("POST /bff/client-error", () => {
  it("logs the error, who saw it and whether they were in a headset", async () => {
    const { report, lines } = setup();
    const answer = await report({ message: "TypeError: x is undefined", stack: "at Scene", where: "scene", page: "/room", inXr: true });
    expect(answer.statusCode).toBe(204);
    const logged = lines.find((line) => line.msg === "client error")!.clientError!;
    expect(logged).toMatchObject({ who: "Nikk2", message: "TypeError: x is undefined", where: "scene", inXr: true });
  });

  it("keeps a page stuck in a loop from filling the log: twenty a minute, then quiet", async () => {
    const { report, lines, tick } = setup();
    for (let n = 0; n < 30; n += 1) expect((await report({ message: `boom ${n}` })).statusCode).toBe(204);
    expect(lines.filter((line) => line.msg === "client error")).toHaveLength(20);
    tick(61_000);
    await report({ message: "later" });
    expect(lines.filter((line) => line.msg === "client error")).toHaveLength(21);
  });

  it("refuses an empty report and anyone not signed in", async () => {
    const { report } = setup();
    expect((await report({ stack: "no message" })).statusCode).toBe(400);
    expect((await report({ message: "x" }, false)).statusCode).toBe(401);
  });

  it("cuts a huge stack down rather than logging it whole", async () => {
    const { report, lines } = setup();
    await report({ message: "x", stack: "y".repeat(5000) });
    expect((lines.find((line) => line.msg === "client error")!.clientError!.stack as string).length).toBe(3000);
  });
});
