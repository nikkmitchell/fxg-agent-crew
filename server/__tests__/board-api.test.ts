import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { STATIONS } from "../../shared/space-layout.js";

/**
 * The API over saha.ing's own database.
 *
 * Every write goes through BoardStore, so these tests are about the seam: that
 * a refusal reaches the browser with its reason intact, that the right status
 * code comes back, and that no route quietly reimplements a rule.
 */

const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
  });
  const as = (username: string, kind: "human" | "agent" = "human") =>
    `${built.config.cookieName}=${built.sessions.create(username, "upstream-token", kind)}`;
  return { ...built, as };
};

const png = () => {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  return bytes;
};

describe("the session boundary", () => {
  it("refuses every write without one", async () => {
    const { app } = boot();
    for (const [method, url] of [
      ["POST", "/bff/board/projects"],
      ["POST", "/bff/board/tasks"],
      ["PUT", "/bff/board/profile"],
      ["POST", "/bff/board/blobs"],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json().code).toBe("SESSION_EXPIRED");
    }
    await app.close();
  });

  it("refuses every read without one", async () => {
    const { app } = boot();
    for (const url of ["/bff/board/projects", "/bff/board/people", "/bff/board/projects/x"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    await app.close();
  });
});

describe("reading with a room destination", () => {
  it("walks an authenticated agent to the surface it explicitly reads", async () => {
    const { app, as, space } = boot();
    const headers = { cookie: as("Inkstone", "agent") };
    await app.inject({
      method: "POST",
      url: "/bff/board/projects",
      headers,
      payload: { id: "saha", name: "Saha" },
    });

    const tasks = await app.inject({
      method: "GET",
      url: "/bff/board/projects/saha?view=tasks",
      headers,
    });
    expect(tasks.statusCode).toBe(200);
    expect(space.presence.find("Inkstone")?.heading).toEqual(STATIONS.taskBoard.stand);
    expect(space.presence.find("Inkstone")?.because).toBe("was checking tasks");

    const mood = await app.inject({
      method: "GET",
      url: "/bff/board/projects/saha?view=mood",
      headers,
    });
    expect(mood.statusCode).toBe(200);
    expect(space.presence.find("Inkstone")?.heading).toEqual(STATIONS.moodBoard.stand);
    expect(space.presence.find("Inkstone")?.because).toBe("was considering the mood board");
    await app.close();
  });

  it("refuses an unknown view instead of turning it into a destination", async () => {
    const { app, as, space } = boot();
    const headers = { cookie: as("Inkstone", "agent") };
    const response = await app.inject({
      method: "GET",
      url: "/bff/board/projects/saha?view=somewhere",
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(space.presence.find("Inkstone")).toBeUndefined();
    await app.close();
  });
});

describe("a card, end to end", () => {
  it("creates, briefs, moves and comments — with no 2000-character wall anywhere", async () => {
    const { app, as } = boot();
    const cookie = as("nikk");
    const h = { cookie };

    const project = await app.inject({ method: "POST", url: "/bff/board/projects", headers: h,
      payload: { id: "saha", name: "Saha", goals: ["ship it"] } });
    expect(project.statusCode).toBe(200);

    const task = await app.inject({ method: "POST", url: "/bff/board/tasks", headers: h,
      payload: { projectId: "saha", title: "A card" } });
    const id = task.json().result as string;

    // The brief that could not be saved under the old design.
    const long = "x".repeat(20_000);
    expect((await app.inject({ method: "PATCH", url: `/bff/board/tasks/${id}`, headers: h,
      payload: { description: long } })).statusCode).toBe(200);

    await app.inject({ method: "POST", url: `/bff/board/tasks/${id}/comments`, headers: h, payload: { body: "hello" } });
    await app.inject({ method: "POST", url: `/bff/board/tasks/${id}/status`, headers: h, payload: { to: "assigned" } });

    const view = (await app.inject({ method: "GET", url: "/bff/board/projects/saha", headers: h })).json();
    expect(view.tasks[0].description).toHaveLength(20_000);
    expect(view.tasks[0].comments).toHaveLength(1);
    expect(view.tasks[0].status).toBe("assigned");
    await app.close();
  });

  it("moves a card from any column to any other, backlog straight to done included", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const id = (await app.inject({ method: "POST", url: "/bff/board/tasks", headers: h,
      payload: { projectId: "saha", title: "A card" } })).json().result;

    const response = await app.inject({ method: "POST", url: `/bff/board/tasks/${id}/status`, headers: h,
      payload: { to: "done" } });

    // Nikk (4936): "allow cards to be moved freely from any tab to any tab".
    expect(response.statusCode).toBeLessThan(300);
    await app.close();
  });

  it("refuses a non-member with 403 and tells them it is a request", async () => {
    const { app, as } = boot();
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: { cookie: as("nikk") },
      payload: { id: "saha", name: "Saha" } });

    const response = await app.inject({ method: "POST", url: "/bff/board/tasks",
      headers: { cookie: as("stranger") }, payload: { projectId: "saha", title: "nope" } });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/not a member of saha/);
    await app.close();
  });

  it("still refuses an agent whose owner is a manager", async () => {
    // The rule, asserted at the HTTP boundary rather than only in the store.
    const { app, as } = boot();
    const owner = { cookie: as("nikk") };
    const agent = { cookie: as("claude-nikk2mbp", "agent") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: owner, payload: { id: "saha", name: "Saha" } });
    await app.inject({ method: "POST", url: "/bff/board/ownership", headers: owner,
      payload: { agentId: "claude-nikk2mbp", ownerId: "nikk", action: "declare" } });
    await app.inject({ method: "POST", url: "/bff/board/ownership", headers: agent,
      payload: { agentId: "claude-nikk2mbp", ownerId: "nikk", action: "confirm" } });

    const response = await app.inject({ method: "POST", url: "/bff/board/tasks", headers: agent,
      payload: { projectId: "saha", title: "by proxy" } });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("mood boards", () => {
  it("uploads an image and puts it on a board", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const boardId = (await app.inject({ method: "POST", url: "/bff/board/boards", headers: h,
      payload: { projectId: "saha", name: "Mood" } })).json().result;

    const upload = await app.inject({ method: "POST", url: "/bff/board/blobs",
      headers: { ...h, "content-type": "image/png", "x-filename": "ref.png" }, payload: png() });
    expect(upload.statusCode).toBe(200);
    const blob = upload.json().result;
    expect([blob.width, blob.height]).toEqual([800, 600]);

    await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "image", blobId: blob.id, caption: "the mood" } });

    const view = (await app.inject({ method: "GET", url: "/bff/board/projects/saha", headers: h })).json();
    expect(view.boards[0].items[0].caption).toBe("the mood");
    expect(view.boards[0].items[0].blob_id).toBe(blob.id);
    await app.close();
  });

  it("serves the bytes back, cacheable and unable to run", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    const blob = (await app.inject({ method: "POST", url: "/bff/board/blobs",
      headers: { ...h, "content-type": "image/png" }, payload: png() })).json().result;

    const response = await app.inject({ method: "GET", url: `/bff/board/blobs/${blob.id}`, headers: h });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    // Content-addressed, so the bytes at this id can never change.
    expect(response.headers["cache-control"]).toContain("immutable");
    // Belt and braces for anything that slipped past the sniffer.
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    await app.close();
  });

  it("refuses an SVG with an answer rather than a code", async () => {
    const { app, as } = boot();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const response = await app.inject({ method: "POST", url: "/bff/board/blobs",
      headers: { cookie: as("nikk"), "content-type": "image/svg+xml" }, payload: svg });

    expect(response.statusCode).toBe(415);
    expect(response.json().error).toMatch(/Export it as PNG/);
    await app.close();
  });

  it("will not put a javascript: link on a board", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const boardId = (await app.inject({ method: "POST", url: "/bff/board/boards", headers: h,
      payload: { projectId: "saha", name: "Mood" } })).json().result;

    const response = await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "link", url: "javascript:fetch('/bff/me')" } });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe("history", () => {
  it("can say who moved a card", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const id = (await app.inject({ method: "POST", url: "/bff/board/tasks", headers: h,
      payload: { projectId: "saha", title: "A card" } })).json().result;
    await app.inject({ method: "POST", url: `/bff/board/tasks/${id}/status`, headers: h, payload: { to: "assigned" } });

    const { history } = (await app.inject({ method: "GET", url: `/bff/board/history/task/${id}`, headers: h })).json();

    expect(history[0]).toMatchObject({ actor_id: "nikk", action: "transition" });
    await app.close();
  });
});

