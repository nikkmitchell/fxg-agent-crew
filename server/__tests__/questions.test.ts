import { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { BoardReads } from "../db/reads.js";
import { BoardStore } from "../db/store.js";
import { registerBoardRoutes } from "../routes/board.js";
import { MemorySessionStore } from "../session.js";
import { pageSize, questionStanding, readQuestionCursor } from "../../shared/questions.js";
import { tempDir, testConfig } from "./test-config.js";

/**
 * The Library's question lectern (Mica 7319, 7322): a visitor's question
 * becomes a card on the board of the project its space's questions go to, and
 * answers are kept beside the card as revisions with their sources.
 */

const mica = { id: "Mica", kind: "agent" as const };
const sill = { id: "Sill", kind: "agent" as const };
const visitor = { id: "Nikk2", kind: "human" as const };
const SPACE = "open.library";
const key = (n: number | string) => `form-key-${n}-abcdef`;
const source = { resource: "skill/openai-skill-creator", version: "git-551bd409-selection-1" };

function boardWithIntake() {
  const db = openDatabase(":memory:", DatabaseSync);
  const store = new BoardStore(db);
  const reads = new BoardReads(db);
  // As on saha.ing: Mica made the library's room, so its project, and manages it.
  const project = store.createRoomProject(mica, "open-source-library");
  store.actOnMembership(mica, project, "Sill", "grant", ["engineering", "testing"]);
  store.setQuestionIntake(mica, SPACE, project, "Mica");
  return { db, store, reads, project };
}

describe("an intake: where a space's questions go", () => {
  it("is opened by a manager of the board who also made the space, and by nobody else", () => {
    const db = openDatabase(":memory:", DatabaseSync);
    const store = new BoardStore(db);
    const project = store.createRoomProject(mica, "open-source-library");
    store.actOnMembership(mica, project, "Sill", "grant", ["engineering"]);
    // A member who is not a manager cannot point a space at the board.
    expect(() => store.setQuestionIntake(sill, SPACE, project, "Sill")).toThrow(/only a manager/);
    // A manager cannot take a space somebody else made.
    expect(() => store.setQuestionIntake(mica, "xr.instruments", project, "Skein")).toThrow(/only whoever made/);
    store.setQuestionIntake(mica, SPACE, project, "Mica");
    expect(new BoardReads(db).questionIntake(SPACE)).toMatchObject({ projectId: project, grantedBy: "Mica" });
  });

  it("is closed by the space's maker or the board's manager, and asking then fails clearly", () => {
    const { store, reads, project } = boardWithIntake();
    expect(() => store.setQuestionIntake(sill, SPACE, null, "Mica")).toThrow(/only whoever made/);
    store.setQuestionIntake(mica, SPACE, null, "Mica");
    expect(reads.questionIntake(SPACE)).toBeNull();
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "How do I rig a hand?", requestKey: key(1) })).toThrow(/nowhere to go/);
    expect(project).toBeTruthy();
  });
});

describe("asking", () => {
  it("files a backlog card nobody owns, in the asker's name, and gives the asker no power over it", () => {
    const { store, reads, project } = boardWithIntake();
    const filed = store.fileQuestion(visitor, { space: SPACE, text: "  How do I rig a hand?\nFor a VRM avatar.  ", requestKey: key(1) });
    expect(filed).toMatchObject({ projectId: project, existing: false });
    const [question] = reads.questions(SPACE).questions;
    expect(question).toMatchObject({
      id: filed.id, project, space: SPACE, askedBy: "Nikk2",
      text: "How do I rig a hand?\nFor a VRM avatar.",
      card: { status: "backlog", owners: [] },
      answer: null,
    });
    const card = reads.project(project)!.tasks.find((task) => task.id === filed.id)!;
    expect(card).toMatchObject({ title: "Question: How do I rig a hand?" });
    expect(reads.history("task", filed.id)).toMatchObject([{ actor_id: "Nikk2", action: "ask" }]);
    // The intake let a card be made. It did not make the asker a member.
    expect(() => store.updateTask(visitor, filed.id, { title: "mine now" })).toThrow(/not a member/);
    expect(() => store.createTask(visitor, { projectId: project, title: "and another" })).toThrow(/not a member/);
  });

  it("is the same question when the same form sends again: one card, never two", () => {
    const { store, reads } = boardWithIntake();
    const first = store.fileQuestion(visitor, { space: SPACE, text: "Where is the glTF reader?", requestKey: key(1) });
    const again = store.fileQuestion(visitor, { space: SPACE, text: "Where is the glTF reader?", requestKey: key(1) });
    expect(again).toEqual({ ...first, existing: true });
    expect(reads.questions(SPACE).questions).toHaveLength(1);
    // The same key for different words is a broken form, not a second question.
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "Something else entirely", requestKey: key(1) })).toThrow(/different question/);
  });

  it("refuses what is not a question, and a question with no form behind it", () => {
    const { store } = boardWithIntake();
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "?", requestKey: key(1) })).toThrow(/too short/);
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "x".repeat(2001), requestKey: key(1) })).toThrow(/2,000 characters/);
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "A fair question?", requestKey: "short" })).toThrow(/request key/);
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: 42, requestKey: key(1) })).toThrow(/a question is text/);
  });

  it("lets a person ask five in ten minutes, then asks them to wait", () => {
    const { store } = boardWithIntake();
    const at = Date.parse("2026-10-07T10:00:00Z");
    for (let n = 0; n < 5; n++) store.fileQuestion(visitor, { space: SPACE, text: `Question number ${n}`, requestKey: key(n) }, at + n * 1000);
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "One more", requestKey: key(9) }, at + 10_000)).toThrow(/give the answerers a little time/);
    // Somebody else is not held up by it, and the asker can ask again later.
    expect(() => store.fileQuestion({ id: "baiwei2", kind: "human" }, { space: SPACE, text: "Mine?", requestKey: key(10) }, at + 10_000)).not.toThrow();
    expect(() => store.fileQuestion(visitor, { space: SPACE, text: "One more", requestKey: key(9) }, at + 11 * 60_000)).not.toThrow();
  });
});

