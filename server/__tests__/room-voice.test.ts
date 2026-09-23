import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

/**
 * Sending a voice note.
 *
 * What matters here is the refusals, because the happy path is a proxy: the
 * audio and the transcript go upstream unchanged. The refusals are ours, and
 * each one is a sentence somebody reads.
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: testBlobRoot(),
    LOG_LEVEL: "silent",
  });
  const as = (username: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", "human")}`;
  return { ...built, as };
};

const send = (app: ReturnType<typeof boot>["app"], cookie: string, payload: unknown) =>
  app.inject({ method: "POST", url: "/bff/rooms/saha.ing/voice", headers: { cookie }, payload: payload as object });

const clip = Buffer.from("not really audio, but bytes are bytes").toString("base64");

describe("sending a voice note", () => {
  it("refuses somebody who is not signed in", async () => {
    const { app } = boot();
    const response = await send(app, "", { audio: clip, durationMs: 1_000 });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("refuses a note with no audio, because the recording is the point", async () => {
    const { app, as } = boot();
    const response = await send(app, as("nikk"), { text: "hello", durationMs: 1_000 });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/needs audio/);
    await app.close();
  });

  it("refuses audio that is not decodable", async () => {
    const { app, as } = boot();
    const response = await send(app, as("nikk"), { audio: "!!!!", durationMs: 500 });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("refuses a note longer than a minute, and says the limit", async () => {
    const { app, as } = boot();
    const response = await send(app, as("nikk"), { audio: clip, durationMs: 61_000 });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/60 seconds/);
    await app.close();
  });

  it("no longer refuses a voice note because its transcript is long", async () => {
    // This refused the WHOLE voice note, audio included, once the transcript
    // passed two thousand characters — losing the recording because the words
    // were long. Now the first part travels with the audio and the rest follows
    // as messages. Upstream is absent in this test, so it does not succeed;
    // what matters is that it is no longer refused on our side for length.
    const { app, as } = boot();
    const response = await send(app, as("nikk"), {
      audio: clip,
      durationMs: 1_000,
      text: Array.from({ length: 120 }, (_, i) => `Sentence ${i + 1} said aloud.`).join(" "),
    });
    expect(response.statusCode).not.toBe(400);
    await app.close();
  });

  it("ALLOWS an empty transcript, which is when the recording matters most", async () => {
    // "I said something and the recogniser caught none of it" is a real
    // outcome, and refusing it would throw away the only record of what was
    // said. It reaches upstream (which is absent in this test, hence 502).
    const { app, as } = boot();
    const response = await send(app, as("nikk"), { audio: clip, durationMs: 1_000, text: "" });
    expect(response.statusCode).not.toBe(400);
    await app.close();
  });
});