describe("what was asked, not only what changed", () => {
  it("records the request envelope beside the diff", async () => {
    // Raised by Inkstone: moving writes off signed chat events gives up
    // verifiable authorship. We cannot verify a signature yet — that needs the
    // agent's public key and WebHarness exposes none — so the envelope is the
    // honest half we CAN keep: the exact request, which is what a signature
    // would later attach to.
    const { app, as, database } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const id = (await app.inject({ method: "POST", url: "/bff/board/tasks", headers: h,
      payload: { projectId: "saha", title: "A card" } })).json().result;
    await app.inject({ method: "POST", url: `/bff/board/tasks/${id}/status`, headers: h, payload: { to: "assigned" } });

    const row = database.prepare(
      "SELECT request, signature, signed_by FROM audit WHERE action='transition' ORDER BY id DESC LIMIT 1",
    ).get() as { request: string; signature: null; signed_by: null };

    expect(JSON.parse(row.request)).toEqual({
      method: "POST", path: `/bff/board/tasks/${id}/status`, body: { to: "assigned" },
    });
    // Empty on purpose. A populated signature column that nothing verifies
    // would be a stronger claim than the truth supports.
    expect(row.signature).toBeNull();
    expect(row.signed_by).toBeNull();
    await app.close();
  });

  it("records a denial with the actor and the reason", async () => {
    const { app, as, database } = boot();
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: { cookie: as("nikk") },
      payload: { id: "saha", name: "Saha" } });

    await app.inject({ method: "POST", url: "/bff/board/tasks", headers: { cookie: as("stranger") },
      payload: { projectId: "saha", title: "nope" } });

    expect(database.prepare("SELECT actor_id, code FROM security_audit").get())
      .toEqual({ actor_id: "stranger", code: "PROJECT_PERMISSION_REQUIRED" });
    await app.close();
  });

  it("refuses a brief that is a denial-of-service, with the numbers", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const id = (await app.inject({ method: "POST", url: "/bff/board/tasks", headers: h,
      payload: { projectId: "saha", title: "A card" } })).json().result;

    const response = await app.inject({ method: "PATCH", url: `/bff/board/tasks/${id}`, headers: h,
      payload: { description: "x".repeat(200_000) } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/200,000 characters; the limit is 100,000/);
    await app.close();
  });
});

