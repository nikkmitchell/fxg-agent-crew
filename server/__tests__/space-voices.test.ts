import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { VOICES, chooseVoice, voiceFor } from "../../shared/voice-choice.js";

/**
 * Choosing a voice.
 *
 * The same shape as choosing a body, so the things worth asserting are the same
 * ones: that a name nobody offers is REFUSED rather than quietly replaced, that
 * an agent cannot speak as somebody else, and that the room says plainly whether
 * a voice would actually be heard instead of implying it.
 */

const boot = (env: Record<string, string> = {}) => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: testBlobRoot(),
    LOG_LEVEL: "silent",
    ...env,
  });
  const as = (username: string, kind: "human" | "agent" = "agent") =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", kind)}`;
  return { ...built, as };
};

describe("choosing a voice", () => {
  it("requires a session on every route", async () => {
    const { app } = boot();
    for (const [method, url] of [
      ["GET", "/bff/space/voices"],
      ["PUT", "/bff/space/voice"],
      ["DELETE", "/bff/space/voice"],
    ] as const) {
      const response = await app.inject({ method, url, payload: { voice: "am_michael" } });
      expect(response.statusCode).toBe(401);
    }
    await app.close();
  });

  it("lists what can be spoken in, and which one is yours", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "GET", url: "/bff/space/voices", headers: { cookie: as("Nightjar") },
    });
    const body = response.json();
    expect(body.voices).toHaveLength(VOICES.length);
    expect(body.chosen).toBe(false);
    expect(body.yours).toBe(voiceFor("Nightjar").id);
    await app.close();
  });

  it("keeps a voice an agent chooses", async () => {
    const { app, as, voices } = boot();
    const set = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "bm_george" },
    });
    expect(set.json()).toMatchObject({ ok: true, actorId: "Nightjar", voice: "bm_george" });

    const read = await app.inject({
      method: "GET", url: "/bff/space/voices", headers: { cookie: as("Nightjar") },
    });
    expect(read.json()).toMatchObject({ yours: "bm_george", chosen: true });
    expect(voices.voiceOf("Nightjar").id).toBe("bm_george");
    await app.close();
  });

  /**
   * TWO AGENTS, ONE VOICE — which happened, and was caught by a person's ears
   * rather than by anything here. Nikk: "the voice you chose sounds too close
   * to the one that Nightjar chose". They were not close, they were the same
   * id, and nothing in the room could show it or stop it.
   */
  it("shows who has chosen what, so a clash can be seen before it is heard", async () => {
    const { app, as } = boot();
    await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "bm_george" },
    });
    const read = await app.inject({
      method: "GET", url: "/bff/space/voices", headers: { cookie: as("Lumenfold") },
    });
    expect(read.json().taken).toEqual([{ actorId: "Nightjar", voice: "bm_george" }]);
    await app.close();
  });

  it("refuses a voice another agent has already chosen, and names them", async () => {
    const { app, as, voices } = boot();
    await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "bm_george" },
    });
    const clash = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Lumenfold") },
      payload: { voice: "bm_george" },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ code: "VOICE_TAKEN", takenBy: "Nightjar" });
    // AND IT DID NOT HALF-APPLY: the refusal left no row behind.
    expect(voices.chosen("Lumenfold")).toBeNull();
    await app.close();
  });

  it("lets an agent re-choose the voice it already has", async () => {
    const { app, as } = boot();
    const headers = { cookie: as("Nightjar") };
    await app.inject({ method: "PUT", url: "/bff/space/voice", headers, payload: { voice: "bm_george" } });
    const again = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers, payload: { voice: "bm_george" },
    });
    expect(again.statusCode).toBe(200);
    await app.close();
  });

  /**
   * A DERIVED VOICE IS NOT A CLAIM ON IT. With twelve voices two names collide
   * 62% of the time at five agents, so refusing on the hash would leave people
   * unable to pick a voice nobody has actually asked for.
   */
  it("does not refuse a voice that is only somebody's name-derived default", async () => {
    const { app, as } = boot();
    const derived = voiceFor("Lumenfold").id;
    const set = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: derived },
    });
    expect(set.statusCode).toBe(200);
    await app.close();
  });

  it("ignores case, because the room folds names everywhere else", async () => {
    const { app, as } = boot();
    const set = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "  AM_MICHAEL  " },
    });
    expect(set.json().voice).toBe("am_michael");
    await app.close();
  });

  /**
   * A VOICE NOBODY OFFERS IS REFUSED, NOT SUBSTITUTED. Being given a different
   * voice than the one asked for is undetectable from the agent's side, and is
   * the same failure as a gesture accepted and never played.
   */
  it("refuses a voice it does not have, and names the ones it does", async () => {
    const { app, as, voices } = boot();
    const response = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "morgan_freeman" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NO_SUCH_VOICE");
    expect(response.json().error).toContain("am_michael");
    expect(voices.chosen("Nightjar")).toBeNull();
    await app.close();
  });

  it("says what to send when no voice is named", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") }, payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NO_VOICE_GIVEN");
    await app.close();
  });

  it("gives a voice back when a choice is cleared, rather than none", async () => {
    const { app, as } = boot();
    await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "bf_emma" },
    });
    const cleared = await app.inject({
      method: "DELETE", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
    });
    expect(cleared.json()).toEqual({ ok: true, voice: voiceFor("Nightjar").id, chosen: false });
    await app.close();
  });

  /**
   * NO ACTOR ID IN THE BODY. Sharper here than for a body: a room where one
   * agent can make another SOUND like itself has given up what the audit trail
   * is for.
   */
  it("cannot set another agent's voice", async () => {
    const { app, as, voices } = boot();
    await app.inject({
      method: "PUT", url: "/bff/space/voice", headers: { cookie: as("Nightjar") },
      payload: { voice: "am_adam", actor: "Sill", actorId: "Sill", as: "Sill" },
    });
    expect(voices.chosen("Sill")).toBeNull();
    expect(voices.chosen("Nightjar")).toBe("am_adam");
    await app.close();
  });

  describe("whether it would actually be heard", () => {
    it("says so plainly when no engine is installed", async () => {
      const previous = process.env.SPEAK_CMD;
      delete process.env.SPEAK_CMD;
      const { app, as } = boot();
      const response = await app.inject({
        method: "GET", url: "/bff/space/voices", headers: { cookie: as("Nightjar") },
      });
      expect(response.json().spokenAloud).toBe(false);
      /**
       * `heardByAnybody` IS ABOUT THE DESCRIPTIONS, NOT ABOUT THIS BOX. It
       * asserted that the blurbs came from the model's own naming and not from
       * an ear. That stopped being true on 2026-09-19: Nikk listened in a
       * headset and described bm_george as "low and smooth", which is an ear
       * and not a README. A box with no engine still cannot speak — that is
       * `spokenAloud`, asserted above — but the catalogue has been heard.
       */
      expect(response.json().heardByAnybody).toBe(true);
      await app.close();
      if (previous !== undefined) process.env.SPEAK_CMD = previous;
    });

    it("says so when one is", async () => {
      const previous = process.env.SPEAK_CMD;
      process.env.SPEAK_CMD = "/opt/kokoro/say --voice {voice} --out {file}";
      const { app, as } = boot();
      const response = await app.inject({
        method: "GET", url: "/bff/space/voices", headers: { cookie: as("Nightjar") },
      });
      expect(response.json().spokenAloud).toBe(true);
      await app.close();
      if (previous === undefined) delete process.env.SPEAK_CMD;
      else process.env.SPEAK_CMD = previous;
    });
  });
});

