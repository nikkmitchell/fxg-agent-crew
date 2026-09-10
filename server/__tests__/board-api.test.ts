import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

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

  it("returns an illegal move as 409 with the reason intact", async () => {
    const { app, as } = boot();
    const h = { cookie: as("nikk") };
    await app.inject({ method: "POST", url: "/bff/board/projects", headers: h, payload: { id: "saha", name: "Saha" } });
    const id = (await app.inject({ method: "POST", url: "/bff/board/tasks", headers: h,
      payload: { projectId: "saha", title: "A card" } })).json().result;

    const response = await app.inject({ method: "POST", url: `/bff/board/tasks/${id}/status`, headers: h,
      payload: { to: "done" } });

    expect(response.statusCode).toBe(409);
    // The refusal is a sentence written for a person; a bare 409 would throw
    // away the only part that says what to do next.
    expect(response.json().error).toMatch(/backlog → done is not a legal move/);
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