/**
 * THE RESPONSE TELLS YOU WHAT YOU LANDED ON.
 *
 * The store computes it (see board-store.test.ts); this is the seam — that it
 * actually reaches the caller, since the whole point is closing a feedback loop
 * for agents who cannot see the board. A correct calculation nobody receives
 * would fix nothing.
 */
describe("being told what a mood-board item covers", () => {
  const setUp = async (app: ReturnType<typeof boot>["app"], h: { cookie: string }) => {
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    return (await app.inject({ method: "POST", url: "/bff/board/boards", headers: h,
      payload: { projectId: "saha", name: "Mood" } })).json().result as string;
  };

  it("comes back on the add, naming the item and how much is hidden", async () => {
    const { app, as } = boot();
    const h = { cookie: as("Sill", "agent") };
    const boardId = await setUp(app, h);

    await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "CARRY THE LIGHT CAREFULLY", x: 100, y: 100, w: 240, h: 240 } });
    const second = await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "Lantern Chorus", x: 100, y: 100, w: 240, h: 240 } });

    expect(second.statusCode, "reported, not refused — a collage may overlap on purpose").toBe(200);
    const body = second.json();
    expect(body.result, "the id is still where it was, for board-client.ts").toEqual(expect.any(String));
    expect(body.covers).toHaveLength(1);
    expect(body.covers[0].item).toContain("CARRY THE LIGHT CAREFULLY");
    expect([body.covers[0].wide, body.covers[0].tall]).toEqual([240, 240]);
    expect(body.coveredBy, "nothing is on top of a brand new item").toEqual([]);
    await app.close();
  });

  it("comes back empty when the new item is clear of everything", async () => {
    const { app, as } = boot();
    const h = { cookie: as("Sill", "agent") };
    const boardId = await setUp(app, h);
    const only = await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "alone", x: 0, y: 0, w: 100, h: 100 } });
    expect(only.json().covers).toEqual([]);
    expect(only.json().coveredBy).toEqual([]);
    await app.close();
  });

  it("comes back on a MOVE too, so tidying cannot land on a second neighbour", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    const boardId = await setUp(app, h);
    await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "NEIGHBOUR", x: 500, y: 0, w: 200, h: 200 } });
    const moving = (await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "wanderer", x: 0, y: 0, w: 200, h: 200 } })).json().result;

    // Nudged off nothing and straight onto the neighbour — the exact way a
    // manual tidy-up creates the next overlap.
    const moved = await app.inject({ method: "PATCH", url: `/bff/board/items/${moving}`, headers: h,
      payload: { x: 550, y: 0 } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().covers).toHaveLength(1);
    expect(moved.json().covers[0].item).toContain("NEIGHBOUR");
    await app.close();
  });

  /**
   * The reply must also say when a move slid the item UNDER something.
   *
   * I shipped this without `coveredBy` and then used it to tidy the live board:
   * two buried items were moved out from under their coverers, the reply said
   * clear both times, and both had landed on the identical coordinates of a
   * DIFFERENT item. A downward-only check cannot see that, so the tidy-up I
   * reported as verified had moved two items from under one thing to under
   * another.
   */
  it("says when a move has slid the item under a different one", async () => {
    const { app, as } = boot();
    const h = { cookie: as("Sill", "agent") };
    const boardId = await setUp(app, h);
    const mover = (await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "mover", x: 0, y: 0, w: 240, h: 240 } })).json().result;
    // Added after the mover, so it sits above it by z.
    await app.inject({ method: "POST", url: `/bff/board/boards/${boardId}/items`, headers: h,
      payload: { kind: "note", text: "LANDS ON TOP", x: 600, y: 0, w: 240, h: 240 } });

    const moved = await app.inject({ method: "PATCH", url: `/bff/board/items/${mover}`, headers: h,
      payload: { x: 600, y: 0 } });

    expect(moved.statusCode).toBe(200);
    const reply = moved.json();
    expect(reply.coveredBy.length, "something is on top of it and the reply says so")
      .toBeGreaterThan(0);
    expect(reply.coveredBy[0].item).toContain("LANDS ON TOP");
    await app.close();
  });
});
