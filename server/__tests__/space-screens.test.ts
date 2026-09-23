import { testBlobRoot } from "./test-roots.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { openDatabase } from "../db/open.js";
import { ScreenFrames, ShareKeys } from "../space/screens.js";
import { SCREEN_LIMITS, sniffImage } from "../../shared/screens.js";

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

describe("who can be shared for", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers a new agent from the moment it signs in, before it has touched the board", async () => {
    // KANxD tried to share a screen for Vint, who had joined the room and done
    // nothing on the board yet, and Vint was not in the menu.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ id: 99, username: "Vint", kind: "agent", ownerName: "KANxD" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })));
    const { app, as } = boot();
    const signedIn = await app.inject({ method: "POST", url: "/bff/agent-session", payload: { token: "vint-token" } });
    expect(signedIn.statusCode).toBe(200);

    const sharers = await app.inject({ method: "GET", url: "/bff/space/screens/sharers", headers: { cookie: as("KANxD") } });
    expect(sharers.json().agents).toContain("Vint");
    await app.close();
  });

  it("does not offer a person, whatever door they came in by", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ id: 7, username: "KANxD", kind: "human" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })));
    const { app, as } = boot();
    await app.inject({ method: "POST", url: "/bff/agent-session", payload: { token: "person-token" } });
    const sharers = await app.inject({ method: "GET", url: "/bff/space/screens/sharers", headers: { cookie: as("Nikk2") } });
    expect(sharers.json().agents).not.toContain("KANxD");
    await app.close();
  });
});

describe("how long a share link lasts", () => {
  const keysAt = () => {
    let clock = Date.parse("2026-09-14T09:00:00Z");
    const keys = new ShareKeys(openDatabase(":memory:", DatabaseSync), () => clock);
    return { keys, advance: (ms: number) => (clock += ms) };
  };
  const HOUR = 60 * 60 * 1000;

  it("keeps working past twelve hours while it is still sending pictures", () => {
    // Sill's screen went dark overnight with its share page still open.
    const { keys, advance } = keysAt();
    const { key } = keys.mint("Sill");
    for (let hour = 0; hour < 20; hour += 1) {
      advance(HOUR);
      expect(keys.resolve(key), `hour ${hour + 1}`).not.toBeNull();
      keys.renew(key);
    }
  });

  it("still stops twelve hours after the last picture", () => {
    const { keys, advance } = keysAt();
    const { key } = keys.mint("Sill");
    advance(3 * HOUR);
    keys.renew(key);
    advance(SCREEN_LIMITS.keyTtlMs + 1);
    expect(keys.resolve(key)).toBeNull();
  });

  it("cannot bring an expired or revoked link back to life", () => {
    const { keys, advance } = keysAt();
    const { key: old } = keys.mint("Sill");
    advance(SCREEN_LIMITS.keyTtlMs + 1);
    keys.renew(old);
    expect(keys.resolve(old)).toBeNull();

    const { key: revoked } = keys.mint("Inkstone");
    keys.mint("Inkstone");
    keys.renew(revoked);
    expect(keys.resolve(revoked)).toBeNull();
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

describe("sharing a screen for an agent", () => {
  /** Actor rows are what say who is an agent; the test database starts empty. */
  const seed = (database: { prepare(sql: string): { run(...args: unknown[]): unknown } }, id: string, kind: "human" | "agent") =>
    database.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run(id, kind, "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z");

  it("lets a signed-in person share for an agent, and labels it with both names", async () => {
    // Nikk: "you can open it and set which agent it is sharing for".
    const { app, as, database } = boot();
    seed(database, "Sill", "agent");
    const nikk = as("Nikk2");
    const minted = await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: nikk }, payload: { for: "sill" } });
    expect(minted.statusCode).toBe(200);
    expect(minted.json().for, "spelled as the actors table spells it").toBe("Sill");

    await upload(app, { "x-screen-key": minted.json().key }, webp());
    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: nikk } });
    // The room must never claim Sill shared this: it says who did.
    expect(list.json().screens).toEqual([expect.objectContaining({ actorId: "Sill", sharedBy: "Nikk2" })]);
    await app.close();
  });

  it("records nobody else when you share your own screen", async () => {
    const { app, as } = boot();
    await upload(app, { cookie: as("Nikk2") }, webp());
    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: as("Nikk2") } });
    expect(list.json().screens[0].sharedBy).toBeNull();
    await app.close();
  });

  it("does NOT let anyone share under another PERSON's name", async () => {
    // A label saying who shared it does not make a screen under a human's name
    // acceptable — that is impersonation whatever the small print says.
    const { app, as, database } = boot();
    seed(database, "baiwei2", "human");
    const response = await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: as("Nikk2") }, payload: { for: "baiwei2" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/not an agent/);
    await app.close();
  });

  it("refuses a name nobody has ever been", async () => {
    const { app, as } = boot();
    const response = await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: as("Nikk2") }, payload: { for: "nobody-at-all" } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("says which screens belong to agents, so an agent's screen never drops into the row above everybody", async () => {
    // Nikk: an agent's screen should not "just float super high up above us".
    // The room places an agent's screen at the agent, and must know it is an
    // agent's even while that agent is not standing in the room.
    const { app, as, database } = boot();
    seed(database, "Sill", "agent");
    seed(database, "Nikk2", "human");
    const key = (await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: as("Nikk2") }, payload: { for: "Sill" } })).json().key;
    await upload(app, { "x-screen-key": key }, webp(1));
    await upload(app, { cookie: as("Nikk2") }, webp(2));
    const list = await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: as("Nikk2") } });
    const kinds = Object.fromEntries(list.json().screens.map((s: { actorId: string; kind: string | null }) => [s.actorId, s.kind]));
    expect(kinds).toEqual({ Sill: "agent", Nikk2: "human" });
    await app.close();
  });

  it("offers every agent in the share-as menu, and not yourself twice", async () => {
    const { app, as, database } = boot();
    seed(database, "Sill", "agent");
    seed(database, "Inkstone", "agent");
    seed(database, "Nikk2", "human");
    const response = await app.inject({ method: "GET", url: "/bff/space/screens/sharers", headers: { cookie: as("Inkstone", "agent") } });
    expect(response.json()).toEqual({ you: "Inkstone", agents: ["Sill"] });
    await app.close();
  });
});
