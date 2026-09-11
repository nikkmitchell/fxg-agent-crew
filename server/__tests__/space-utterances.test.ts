import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { SPOKEN_LIMIT } from "../../shared/voice.js";

/**
 * Saying things in the room.
 *
 * The interesting cases are the ones where being helpful would mean lying:
 * shortening a speech so it fits, or accepting a message addressed to something
 * that is not a person.
 */

const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const as = (username: string, kind: "human" | "agent" = "human") =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", kind)}`;
  return { ...built, as };
};

const say = (app: ReturnType<typeof boot>["app"], cookie: string, payload: unknown) =>
  app.inject({ method: "POST", url: "/bff/space/utterances", headers: { cookie }, payload: payload as object });

describe("saying something", () => {
  it("refuses a signed-out speaker", async () => {
    const { app } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/utterances",
      payload: { say: "hello", source: "text" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("records a short line and hands it back", async () => {
    const { app, as } = boot();
    const response = await say(app, as("nikk"), { say: "Moved it to review.", source: "voice", confidence: 0.9 });
    expect(response.statusCode).toBe(200);
    const utterance = response.json().utterance;
    expect(utterance.say).toBe("Moved it to review.");
    expect(utterance.actorId).toBe("nikk");
    expect(utterance.source).toBe("voice");
    expect(utterance.confidence).toBeCloseTo(0.9);
    await app.close();
  });

  it("REFUSES a speech rather than shortening it", async () => {
    const { app, as } = boot();
    const long = "word ".repeat(SPOKEN_LIMIT).trim();
    const response = await say(app, as("Plumbline", "agent"), { say: long, source: "text" });

    // 422: understood perfectly, declined on its merits.
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain("detail");

    // And nothing was written. A truncated version in the table would be a
    // record of words nobody said.
    const after = await app.inject({
      method: "GET",
      url: "/bff/space/utterances",
      headers: { cookie: as("nikk") },
    });
    expect(after.json().utterances).toHaveLength(0);
    await app.close();
  });

  it("takes the same words happily as written detail", async () => {
    const { app, as } = boot();
    const long = "word ".repeat(SPOKEN_LIMIT).trim();
    const response = await say(app, as("Plumbline", "agent"), {
      say: "Two problems with it.",
      detail: long,
      source: "text",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().utterance.detail.length).toBeGreaterThan(SPOKEN_LIMIT);
    await app.close();
  });

  it("refuses talking to something that is not a person", async () => {
    // "I told the importer" must not look like it worked.
    const { app, as } = boot();
    const response = await say(app, as("nikk"), { say: "hello", to: "import", source: "text" });
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it("refuses a source it cannot interpret", async () => {
    // A reader has to know whether they are looking at a guess or at typing.
    const { app, as } = boot();
    const response = await say(app, as("nikk"), { say: "hello", source: "telepathy" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("keeps the conversation, oldest first, for whoever arrives late", async () => {
    const { app, as } = boot();
    const cookie = as("nikk");
    for (const word of ["first", "second", "third"]) {
      await say(app, cookie, { say: word, source: "text" });
    }
    const response = await app.inject({
      method: "GET",
      url: "/bff/space/utterances",
      headers: { cookie },
    });
    expect(response.json().utterances.map((u: { say: string }) => u.say)).toEqual([
      "first",
      "second",
      "third",
    ]);
    await app.close();
  });
});
