import { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { BoardReads } from "../db/reads.js";
import { BoardStore } from "../db/store.js";
import { registerReviewRoutes } from "../routes/reviews.js";
import { SpaceStore, type StoredDeploy } from "../spaces/store.js";
import { MemorySessionStore } from "../session.js";
import { testConfig } from "./test-config.js";

/** Review rounds (Review Studio, Mica 7347/7350/7368; Skein 7352): exact versions, the board's own taking, findings on the space. */

const deploy = (id: string, space = "open.library", status: StoredDeploy["status"] = "ready", pieces = ["library"]): StoredDeploy => ({
  id, space, branch: "main", commit: "abc", message: "m", author: "Mica", pushedBy: "Mica", createdAt: new Date().toISOString(),
  status, problem: null, files: 1, bytes: 1, spa: false, pieces: pieces.map((piece) => ({ id: piece, name: piece, item: `things/${piece}.js` })) as never,
});

function boot() {
  const config = testConfig();
  const sessions = new MemorySessionStore(60_000);
  const db = openDatabase(":memory:", DatabaseSync);
  const spaces = new SpaceStore(db);
  spaces.create("open.library", "Mica", new Date().toISOString());
  for (const d of [deploy("cand-1"), deploy("base-1"), deploy("broken", "open.library", "failed"), deploy("other", "xr.instruments"), deploy("nolib", "open.library", "ready", ["grove"])]) spaces.record(d);
  const board = new BoardStore(db);
  const project = board.createRoomProject({ id: "Mica", kind: "agent" }, "open-source-library");
  board.actOnMembership({ id: "Mica", kind: "agent" }, project, "Sill", "grant", ["engineering"]);
  board.enrolFromRoom("Wanderer", "open-source-library", "human");
  const app = Fastify();
  app.register(cookie);
  registerReviewRoutes(app, { config, sessions, db, spaces });
  const as = (username: string) => ({ [config.cookieName]: sessions.create(username, "t") });
  const round = { project, space: "open.library", entry: "library", mode: "full", candidate: "cand-1", baseline: "base-1", checklist: ["Books open in the selecting hand", "Plant clears the shelf"], title: "Library books" };
  return { app, as, project, round, reads: new BoardReads(db), board, spaces };
}

describe("review rounds", () => {
  it("publishes a round on the candidate's board, taking a role, and pins both exact deploys", async () => {
    const { app, as, round, reads } = boot();
    const refused = await app.inject({ method: "POST", url: "/bff/reviews", cookies: as("Wanderer"), payload: round });
    expect([refused.statusCode, refused.json().code]).toEqual([403, "ROLE_REQUIRED"]);
    const made = await app.inject({ method: "POST", url: "/bff/reviews", cookies: as("Sill"), payload: round });
    expect(made.statusCode).toBe(201);
    expect(made.json().round).toMatchObject({
      title: "Library books", space: "open.library", entry: "library", mode: "full",
      candidate: { deploy: "cand-1" }, baseline: { deploy: "base-1" }, checklist: round.checklist,
      card: { status: "backlog", owners: [] }, findings: 0, by: "Sill",
    });
    expect(reads.reviewDeploys().sort()).toEqual(["base-1", "cand-1"]);
  });

  it("refuses any target that is not an exact, ready deploy of that space with that thing in it: no branch-live fallback", async () => {
    const { app, as, round } = boot();
    for (const [change, says] of [
      [{ candidate: "nope" }, /no deploy nope/],
      [{ candidate: "other" }, /no deploy other/],
      [{ candidate: "broken" }, /failed, not ready/],
      [{ candidate: "nolib" }, /does not list library/],
      [{ baseline: "cand-1" }, /same deploy/],
    ] as const) {
      const answer = await app.inject({ method: "POST", url: "/bff/reviews", cookies: as("Sill"), payload: { ...round, ...change } });
      expect(answer.statusCode, JSON.stringify(change)).toBeGreaterThanOrEqual(400);
      expect(answer.json().error).toMatch(says);
    }
  });

  it("files a finding at the exact deploy reviewed, once per panel, and lists them a page at a time", async () => {
    const { app, as, round } = boot();
    const { round: made } = (await app.inject({ method: "POST", url: "/bff/reviews", cookies: as("Sill"), payload: round })).json();
    const find = (variant: string, text: string, requestKey: string, who = "Nikk2") =>
      app.inject({ method: "POST", url: `/bff/reviews/${made.id}/findings`, cookies: as(who), payload: { variant, text, requestKey } });
    const first = (await find("candidate", "The book opens in my left hand.", "panel-key-0001")).json();
    expect(first).toMatchObject({ existing: false, finding: { variant: "candidate", deploy: "cand-1", by: "Nikk2", text: "The book opens in my left hand." } });
    expect((await find("candidate", "The book opens in my left hand.", "panel-key-0001")).json()).toMatchObject({ existing: true, finding: { id: first.finding.id } });
    expect((await find("baseline", "The old shelf clips the plant.", "panel-key-0002")).json().finding).toMatchObject({ variant: "baseline", deploy: "base-1" });
    expect((await find("sideways", "Hm?", "panel-key-0003")).statusCode).toBe(400);
    const page1 = (await app.inject({ method: "GET", url: `/bff/reviews/${made.id}/findings?limit=1`, cookies: as("Baiwei") })).json();
    expect(page1.findings).toHaveLength(1);
    const page2 = (await app.inject({ method: "GET", url: `/bff/reviews/${made.id}/findings?limit=1&cursor=${encodeURIComponent(page1.next)}`, cookies: as("Baiwei") })).json();
    expect(page2.findings).toHaveLength(1);
    expect(page2.findings[0].id).not.toBe(page1.findings[0].id);
    expect(page2.next).toBeNull();
    const listed = (await app.inject({ method: "GET", url: "/bff/reviews", cookies: as("Baiwei") })).json();
    expect(listed.rounds[0]).toMatchObject({ id: made.id, findings: 2 });
  });

  it("closes with its card: a done round takes no more findings, leaves the open list and releases its deploys", async () => {
    const { app, as, round, reads, board } = boot();
    const { round: made } = (await app.inject({ method: "POST", url: "/bff/reviews", cookies: as("Sill"), payload: round })).json();
    board.transitionTask({ id: "Mica", kind: "agent" }, made.id, "done");
    const late = await app.inject({ method: "POST", url: `/bff/reviews/${made.id}/findings`, cookies: as("Nikk2"), payload: { variant: "candidate", text: "Too late?", requestKey: "panel-key-0009" } });
    expect([late.statusCode, late.json().code]).toEqual([409, "ROUND_CLOSED"]);
    expect((await app.inject({ method: "GET", url: "/bff/reviews", cookies: as("Nikk2") })).json().rounds).toEqual([]);
    expect(reads.reviewDeploys()).toEqual([]);
  });

  it("is one round per publish form however often it is sent, and takes no finding once its version is gone (Mica 7405)", async () => {
    const { app, as, round, spaces } = boot();
    const publish = () => app.inject({ method: "POST", url: "/bff/reviews", cookies: as("Sill"), payload: { ...round, requestKey: "publish-key-01" } });
    const first = await publish();
    const again = await publish();
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.json()).toMatchObject({ existing: true, round: { id: first.json().round.id } });
    expect((await app.inject({ method: "GET", url: "/bff/reviews", cookies: as("Nikk2") })).json().rounds).toHaveLength(1);
    spaces.retire("cand-1");
    const late = await app.inject({ method: "POST", url: `/bff/reviews/${first.json().round.id}/findings`, cookies: as("Nikk2"), payload: { variant: "candidate", text: "Is it still there?", requestKey: "panel-key-0101" } });
    expect([late.statusCode, late.json().code]).toEqual([409, "NO_DEPLOY"]);
  });
});
