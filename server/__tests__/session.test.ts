import { describe, expect, it } from "vitest";
import { MemorySessionStore } from "../session.js";

const SECRET = "upstream-token-that-must-never-reach-the-browser";

describe("SessionStore", () => {
  it("never exposes the upstream token in the client-facing projection", () => {
    const store = new MemorySessionStore(60_000);
    const sid = store.create("nikk", SECRET);
    const session = store.get(sid)!;

    const view = store.publicView(session);

    // The invariant of the whole BFF: serialise the public view and the token
    // must not appear anywhere in it, under any key.
    expect(JSON.stringify(view)).not.toContain(SECRET);
    // The key list is asserted exactly, on purpose. It is an allow-list: a
    // field added to Session must be added here deliberately before it can
    // reach the browser, so the next field cannot ride along by accident.
    // "kind" was added this way — it is a label saying human or agent, and it
    // grants nothing.
    expect(Object.keys(view).sort()).toEqual(["kind", "username"]);
  });

  it("hands back an opaque session id, not the token", () => {
    const store = new MemorySessionStore(60_000);
    const sid = store.create("nikk", SECRET);

    expect(sid).not.toContain(SECRET);
    expect(sid.length).toBeGreaterThanOrEqual(32);
  });

  it("expires sessions and stops returning them", () => {
    const store = new MemorySessionStore(-1); // already expired
    const sid = store.create("nikk", SECRET);

    expect(store.get(sid)).toBeUndefined();
  });

  it("keeps the session id stable across a transparent token refresh", () => {
    const store = new MemorySessionStore(60_000);
    const sid = store.create("nikk", SECRET);

    store.refreshToken(sid, "a-newer-token");

    // The human's session survives an upstream token rotation; they are not
    // signed out just because the WebHarness token was replaced.
    expect(store.get(sid)?.token).toBe("a-newer-token");
    expect(store.get(sid)?.username).toBe("nikk");
  });

  it("forgets a destroyed session", () => {
    const store = new MemorySessionStore(60_000);
    const sid = store.create("nikk", SECRET);

    store.destroy(sid);

    expect(store.get(sid)).toBeUndefined();
  });
});
