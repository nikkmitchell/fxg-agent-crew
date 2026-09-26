import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { registerTranscribeRoutes, MAX_AUDIO_BYTES } from "../space/transcribe.js";
import { encodeWav } from "../../src/space/wav.js";
import { tempDir } from "./test-config.js";

/**
 * The seam between a headset holding a recording and a transcriber holding a
 * file — which is the whole feature, because the words themselves are
 * whisper's business and the parts either side are ours.
 *
 * A FAKE TRANSCRIBER, deliberately. It is handed the real path of the real
 * bytes the real route wrote, so everything here is exercised except the model:
 * the session gate, the raw body, the size limit, the queue of one, the temp
 * file, and that the recording is deleted afterwards. Whisper's own printout is
 * covered by readTranscript's tests.
 */

const wav = (seconds = 1) => {
  const samples = new Float32Array(16_000 * seconds);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 8) * 0.3;
  return Buffer.from(encodeWav(samples, 16_000));
};

const boot = (transcriber?: (path: string) => Promise<string>) => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: tempDir("blobs-"),
  });
  // A second registration on its own prefix, so one server can be asked both
  // "what if nothing is configured" and "what if something is".
  built.app.register(
    async (scoped) => registerTranscribeRoutes(scoped, built.config, built.sessions, { transcriber }),
    { prefix: "/with" },
  );
  const as = (username: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, "upstream-token", "human")}`;
  return { ...built, as };
};

const post = (app: ReturnType<typeof boot>["app"], cookie: string | undefined, body: Buffer, url = "/with/bff/space/transcribe") =>
  app.inject({
    method: "POST",
    url,
    payload: body,
    headers: { "content-type": "audio/wav", ...(cookie ? { cookie } : {}) },
  });

describe("asking the room to write down what was said", () => {
  it("refuses without a session, like every other write", async () => {
    const built = boot(async () => "hello");
    const response = await post(built.app, undefined, wav());
    expect(response.statusCode).toBe(401);
    await built.app.close();
  });

  it("hands back the words, and says it heard something", async () => {
    const built = boot(async () => "[00:00:00.000 --> 00:00:01.000]   move my home to where I am standing\n");
    const response = await post(built.app, built.as("nikk2"), wav());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "move my home to where I am standing", heard: true });
    await built.app.close();
  });

  /**
   * A held button and no speech. Sending "(BLANK_AUDIO)" to the group under
   * somebody's name would be worse than sending nothing, so the route says
   * plainly that it heard nothing and the room keeps the draft empty.
   */
  it("says it heard nothing rather than sending the transcriber's aside", async () => {
    const built = boot(async () => "[BLANK_AUDIO]\n");
    const response = await post(built.app, built.as("nikk2"), wav());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "", heard: false });
    await built.app.close();
  });

  it("gives the transcriber a real file of exactly the bytes that were sent", async () => {
    const sent = wav(2);
    let seen: Buffer | null = null;
    const built = boot(async (path) => {
      const { readFile } = await import("node:fs/promises");
      seen = await readFile(path);
      return "read it";
    });
    await post(built.app, built.as("nikk2"), sent);

    expect(seen, "the transcriber was handed a file").not.toBeNull();
    expect(Buffer.compare(seen as unknown as Buffer, sent), "byte for byte").toBe(0);
    await built.app.close();
  });

  /** Somebody's voice lives on our disk for as long as the transcriber needs it. */
  it("deletes the recording afterwards, and after a failure too", async () => {
    const paths: string[] = [];
    const built = boot(async (path) => {
      paths.push(path);
      if (paths.length === 2) throw new Error("model fell over");
      return "kept nothing";
    });
    const cookie = built.as("nikk2");
    await post(built.app, cookie, wav());
    const failed = await post(built.app, cookie, wav());
    expect(failed.statusCode).toBe(502);

    const { existsSync } = await import("node:fs");
    for (const path of paths) expect(existsSync(path), path).toBe(false);
    await built.app.close();
  });

  it("refuses an empty body with a sentence rather than a stack trace", async () => {
    const built = boot(async () => "hello");
    const response = await post(built.app, built.as("nikk2"), Buffer.alloc(0));
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/raw request body/);
    await built.app.close();
  });

  it("refuses a recording longer than anybody speaks for", async () => {
    const built = boot(async () => "hello");
    const response = await post(built.app, built.as("nikk2"), Buffer.alloc(MAX_AUDIO_BYTES + 2));
    // Fastify's own limit answers first; either way nothing reaches a model.
    expect([413, 400]).toContain(response.statusCode);
    await built.app.close();
  });

  /**
   * WAITED FOR, NOT SLEPT THROUGH. The first version of this test gave the
   * route 20 ms to reach the transcriber and then sent the second request. It
   * passed alone and failed inside the full suite, where 20 ms is not enough on
   * a loaded machine — and failed by TIMING OUT, because the first request's
   * promise was then never released. It also blocked a deploy, which is the
   * release guard doing its job on a fault of mine rather than a real one.
   *
   * The transcriber now says when it has been entered, so the ordering this
   * test is about is the thing being awaited.
   */
  it("tells a second speaker to wait rather than taking the room down with them", async () => {
    // The server that transcribes is the server that draws the room.
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const built = boot(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("first");
          entered();
        }),
    );
    const cookie = built.as("nikk2");
    const first = post(built.app, cookie, wav());
    await reached;
    const second = await post(built.app, cookie, wav());

    expect(second.statusCode).toBe(503);
    expect(second.json().error).toMatch(/Try again in a moment/);
    release();
    expect((await first).statusCode).toBe(200);
    await built.app.close();
  });
});

describe("a room with no transcriber set up", () => {
  it("says so, in words, rather than failing in a way somebody must interpret", async () => {
    const built = boot();
    // The unprefixed registration in server/index.ts, with no TRANSCRIBE_CMD.
    const response = await post(built.app, built.as("nikk2"), wav(), "/bff/space/transcribe");

    expect(response.statusCode).toBe(501);
    expect(response.json().error).toMatch(/cannot turn speech into words yet/);
    await built.app.close();
  });

  it("answers the question the button asks before it changes what it does", async () => {
    const built = boot(async () => "hello");
    const cookie = built.as("nikk2");

    const without = await built.app.inject({ method: "GET", url: "/bff/space/transcribe", headers: { cookie } });
    expect(without.json()).toEqual({ available: false });

    const with_ = await built.app.inject({ method: "GET", url: "/with/bff/space/transcribe", headers: { cookie } });
    expect(with_.json()).toEqual({ available: true });
    await built.app.close();
  });
});