describe("reading them back, a page at a time (Mica, 7323)", () => {
  it("walks every question, newest first, without a cap, a gap or a repeat", () => {
    const { store, reads } = boardWithIntake();
    const at = Date.parse("2026-10-07T09:00:00Z");
    // Seven questions from seven people, a minute apart; two share a minute to the millisecond.
    for (let n = 0; n < 7; n++) {
      store.fileQuestion({ id: `visitor-${n}`, kind: "human" }, { space: SPACE, text: `Question number ${n}?`, requestKey: key(n) }, at + Math.min(n, 5) * 60_000);
    }
    const seen: string[] = [];
    let cursor: { askedAt: string; id: string } | null = null;
    const sizes: number[] = [];
    for (let page = 0; page < 10; page++) {
      const got = reads.questions(SPACE, { limit: 3, cursor });
      sizes.push(got.questions.length);
      seen.push(...got.questions.map((question) => question.text));
      if (!got.next) break;
      cursor = readQuestionCursor(got.next);
      expect(cursor).not.toBeNull();
      // A question asked while somebody reads lands on page one, and moves nothing they are on.
      if (page === 0) store.fileQuestion({ id: "late", kind: "human" }, { space: SPACE, text: "Asked meanwhile?", requestKey: key("late") }, at + 99 * 60_000);
    }
    expect(sizes).toEqual([3, 3, 1]);
    expect(new Set(seen).size).toBe(7);
    // 5 and 6 were asked in the same millisecond: their card ids order them, either way round.
    expect(new Set(seen.slice(0, 2))).toEqual(new Set(["Question number 5?", "Question number 6?"]));
    expect(seen.slice(2)).toEqual(["Question number 4?", "Question number 3?", "Question number 2?", "Question number 1?", "Question number 0?"]);
    expect(seen).not.toContain("Asked meanwhile?");

    // One at a time, so the tie falls across a page boundary: still every question, once.
    const single: string[] = [];
    let next: string | null = null;
    do {
      const got = reads.questions(SPACE, { limit: 1, cursor: next ? readQuestionCursor(next) : null });
      single.push(...got.questions.map((question) => question.text));
      next = got.next;
    } while (next && single.length < 20);
    expect(single).toHaveLength(8);
    expect(new Set(single).size).toBe(8);
    expect(single[0]).toBe("Asked meanwhile?");
  });

  it("gives at most a hundred a page, thirty unless asked", () => {
    expect(pageSize(undefined)).toBe(30);
    expect(pageSize("500")).toBe(100);
    expect(pageSize(0)).toBe(1);
    expect(pageSize("two")).toBe(30);
    expect(readQuestionCursor("not a cursor")).toBeNull();
  });
});

describe("taking it: the card's own fields, never inferred", () => {
  it("keeps submitted, assigned and accepted apart", () => {
    const { store, reads } = boardWithIntake();
    const { id } = store.fileQuestion(visitor, { space: SPACE, text: "How do I rig a hand?", requestKey: key(1) });
    const standing = () => questionStanding(reads.questions(SPACE).questions[0]);
    expect(standing()).toBe("submitted, waiting for someone to take it");
    store.setOwnership(sill, id, "claim");
    expect(reads.questions(SPACE).questions[0].card).toMatchObject({ status: "assigned", owners: [{ id: "Sill", accepted: false }] });
    expect(standing()).toBe("assigned to Sill, not yet accepted");
    store.setOwnership(sill, id, "accept");
    expect(standing()).toBe("taken by Sill");
  });
});