describe("the voice list itself", () => {
  it("offers only voices with ids the engine would accept", () => {
    /**
     * EVERY KOKORO LANGUAGE PREFIX, not just the English two. This asserted
     * `[ab]` — American or British — which was true while the catalogue was a
     * twelve-voice English subset and became a false constraint the moment it
     * offered everything the box has. The first letter is the language and the
     * second is the register, so the check is still real: an id that is not
     * shaped like one of the engine's own would be refused by the engine.
     */
    for (const voice of VOICES) {
      expect(voice.id).toMatch(/^[abefhijpz][fm]_[a-z]+$/);
      expect(voice.blurb.length).toBeGreaterThan(5);
      expect(voice.language).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(VOICES.map((voice) => voice.id)).size).toBe(VOICES.length);
  });

  it("gives different agents different default voices", () => {
    const crew = ["Nightjar", "Sill", "Plumbline", "Inkstone", "Lumenfold", "Waffle", "Corvid"];
    expect(new Set(crew.map((who) => voiceFor(who).id)).size).toBeGreaterThan(1);
  });

  it("gives the same agent the same default every time", () => {
    expect(voiceFor("Nightjar").id).toBe(voiceFor("Nightjar").id);
    expect(voiceFor("nightjar").id).toBe(voiceFor("Nightjar").id);
  });

  it("resolves a real voice and refuses anything else", () => {
    expect(chooseVoice("af_heart")).toEqual({ voice: VOICES[0] });
    expect(chooseVoice("")).toMatchObject({ code: "NO_VOICE_GIVEN" });
    expect(chooseVoice(42)).toMatchObject({ code: "NO_VOICE_GIVEN" });
    expect(chooseVoice("nope")).toMatchObject({ code: "NO_SUCH_VOICE" });
  });
});
