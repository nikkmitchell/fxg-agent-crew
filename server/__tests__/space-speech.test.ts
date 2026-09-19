import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { cacheName, registerSpeechRoutes, speechCache, timeoutFor, type Speaker } from "../space/speak.js";
import type { Utterance } from "../../shared/voice.js";

/**
 * Reading a line back aloud.
 *
 * Nikk: "each agent responds quickly and simply with a short summary sentence
 * in audio, and then all the details in chat". The engine itself lives on the
 * box behind SPEAK_CMD, so these drive the route with a stub speaker: what
 * matters here is WHOSE voice is used, what is never read aloud, and what the
 * room says when it cannot speak at all.
 */
const said = (change: Partial<Utterance> = {}): Utterance => ({
  id: 7,
  at: "2026-09-19T02:00:00Z",
  actorId: "Sill",
  to: null,
  say: "Deployed and verified, nothing else is live.",
  detail: "The long half, which is never spoken.",
  source: "text",
  confidence: null,
  ...change,
});

const boot = async (options: {
  speak?: Speaker;
  utterance?: Utterance | null;
  voiceOf?: (actorId: string) => string;
} = {}) => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const cacheRoot = await mkdtemp(join(tmpdir(), "speech-"));
  const speech = speechCache({ cacheRoot, speaker: () => options.speak });
  registerSpeechRoutes(app, {
    config: built.config,
    sessions: built.sessions,
    speech,
    utterance: (id) => (options.utterance === undefined ? (id === 7 ? said() : null) : options.utterance),
    voiceOf: options.voiceOf ?? (() => "am_michael"),
  });
  const cookieFor = (username: string) => `${built.config.cookieName}=${built.sessions.create(username, "t", "agent")}`;
  const ask = (id: number | string, username = "Nikk2") =>
    app.inject({ method: "GET", url: `/bff/space/utterances/${id}/audio`, headers: { cookie: cookieFor(username) } });
  return { app, ask, cacheRoot, close: () => Promise.all([app.close(), built.app.close()]) };
};

/** A stub engine: writes a WAV-ish file and remembers what it was asked for. */
const stubSpeaker = () => {
  const calls: { text: string; voice: string }[] = [];
  const speak: Speaker = async (text, voice, outPath) => {
    calls.push({ text, voice });
    await writeFile(outPath, Buffer.from(`RIFF....WAVE ${voice}`));
  };
  return { calls, speak };
};

describe("reading a line aloud", () => {
  it("says it in the SPEAKER's voice, not the listener's", async () => {
    const engine = stubSpeaker();
    const { ask, close } = await boot({
      speak: engine.speak,
      voiceOf: (actorId) => (actorId === "Sill" ? "bm_george" : "af_heart"),
    });
    const response = await ask(7, "Nikk2");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/wav");
    expect(engine.calls).toEqual([{ text: said().say, voice: "bm_george" }]);
    await close();
  });

  it("never reads the detail, only the spoken half", async () => {
    const engine = stubSpeaker();
    const { ask, close } = await boot({ speak: engine.speak });
    await ask(7);
    expect(engine.calls[0]?.text).not.toContain("never spoken");
    await close();
  });

  it("refuses an utterance that was written and not said", async () => {
    const engine = stubSpeaker();
    const { ask, close } = await boot({ speak: engine.speak, utterance: said({ say: null }) });
    const response = await ask(7);
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NOTHING_SAID_ALOUD");
    expect(engine.calls, "nothing is synthesised for a note").toEqual([]);
    await close();
  });

  it("says a line once, then serves it from disk", async () => {
    // Every one of these costs a core-second on a two-core box.
    const engine = stubSpeaker();
    const { ask, close } = await boot({ speak: engine.speak });
    expect((await ask(7)).statusCode).toBe(200);
    expect((await ask(7)).statusCode).toBe(200);
    expect(engine.calls.length).toBe(1);
    await close();
  });

  it("says so plainly when this box has no engine", async () => {
    const { ask, close } = await boot({ speak: undefined });
    const response = await ask(7);
    expect(response.statusCode).toBe(501);
    expect(response.json().code).toBe("NOT_SPOKEN_HERE");
    expect(response.json().error).toContain("text-first");
    await close();
  });

  it("keeps the words when the engine fails", async () => {
    const angry: Speaker = async () => {
      throw new Error("engine exited 1");
    };
    const { ask, close } = await boot({ speak: angry });
    const response = await ask(7);
    expect(response.statusCode).toBe(503);
    expect(response.json().error, "the line is still in the room in writing").toContain("in writing");
    await close();
  });

  /**
   * SAID IS WHEN IT IS MADE, not asked. Measured on the box: 6.4s to come back
   * fresh, 1.1s from disk. Nikk asked for agents that "respond quickly", so the
   * waiting happens where nobody is listening yet.
   */
  it("warms a line when it is said, so the listener waits for a download", async () => {
    const engine = stubSpeaker();
    const cacheRoot = await mkdtemp(join(tmpdir(), "speech-warm-"));
    const speech = speechCache({ cacheRoot, speaker: () => engine.speak });

    speech.warm(said().say!, "af_heart");
    await new Promise((settle) => setTimeout(settle, 20));
    expect(engine.calls).toEqual([{ text: said().say, voice: "af_heart" }]);
    // And it is on disk under the name the route will look for.
    expect(await readFile(join(cacheRoot, cacheName(said().say!, "af_heart")), "utf8")).toContain("WAVE");
  });

  it("warming never throws, whatever the engine does", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "speech-warm-"));
    const speech = speechCache({
      cacheRoot,
      speaker: () => async () => {
        throw new Error("engine exited 1");
      },
    });
    expect(() => speech.warm("anything", "af_heart")).not.toThrow();
    await new Promise((settle) => setTimeout(settle, 20));
  });

  it("refuses an id that is not one, and one nobody said", async () => {
    const { ask, close } = await boot({ speak: stubSpeaker().speak });
    expect((await ask("sevenish")).statusCode).toBe(400);
    expect((await ask(999)).statusCode).toBe(404);
    await close();
  });

  it("answers 401 to somebody not signed in", async () => {
    const engine = stubSpeaker();
    const { app, close } = await boot({ speak: engine.speak });
    const response = await app.inject({ method: "GET", url: "/bff/space/utterances/7/audio" });
    expect(response.statusCode).toBe(401);
    await close();
  });
});

describe("what the cache and the clock promise", () => {
  it("gives the same line in the same voice the same file, and different voices different ones", () => {
    expect(cacheName("hello", "af_heart")).toBe(cacheName("hello", "af_heart"));
    expect(cacheName("hello", "af_heart")).not.toBe(cacheName("hello", "am_michael"));
    expect(cacheName("hello", "af_heart")).not.toBe(cacheName("hello there", "af_heart"));
  });

  it("waits longer for a longer line, within bounds", () => {
    // Measured on the box: about 4.6s for a 44-character sentence.
    expect(timeoutFor(44)).toBeGreaterThanOrEqual(20_000);
    expect(timeoutFor(240)).toBeGreaterThan(timeoutFor(44));
    expect(timeoutFor(100_000)).toBeLessThanOrEqual(120_000);
  });
});
