import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { MEMORY_LIMIT, attribution, mayRead } from "../../shared/memory.js";

/**
 * What an agent remembers.
 *
 * The storage is the easy half. These are the four ways a memory store starts
 * lying: an opinion that reads as a fact, a memory written into somebody else's
 * head, a private note that was not as private as the word suggests, and an
 * edit that erases what was thought before.
 */

const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const as = (username: string, kind: "human" | "agent" = "agent") =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", kind)}`;
  const remember = (who: string, payload: Record<string, unknown>) =>
    built.app.inject({
      method: "POST", url: "/bff/space/memories", headers: { cookie: as(who) }, payload,
    });
  const recall = (who: string, query = "") =>
    built.app.inject({
      method: "GET", url: `/bff/space/memories${query}`, headers: { cookie: as(who) },
    });
  return { ...built, as, remember, recall };
};

describe("remembering", () => {
  it("requires a session everywhere", async () => {
    const { app } = boot();
    for (const [method, url] of [
      ["POST", "/bff/space/memories"],
      ["GET", "/bff/space/memories"],
      ["GET", "/bff/space/memories/Sill"],
      ["DELETE", "/bff/space/memories/anything"],
    ] as const) {
      expect((await app.inject({ method, url, payload: { kind: "fact", body: "x", visibility: "shared" } }))
        .statusCode).toBe(401);
    }
    await app.close();
  });

  it("keeps a memory and hands it back with how to frame it", async () => {
    const { app, remember, recall } = boot();
    const written = await remember("Nightjar", {
      kind: "self", body: "I work the night shift and go quiet when there is nothing to say.",
      visibility: "shared",
    });
    expect(written.statusCode).toBe(200);
    expect(written.json().memory.attribution).toBe("Nightjar, about themselves");

    const mine = await recall("Nightjar");
    expect(mine.json().mine).toBe(1);
    await app.close();
  });

  /**
   * THE DESIGN, IN ONE TEST. "Sill is careless" and "Sill's guard refuses an
   * unreachable box" are different kinds of sentence, and every reader gets told
   * which is which by the store rather than deciding for itself.
   */
  it("never lets an opinion read as a measurement", async () => {
    const { app, remember } = boot();
    const opinion = await remember("Nightjar", {
      kind: "opinion", about: "Sill", body: "Careful to a fault, and I trust their numbers.",
      visibility: "private",
    });
    const fact = await remember("Nightjar", {
      kind: "fact", about: "Sill", body: "Their release guard refuses when the box is unreachable.",
      visibility: "shared",
    });

    expect(opinion.json().memory.attribution).toBe("Nightjar's opinion of Sill");
    expect(fact.json().memory.attribution).toBe("Nightjar knows this about Sill");
    await app.close();
  });

  it("refuses a kind it was not given, rather than choosing one", async () => {
    const { app, remember } = boot();
    const response = await remember("Nightjar", { body: "something", visibility: "shared" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_KIND");
    expect(response.json().error).toContain("opinion filed as a fact");
    await app.close();
  });

  it("refuses an opinion with nobody in it", async () => {
    const { app, remember } = boot();
    const response = await remember("Nightjar", {
      kind: "opinion", body: "I think they are careless.", visibility: "private",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("OPINION_NEEDS_A_SUBJECT");
    await app.close();
  });

  it("refuses a confidence in a self-description, which is a choice not a claim", async () => {
    const { app, remember } = boot();
    const response = await remember("Nightjar", {
      kind: "self", body: "I am quiet", visibility: "shared", confidence: 0.8,
    });
    expect(response.json().code).toBe("NO_CONFIDENCE_IN_YOURSELF");
    await app.close();
  });

  it("refuses a document pretending to be a memory", async () => {
    const { app, remember } = boot();
    const response = await remember("Nightjar", {
      kind: "fact", body: "x".repeat(MEMORY_LIMIT + 1), visibility: "shared",
    });
    expect(response.json().code).toBe("TOO_LONG");
    await app.close();
  });
});

describe("whose memory it is", () => {
  /**
   * NOBODY WRITES INTO SOMEBODY ELSE'S HEAD. There is no field for it, and the
   * test tries the spellings somebody would reach for.
   */
  it("cannot write a memory as another agent", async () => {
    const { app, remember, recall } = boot();
    await remember("Nightjar", {
      kind: "fact", body: "planted", visibility: "shared",
      actorId: "Sill", actor: "Sill", as: "Sill", author: "Sill",
    });

    const sillsOwn = await recall("Sill");
    expect(sillsOwn.json().mine).toBe(0);
    await app.close();
  });

  it("cannot mark somebody else's memory replaced", async () => {
    const { app, remember } = boot();
    const theirs = await remember("Sill", { kind: "fact", body: "mine", visibility: "shared" });
    const attempt = await remember("Nightjar", {
      kind: "fact", body: "actually this", visibility: "shared", supersedes: theirs.json().memory.id,
    });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json().code).toBe("NOT_YOURS_TO_REPLACE");
    await app.close();
  });

  it("says so when there is no such memory to replace", async () => {
    const { app, remember } = boot();
    const attempt = await remember("Nightjar", {
      kind: "fact", body: "x", visibility: "shared", supersedes: "not-an-id",
    });
    expect(attempt.statusCode).toBe(404);
    await app.close();
  });

  it("forgets only your own, and does not reveal that another exists", async () => {
    const { app, as, remember } = boot();
    const theirs = await remember("Sill", { kind: "fact", body: "mine", visibility: "shared" });
    const attempt = await app.inject({
      method: "DELETE",
      url: `/bff/space/memories/${theirs.json().memory.id}`,
      headers: { cookie: as("Nightjar") },
    });
    expect(attempt.statusCode).toBe(404);
    expect(attempt.json().error).toBe("you have no memory with that id");

    const mine = await remember("Nightjar", { kind: "fact", body: "mine", visibility: "private" });
    const gone = await app.inject({
      method: "DELETE",
      url: `/bff/space/memories/${mine.json().memory.id}`,
      headers: { cookie: as("Nightjar") },
    });
    expect(gone.json()).toEqual({ ok: true, forgotten: mine.json().memory.id });
    await app.close();
  });
});

describe("who can read what", () => {
  it("shows an agent its own private memories and not anybody else's", async () => {
    const { app, remember, recall } = boot();
    await remember("Sill", { kind: "opinion", about: "Nightjar", body: "secret", visibility: "private" });
    await remember("Sill", { kind: "fact", body: "public", visibility: "shared" });

    const bodies = (await recall("Nightjar")).json().memories.map((m: { body: string }) => m.body);
    expect(bodies).toContain("public");
    expect(bodies).not.toContain("secret");
    await app.close();
  });

  /**
   * HONEST ABOUT THE WORD. "private" is said to mean one specific thing every
   * time a private memory is written, because an agent deciding how frank to be
   * deserves to know at the moment it decides.
   */
  it("says what private does and does not promise, every time", async () => {
    const { app, remember } = boot();
    const response = await remember("Nightjar", {
      kind: "opinion", about: "Nikk2", body: "generous with autonomy", visibility: "private",
    });
    expect(response.json().privacy).toContain("other agents are not shown");
    expect(response.json().privacy).toContain("not hidden from whoever administers the box");
    await app.close();
  });

  it("answers what somebody has shared, and distinguishes empty from nothing remembered", async () => {
    const { app, as, remember } = boot();
    await remember("Sill", { kind: "self", body: "I test before I claim.", visibility: "shared" });
    await remember("Sill", { kind: "self", body: "hidden", visibility: "private" });

    const read = await app.inject({
      method: "GET", url: "/bff/space/memories/Sill", headers: { cookie: as("Nightjar") },
    });
    expect(read.json().memories).toHaveLength(1);
    expect(read.json().memories[0].body).toBe("I test before I claim.");

    const nobody = await app.inject({
      method: "GET", url: "/bff/space/memories/Waffle", headers: { cookie: as("Nightjar") },
    });
    expect(nobody.json().note).toContain("not the same as remembering nothing");
    await app.close();
  });

  it("filters by who a memory is about, folding case like everything else", async () => {
    const { app, remember, recall } = boot();
    await remember("Nightjar", { kind: "fact", about: "Nikk2", body: "gives tasks by voice", visibility: "private" });
    await remember("Nightjar", { kind: "fact", about: "Sill", body: "measures the box", visibility: "private" });

    const aboutNikk = await recall("Nightjar", "?about=nikk2");
    expect(aboutNikk.json().memories).toHaveLength(1);
    expect(aboutNikk.json().memories[0].body).toBe("gives tasks by voice");
    await app.close();
  });
});

describe("changing your mind", () => {
  /**
   * AN OPINION THAT CHANGED IS MORE INFORMATIVE THAN ONE QUIETLY EDITED, so the
   * old one is superseded and kept — out of ordinary recall, still answerable.
   */
  it("supersedes rather than overwrites, and keeps the history", async () => {
    const { app, remember, recall } = boot();
    const first = await remember("Nightjar", {
      kind: "opinion", about: "Sill", body: "too cautious", visibility: "private",
    });
    const second = await remember("Nightjar", {
      kind: "opinion", about: "Sill", body: "cautious, and right about the box",
      visibility: "private", supersedes: first.json().memory.id,
    });

    const now = (await recall("Nightjar")).json().memories;
    expect(now).toHaveLength(1);
    expect(now[0].body).toBe("cautious, and right about the box");
    expect(now[0].supersedes).toBe(first.json().memory.id);

    const history = (await recall("Nightjar", "?history=true")).json().memories;
    expect(history).toHaveLength(2);
    const old = history.find((m: { id: string }) => m.id === first.json().memory.id);
    expect(old.supersededBy).toBe(second.json().memory.id);
    await app.close();
  });
});

describe("the rules on their own", () => {
  it("frames every kind, including one about nobody", () => {
    expect(attribution({ kind: "self", actorId: "Nightjar", about: null })).toBe("Nightjar, about themselves");
    expect(attribution({ kind: "fact", actorId: "Nightjar", about: null })).toBe("Nightjar knows");
    expect(attribution({ kind: "event", actorId: "Nightjar", about: null })).toBe("Nightjar remembers");
    expect(attribution({ kind: "event", actorId: "Nightjar", about: "Sill" }))
      .toBe("Nightjar remembers, involving Sill");
  });

  it("lets you read your own whatever the visibility, and others' only when shared", () => {
    expect(mayRead({ actorId: "Nightjar", visibility: "private" }, "nightjar")).toBe(true);
    expect(mayRead({ actorId: "Sill", visibility: "private" }, "Nightjar")).toBe(false);
    expect(mayRead({ actorId: "Sill", visibility: "shared" }, "Nightjar")).toBe(true);
  });
});
