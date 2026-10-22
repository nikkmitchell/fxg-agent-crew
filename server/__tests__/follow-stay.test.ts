import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { AFTER_SPEAKING_MS } from "../space/walk-back.js";
import { tempDir } from "./test-config.js";

/**
 * "COME OVER AND STAY" SURVIVES SPEAKING (Nikk, in VR, 2026-10-22: "can you walk
 * over to where we are?"). An agent that follows somebody and then speaks to them
 * is walked back once the line is said (walk-back.ts, Nikk 7378). That undid the
 * request that brought it over, so a follow can say stay: true.
 */
describe("a follow that asks to stay", () => {
  afterEach(() => { vi.useRealTimers(); });

  const run = async (stay: boolean | undefined) => {
    // Time still runs for the server; the test only jumps the walk-back wait.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const built = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("blobs-"),
      LOG_LEVEL: "silent",
    });
    const cookie = `${built.config.cookieName}=${built.sessions.create("Sill", "t", "agent")}`;
    built.space.presence.join("Nikk2", "human");
    built.space.presence.join("Sill", "agent", true);
    const followed = await built.app.inject({
      method: "POST", url: "/bff/space/follow", headers: { cookie },
      payload: { actor: "Nikk2", ...(stay === undefined ? {} : { stay }) },
    });
    expect(followed.statusCode).toBe(200);
    const said = await built.app.inject({
      method: "POST", url: "/bff/space/utterances", headers: { cookie },
      payload: { say: "Sill here, the board is up to date.", source: "text", to: "Nikk2" },
    });
    expect(said.statusCode).toBeLessThan(300);
    await vi.advanceTimersByTimeAsync(60_000 + AFTER_SPEAKING_MS);
    const following = built.space.presence.find("Sill")?.following?.actorId ?? null;
    await built.app.close();
    return following;
  };

  it("without it, speaking walks the agent back, as before", async () => {
    expect(await run(undefined)).toBeNull();
  });

  it("with it, the agent is still beside them after the line is said", async () => {
    expect(await run(true)).toBe("Nikk2");
  });

  it("only a real true counts", async () => {
    expect(await run("yes" as unknown as boolean)).toBeNull();
  });
});