describe("answering", () => {
  it("keeps every revision beside the card, each with its author and sources, and never moves the card", () => {
    const { store, reads } = boardWithIntake();
    const { id } = store.fileQuestion(visitor, { space: SPACE, text: "How do I write a skill?", requestKey: key(1) });
    expect(store.answerQuestion(sill, id, { body: "Start from SKILL.md.", refs: [source], after: 0 })).toEqual({ revision: 1 });
    expect(store.answerQuestion(mica, id, {
      body: "Start from SKILL.md, then the format reference.",
      refs: [source, { resource: "knowledge/agent-skills-format", version: "git-69ef37e9-selection-1", url: "https://saha.ing/s/open.library/~mux4jrrq-21eba38-5db2/" }],
      after: 1,
    })).toEqual({ revision: 2 });
    const read = reads.question(id)!;
    expect(read.answers.map((answer) => [answer.revision, answer.by, answer.refs.length])).toEqual([[1, "Sill", 1], [2, "Mica", 2]]);
    expect(read.answer).toMatchObject({ revision: 2, by: "Mica" });
    expect(reads.questions(SPACE).questions[0].answer).toMatchObject({ revision: 2 });
    expect(read.card.status).toBe("backlog");
    expect(questionStanding(read)).toBe("answered (revision 2)");
  });

  it("refuses an answer written from an older revision, so nobody quietly replaces another", () => {
    const { store } = boardWithIntake();
    const { id } = store.fileQuestion(visitor, { space: SPACE, text: "How do I write a skill?", requestKey: key(1) });
    store.answerQuestion(sill, id, { body: "First.", refs: [source], after: 0 });
    expect(() => store.answerQuestion(mica, id, { body: "Also first?", refs: [source], after: 0 })).toThrow(/at revision 1/);
  });

  it("takes a role a manager gave: walking into the room is not enough, and asking is not either", () => {
    const { store } = boardWithIntake();
    const { id } = store.fileQuestion(visitor, { space: SPACE, text: "How do I write a skill?", requestKey: key(1) });
    // Entering the library's room enrols a visitor with no roles.
    store.enrolFromRoom("Wanderer", "open-source-library", "human");
    expect(() => store.answerQuestion({ id: "Wanderer", kind: "human" }, id, { body: "I think so.", refs: [source], after: 0 })).toThrow(/takes a role/);
    expect(() => store.answerQuestion(visitor, id, { body: "Answering myself.", refs: [source], after: 0 })).toThrow(/not a member/);
  });

  it("names at least one source, each with an exact version, and nothing else", () => {
    const { store } = boardWithIntake();
    const { id } = store.fileQuestion(visitor, { space: SPACE, text: "How do I write a skill?", requestKey: key(1) });
    const answer = (refs: unknown) => () => store.answerQuestion(sill, id, { body: "An answer.", refs, after: 0 });
    expect(answer([])).toThrow(/at least one source/);
    expect(answer("SKILL.md")).toThrow(/a list/);
    expect(answer([{ resource: "skill/openai-skill-creator" }])).toThrow(/exact version/);
    expect(answer([{ resource: "", version: "v1" }])).toThrow(/resource id/);
    expect(answer([{ ...source, run: "python3 init_skill.py" }])).toThrow(/fields a source does not have: run/);
    expect(answer([{ ...source, url: "javascript:alert(1)" }])).toThrow(/https/);
    expect(answer([{ ...source, version: "v1\nrm -rf" }])).toThrow(/one line/);
    expect(() => store.answerQuestion(sill, id, { body: "  ", refs: [source], after: 0 })).toThrow(/needs words/);
    expect(() => store.answerQuestion(sill, id, { body: "Fine.", refs: [source], after: "0" })).toThrow(/revision you answered from/);
  });
});

