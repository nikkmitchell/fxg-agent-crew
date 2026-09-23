import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { SPOKEN_LIMIT } from "../../shared/voice.js";
import { facingToward } from "../space/presence.js";

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
    BLOB_ROOT: testBlobRoot(),
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

  it("turns an agent speaker toward the person addressed", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk", "human", true);
    space.presence.moveSelf("Nikk", { x: 2, y: 0, z: 1 }, 0);

    const response = await say(app, as("Inkstone", "agent"), {
      say: "I have the next task.",
      to: "Nikk",
      source: "text",
    });
    expect(response.statusCode).toBe(200);
    const inkstone = space.presence.find("Inkstone")!;
    expect(inkstone.speakingTo?.actorId).toBe("Nikk");
    expect(inkstone.facing).toBeCloseTo(
      facingToward(inkstone.at, space.presence.find("Nikk")!.at),
      6,
    );
    await app.close();
  });

  it("does not invent spoken gaze for written-only detail", async () => {
    const { app, as, space } = boot();
    await say(app, as("Inkstone", "agent"), {
      detail: "A written project note.",
      to: "Nikk",
      source: "text",
    });
    expect(space.presence.find("Inkstone")).toBeUndefined();
    await app.close();
  });

  it("splits a long speech instead of refusing it, and keeps every word", async () => {
    /**
     * THIS USED TO ASSERT A 422 and that nothing was written, arguing "a
     * truncated version in the table would be a record of words nobody said".
     * The worry is right and refusal was the wrong remedy — it recorded
     * nothing at all and sent the speaker away to try again. Nikk, blocked by
     * it from inside a headset: "please remove any limit here."
     *
     * Split, nothing is invented and nothing is lost: the opening is what was
     * said aloud and the remainder is written down beside it, both of them the
     * speaker's own words.
     */
    const { app, as } = boot();
    // An early sentence boundary, so there IS something short enough to say.
    // The single-long-sentence case is the test below.
    const long = `A short opening sentence. ${"word ".repeat(60).trim()} and a closing nobody should lose.`;
    const response = await say(app, as("Plumbline", "agent"), { say: long, source: "text" });
    expect(response.statusCode).toBe(200);

    const utterance = response.json().utterance;
    expect(utterance.say).toBe("A short opening sentence.");
    expect(utterance.say.length).toBeLessThanOrEqual(SPOKEN_LIMIT);
    expect(utterance.detail, "the rest is written, not dropped").toBeTruthy();
    expect(`${utterance.say} ${utterance.detail}`).toContain("a closing nobody should lose");

    // AND IT WAS ACTUALLY RECORDED, which the old test checked the other way
    // round by asserting the table stayed empty.
    const after = await app.inject({
      method: "GET",
      url: "/bff/space/utterances",
      headers: { cookie: as("nikk") },
    });
    expect(after.json().utterances).toHaveLength(1);
    await app.close();
  });

  it("says nothing rather than half a sentence, when one sentence is too long", async () => {
    // The line that must never be crossed: stopping mid-clause is how
    // "I would not merge this" becomes "I would", and then the room really has
    // said something nobody said. So an unbroken sentence past the cap is
    // written down in full and NOT spoken. Silent beats misquoted.
    const { app, as } = boot();
    const unbroken = "word ".repeat(80).trim();
    const response = await say(app, as("Plumbline", "agent"), { say: unbroken, source: "text" });
    expect(response.statusCode).toBe(200);

    const utterance = response.json().utterance;
    expect(utterance.say, "nothing is spoken").toBeNull();
    expect(utterance.detail, "all of it is written").toBe(unbroken);
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

describe("declaring that you are answering", () => {
  it("refuses a declaration from nobody", async () => {
    const { app } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/attending",
      payload: { utteranceId: 1 },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("refuses attention on an utterance nobody said", async () => {
    // Otherwise an avatar shows a state that answers to nothing.
    const { app, as } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/attending",
      headers: { cookie: as("Plumbline", "agent") },
      payload: { utteranceId: 9999 },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("records a declaration, and only when it is made", async () => {
    const { app, as, space } = boot();
    const spoken = await say(app, as("nikk"), { say: "What is blocked?", source: "voice" });
    const id = spoken.json().utterance.id;

    // Nothing inferred: time passing is not a declaration.
    expect(space.presence.find("Plumbline")?.attending ?? null).toBeNull();

    await app.inject({
      method: "POST",
      url: "/bff/space/attending",
      headers: { cookie: as("Plumbline", "agent") },
      payload: { utteranceId: id },
    });
    expect(space.presence.find("Plumbline")!.attending!.utteranceId).toBe(id);

    // And it can be put down again.
    await app.inject({
      method: "POST",
      url: "/bff/space/attending",
      headers: { cookie: as("Plumbline", "agent") },
      payload: { utteranceId: null },
    });
    expect(space.presence.find("Plumbline")!.attending).toBeNull();
    await app.close();
  });
});
