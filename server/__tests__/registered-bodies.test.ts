import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { REGISTERED_PER_MAKER } from "../space/registered-bodies.js";
import { tempDir } from "./test-config.js";

/**
 * Registering a body without a release (Baiwei, 7060: "are you needed each time to register new models?").
 */
const boot = () => {
  const root = tempDir("bodies-");
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: tempDir("blobs-"),
    BODY_CACHE_ROOT: root,
    LOG_LEVEL: "silent",
  });
  const as = (username: string, kind: "human" | "agent" = "agent") =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", kind)}`;
  return { ...built, as, root };
};

// A real body that passes the platform check, and a small real PNG.
const vrm = readFileSync(new URL("../../public/avatars/sill.vrm", import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEUlEQVR4nGP4z8DwH4wZ0BgAsMgO8eOGqPYAAAAASUVORK5CYII=",
  "base64",
);

const upload = (app: ReturnType<typeof boot>["app"], cookie: string, name: string, body: Buffer) =>
  app.inject({
    method: "PUT",
    url: `/bff/space/registered/${encodeURIComponent(name)}`,
    headers: { cookie, "content-type": "application/octet-stream" },
    payload: body,
  });

describe("registering a body through the room", () => {
  it("checks it, stores it, lists it in the wardrobe, and lets its maker wear it at once", async () => {
    const { app, as, root } = boot();
    const corvid = as("Corvid");
    const made = await upload(app, corvid, "Lantern Keeper", vrm);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      ok: true,
      replaced: false,
      body: { key: "lanternkeeper", name: "Lantern Keeper", owner: "Corvid", vrmVersion: 1, thumbnail: null },
      contract: { met: true },
    });
    expect(made.json().next.join(" ")).toMatch(/thumbnail/);
    expect(existsSync(join(root, "lanternkeeper.vrm"))).toBe(true);

    const wardrobe = (await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie: corvid } })).json();
    expect(wardrobe.ready).toContain("lanternkeeper");
    expect(wardrobe.registered.map((b: { name: string }) => b.name)).toEqual(["Lantern Keeper"]);

    const worn = await app.inject({ method: "PUT", url: "/bff/space/body", headers: { cookie: corvid }, payload: { body: "Lantern Keeper" } });
    expect(worn.json()).toMatchObject({ ok: true, body: "lanternkeeper" });
    // Served by the route that already serves catalogue bodies.
    const file = await app.inject({ method: "GET", url: "/bff/space/body-model/lanternkeeper.vrm", headers: { cookie: corvid } });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(vrm)).toBe(true);
    await app.close();
  });

  it("refuses a file the platform check refuses, and says why", async () => {
    const { app, as } = boot();
    const refused = await upload(app, as("Corvid"), "Pebble", Buffer.from("not a model at all, just words"));
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: "NOT_REGISTERED" });
    expect(refused.json().errors.join(" ")).toMatch(/GLB/);
    await app.close();
  });

  it("will not take a name that belongs to a shipped body, a catalogue body or somebody else's registration", async () => {
    const { app, as } = boot();
    expect((await upload(app, as("Corvid"), "Mica", vrm)).statusCode).toBe(409);
    expect((await upload(app, as("Corvid"), "AbissalDude", vrm)).statusCode).toBe(409);
    expect((await upload(app, as("Corvid"), "Heron", vrm)).statusCode).toBe(201);
    const taken = await upload(app, as("Lumenfold"), "heron", vrm);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatch(/registered by Corvid/);
    await app.close();
  });

  it("lets a maker replace their own, keeping the last file for rollback, and caps how many they hold", async () => {
    const { app, as, root } = boot();
    const corvid = as("Corvid");
    expect((await upload(app, corvid, "Heron", vrm)).statusCode).toBe(201);
    const again = await upload(app, corvid, "Heron", vrm);
    expect(again.statusCode).toBe(200);
    expect(again.json().replaced).toBe(true);
    expect(existsSync(join(root, "heron.prev.vrm"))).toBe(true);
    // The kept file is not a body of its own.
    const wardrobe = (await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie: corvid } })).json();
    expect(wardrobe.ready).not.toContain("heron.prev");
    for (let i = 1; i < REGISTERED_PER_MAKER; i += 1) expect((await upload(app, corvid, `Heron${i}`, vrm)).statusCode).toBe(201);
    const over = await upload(app, corvid, "OneTooMany", vrm);
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toMatch(/already/);
    await app.close();
  });

  it("takes a picture from its maker only, and serves it to the wardrobe", async () => {
    const { app, as } = boot();
    const corvid = as("Corvid");
    await upload(app, corvid, "Heron", vrm);
    const put = (cookie: string, body: Buffer, type: string) =>
      app.inject({ method: "PUT", url: "/bff/space/registered/Heron/thumbnail", headers: { cookie, "content-type": type }, payload: body });
    expect((await put(as("Lumenfold"), png, "image/png")).statusCode).toBe(403);
    expect((await put(corvid, Buffer.from("<svg/>"), "application/octet-stream")).statusCode).toBe(400);
    const ok = await put(corvid, png, "image/png");
    expect(ok.json()).toEqual({ ok: true, thumbnail: "/bff/space/registered/heron/thumbnail" });
    const picture = await app.inject({ method: "GET", url: "/bff/space/registered/heron/thumbnail", headers: { cookie: corvid } });
    expect(picture.statusCode).toBe(200);
    expect(picture.headers["content-type"]).toBe("image/png");
    const listed = (await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie: corvid } })).json();
    expect(listed.registered[0].thumbnail).toBe("/bff/space/registered/heron/thumbnail");
    await app.close();
  });

  it("can be removed by its maker or by a person, but not by another agent", async () => {
    const { app, as, root } = boot();
    await upload(app, as("Corvid"), "Heron", vrm);
    const remove = (cookie: string) => app.inject({ method: "DELETE", url: "/bff/space/registered/Heron", headers: { cookie } });
    expect((await remove(as("Lumenfold"))).statusCode).toBe(403);
    expect((await remove(as("Nikk2", "human"))).json()).toEqual({ ok: true, removed: "Heron" });
    expect(existsSync(join(root, "heron.vrm"))).toBe(false);
    const gone = await app.inject({ method: "PUT", url: "/bff/space/body", headers: { cookie: as("Corvid") }, payload: { body: "Heron" } });
    expect(gone.json()).toMatchObject({ code: "NO_SUCH_BODY" });
    await app.close();
  });

  it("needs a session", async () => {
    const { app } = boot();
    const anonymous = await app.inject({ method: "PUT", url: "/bff/space/registered/Heron", headers: { "content-type": "application/octet-stream" }, payload: vrm });
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });
});
