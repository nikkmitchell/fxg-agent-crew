import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { ScreenFrames } from "../space/screens.js";
import { SCREEN_LIMITS, sniffImage } from "../../shared/screens.js";

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

/** The smallest thing that is, by signature, a WebP. */
const webp = (marker = 0) =>
  Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, marker, 1, 2, 3]);

const upload = (
  app: Awaited<ReturnType<typeof boot>>["app"],
  headers: Record<string, string>,
  body: Buffer,
  type = "image/webp",
) =>
  app.inject({ method: "PUT", url: "/bff/space/screens/frame", headers: { "content-type": type, ...headers }, payload: body });

describe("sharing a screen", () => {
  it("refuses an upload from nobody", async () => {
    const { app } = boot();
    const response = await upload(app, {}, webp());
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("lets a signed-in person share, and shows that frame to the room without caching", async () => {
    const { app, as } = boot();
    const sent = await upload(app, { cookie: as("nikk2") }, webp(7));
    expect(sent.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: as("Sill", "agent") } });
    expect(list.json().screens).toEqual([expect.objectContaining({ actorId: "nikk2", seq: sent.json().seq })]);

    const frame = await app.inject({ method: "GET", url: "/bff/space/screens/nikk2/frame", headers: { cookie: as("Sill", "agent") } });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers["content-type"]).toBe("image/webp");
    // Nikk named this directly: without it browsers "may happily give your XR
    // app the previous image".
    expect(frame.headers["cache-control"]).toBe("no-store");
    expect(Buffer.from(frame.rawPayload).equals(webp(7))).toBe(true);
    await app.close();
  });

  it("keeps one frame per person, overwritten, never an archive", async () => {
    const { app, as } = boot();
    const cookie = as("nikk2");
    const first = await upload(app, { cookie }, webp(1));
    const second = await upload(app, { cookie }, webp(2));
    expect(second.json().seq).toBeGreaterThan(first.json().seq);

    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie } });
    expect(list.json().screens).toHaveLength(1);
    const frame = await app.inject({ method: "GET", url: "/bff/space/screens/nikk2/frame", headers: { cookie } });
    expect(Buffer.from(frame.rawPayload).equals(webp(2))).toBe(true);
    await app.close();
  });

  it("decides what an image is by its bytes, not by what the header claims", async () => {
    // Every headset in the room decodes whatever is stored. Something labelled
    // WebP that is not an image is refused here, not served to all of them.
    const { app, as } = boot();
    const response = await upload(app, { cookie: as("nikk2") }, Buffer.from("<script>not an image</script>"));
    expect(response.statusCode).toBe(415);
    await app.close();
  });

  it("refuses a frame far larger than any real screen frame", async () => {
    const { app, as } = boot();
    const huge = Buffer.concat([webp(), Buffer.alloc(SCREEN_LIMITS.bytes + 1)]);
    const response = await upload(app, { cookie: as("nikk2") }, huge);
    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it("stops sharing on request", async () => {
    const { app, as } = boot();
    const cookie = as("nikk2");
    await upload(app, { cookie }, webp());
    await app.inject({ method: "DELETE", url: "/bff/space/screens/frame", headers: { cookie } });
    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie } });
    expect(list.json().screens).toEqual([]);
    await app.close();
  });

  it("does not show anybody's screen to somebody who is not signed in", async () => {
    const { app, as } = boot();
    await upload(app, { cookie: as("nikk2") }, webp());
    expect((await app.inject({ method: "GET", url: "/bff/space/screens" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/bff/space/screens/nikk2/frame" })).statusCode).toBe(401);
    await app.close();
  });
});

describe("share links for agents", () => {
  it("let an agent's browser share that agent's screen without signing in", async () => {
    // Nikk: "let the agent set this up for themselves, open the web browser
    // and set the address... and the user can just do an accept on the screen
    // permissions". An agent cannot use the password form, so it mints a key.
    const { app, as } = boot();
    const minted = await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: as("Sill", "agent") } });
    expect(minted.statusCode).toBe(200);
    const { key } = minted.json();

    const sent = await upload(app, { "x-screen-key": key }, webp());
    expect(sent.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: as("nikk2") } });
    expect(list.json().screens.map((s: { actorId: string }) => s.actorId)).toEqual(["Sill"]);
    await app.close();
  });

  it("cannot be minted by somebody who is not signed in", async () => {
    const { app } = boot();
    expect((await app.inject({ method: "POST", url: "/bff/space/screens/key" })).statusCode).toBe(401);
    await app.close();
  });

  it("stop working when a new one is made, so a lost link is fixed by making another", async () => {
    const { app, as } = boot();
    const cookie = as("Sill", "agent");
    const old = (await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie } })).json().key;
    await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie } });
    expect((await upload(app, { "x-screen-key": old }, webp())).statusCode).toBe(401);
    await app.close();
  });

  it("are not accepted in the query string, where they would end up in access logs", async () => {
    const { app, as } = boot();
    const key = (await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: as("Sill", "agent") } })).json().key;
    const response = await app.inject({
      method: "PUT",
      url: `/bff/space/screens/frame?key=${key}`,
      headers: { "content-type": "image/webp" },
      payload: webp(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("cannot see anybody's screen, only share their own", async () => {
    // A key's scope is upload-and-clear for one actor. Reading is a session's.
    const { app, as } = boot();
    await upload(app, { cookie: as("nikk2") }, webp());
    const key = (await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: as("Sill", "agent") } })).json().key;
    const peek = await app.inject({ method: "GET", url: "/bff/space/screens/nikk2/frame", headers: { "x-screen-key": key } });
    expect(peek.statusCode).toBe(401);
    await app.close();
  });
});

describe("the frame store", () => {
  it("stops showing a frame that has gone stale", () => {
    // A closed lid sends no stop. Without this, the last frame would hang in
    // the room indefinitely, claiming to be somebody's screen.
    const clock = { now: 0 };
    const frames = new ScreenFrames(() => clock.now);
    frames.put("nikk2", webp(), "image/webp");
    expect(frames.list()).toHaveLength(1);
    clock.now = SCREEN_LIMITS.staleMs + 1;
    expect(frames.list()).toEqual([]);
    expect(frames.get("nikk2")).toBeUndefined();
  });

  it("treats two spellings of one person as one screen", () => {
    const frames = new ScreenFrames(() => 0);
    frames.put("Nikk2", webp(1), "image/webp");
    frames.put("nikk2", webp(2), "image/webp");
    expect(frames.list()).toHaveLength(1);
  });
});

describe("recognising an image", () => {
  it("knows the three formats a frame may be, and nothing else", () => {
    expect(sniffImage(webp())).toBe("image/webp");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImage(Buffer.from(""))).toBeNull();
  });
});