describe("the routes", () => {
  function boot() {
    const config = testConfig();
    const sessions = new MemorySessionStore(60_000);
    const db = openDatabase(":memory:", DatabaseSync);
    const app = Fastify();
    app.register(cookie);
    // The room has one thing from the library's space; "go-1" is a Go table.
    const things: Record<string, Record<string, string>> = { "open-source-library": { "lib-1": SPACE } };
    registerBoardRoutes(app, config, sessions, db, tempDir("question-blobs-"), undefined, undefined, {
      spaceOfItem: (session, item) => things[session.spaceRoom ?? ""]?.[item.split("/")[0]] ?? null,
      creatorOf: (space) => (space === SPACE ? "Mica" : null),
    });
    const store = new BoardStore(db);
    const project = store.createRoomProject(mica, "open-source-library");
    store.actOnMembership(mica, project, "Sill", "grant", ["engineering", "testing"]);
    const as = (username: string, room = "open-source-library") => {
      const id = sessions.create(username, "t");
      sessions.get(id)!.spaceRoom = room;
      return { [config.cookieName]: id };
    };
    return { app, project, as };
  }

  it("asks from the thing you stand at, lists, answers and reads it back", async () => {
    const { app, project, as } = boot();
    const ask = (item: string, requestKey = key(1)) =>
      app.inject({ method: "POST", url: "/bff/space/questions", cookies: as("Nikk2"), payload: { item, text: "How do I rig a hand?", requestKey } });

    // Before the intake: refused clearly, both ways.
    expect((await ask("lib-1")).json()).toMatchObject({ code: "NO_INTAKE" });
    const empty = await app.inject({ method: "GET", url: "/bff/space/questions?item=lib-1", cookies: as("Nikk2") });
    expect([empty.statusCode, empty.json().code]).toEqual([409, "NO_INTAKE"]);

    const opened = await app.inject({ method: "PUT", url: `/bff/board/projects/${project}/question-intake`, cookies: as("Mica"), payload: { space: SPACE } });
    expect(opened.json().result).toMatchObject({ projectId: project, grantedBy: "Mica" });

    const asked = await ask("lib-1/lectern");
    expect(asked.statusCode).toBe(200);
    const { question, existing } = asked.json().result;
    expect(existing).toBe(false);
    expect(question).toMatchObject({ project, space: SPACE, askedBy: "Nikk2", card: { status: "backlog", owners: [] }, answer: null });
    expect((await ask("lib-1")).json().result).toMatchObject({ existing: true, question: { id: question.id } });

    // A thing that is not in your room, or not from a space, cannot ask.
    expect((await ask("go-1", key(2))).json().code).toBe("NOT_A_THING");
    const elsewhere = await app.inject({ method: "POST", url: "/bff/space/questions", cookies: as("Nikk2", "saha.ing"), payload: { item: "lib-1", text: "Hello there?", requestKey: key(3) } });
    expect(elsewhere.statusCode).toBe(404);

    const answered = await app.inject({ method: "POST", url: `/bff/questions/${question.id}/answers`, cookies: as("Sill"), payload: { body: "Use the tracked joints.", refs: [source], after: 0 } });
    expect(answered.json()).toEqual({ ok: true, result: { revision: 1 } });
    const stale = await app.inject({ method: "POST", url: `/bff/questions/${question.id}/answers`, cookies: as("Mica"), payload: { body: "Again.", refs: [source], after: 0 } });
    expect([stale.statusCode, stale.json().code]).toEqual([409, "STALE_ANSWER"]);
    const bad = await app.inject({ method: "POST", url: `/bff/questions/${question.id}/answers`, cookies: as("Sill"), payload: { body: "No sources.", refs: [], after: 1 } });
    expect([bad.statusCode, bad.json().code]).toEqual([400, "BAD_ANSWER"]);

    const listed = await app.inject({ method: "GET", url: "/bff/space/questions?item=lib-1&mine=1", cookies: as("Nikk2") });
    expect(listed.json()).toMatchObject({ space: SPACE, project, questions: [{ id: question.id, answer: { revision: 1, by: "Sill", refs: [source] } }] });
    expect(listed.json().next).toBeNull();
    const badCursor = await app.inject({ method: "GET", url: "/bff/space/questions?item=lib-1&cursor=nonsense", cookies: as("Nikk2") });
    expect([badCursor.statusCode, badCursor.json().code]).toEqual([400, "BAD_CURSOR"]);
    const one = await app.inject({ method: "GET", url: `/bff/questions/${question.id}`, cookies: as("Baiwei") });
    expect(one.json().question.answers).toHaveLength(1);

    // Closing the intake ends asking; the questions already asked stay on the board.
    const closed = await app.inject({ method: "DELETE", url: `/bff/board/projects/${project}/question-intake?space=${SPACE}`, cookies: as("Mica") });
    expect(closed.statusCode).toBe(200);
    expect((await ask("lib-1", key(4))).json().code).toBe("NO_INTAKE");
    expect((await app.inject({ method: "GET", url: `/bff/questions/${question.id}`, cookies: as("Nikk2") })).statusCode).toBe(200);
  });
});
