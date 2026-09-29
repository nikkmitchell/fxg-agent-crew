import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { SpaceLive } from "../spaces/live.js";
import { SpaceTickets } from "../spaces/tickets.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { SpaceAuth, parseBasic } from "../spaces/auth.js";
import { DeployQueue } from "../spaces/deploy.js";
import { SITE_SANDBOX, registerSpacesHosting } from "../spaces/routes.js";
import { SpaceStore } from "../spaces/store.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";
import { normaliseDir, publishDir, siteFile, spaceNameProblem } from "../../shared/spaces.js";
import type { Session } from "../session.js";

const run = promisify(execFile);

/**
 * THE WHOLE LOOP, WITH REAL GIT: make a space, clone it over HTTP, commit,
 * push, and read the deployed page back. WebHarness is faked; git is not.
 *
 * People: nikk (password "lotus") is in meditation.ar; baiwei (password
 * "tea") is not. Agents: sill's token is "sill-token", in meditation.ar.
 */
const PEOPLE: Record<string, string> = { nikk: "lotus", baiwei: "tea" };
const TOKENS: Record<string, string> = { "sill-token": "Sill", "nikk-session": "nikk" };
const ROOMS: Record<string, string[]> = { nikk: ["meditation.AR", "saha.ing"], Sill: ["meditation.AR"], baiwei: ["saha.ing"] };

const fakeClient = {
  whoami: async (token: string) => {
    if (TOKENS[token]) return TOKENS[token];
    throw new WebharnessError(401, "bad token", true);
  },
  login: async (user: string, pass: string) => {
    if (PEOPLE[user] === pass) return `${user}-session`;
    throw new WebharnessError(401, "invalid credentials", true);
  },
  rooms: async (token: string) => {
    const who = TOKENS[token] ?? token.replace(/-session$/, "");
    return ROOMS[who] ?? [];
  },
} as unknown as WebharnessClient;

let app: FastifyInstance;
let base = "";
let root = "";
let work = "";
let queue: DeployQueue;
let store: SpaceStore;
let live: SpaceLive;
const benchCalls: string[] = [];

const gitAs = (user: string, pass: string, cwd: string, ...args: string[]) =>
  run("git", ["-c", "credential.helper=", "-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: work, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
  }).then(({ stdout, stderr }) => stdout + stderr);
const urlFor = (user: string, pass: string, space: string) => `${base.replace("http://", `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`)}/git/${space}.git`;
const page = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "spaces-root-"));
  work = await mkdtemp(join(tmpdir(), "spaces-work-"));
  const db = openDatabase(":memory:", DatabaseSync);
  store = new SpaceStore(db as unknown as DatabaseSync);
  app = Fastify();
  await app.register(staticPlugin, { root: work, serve: false });
  await app.register(websocket);
  live = new SpaceLive(store, (body) => `/avatars/${body}.vrm`);
  const session: Session = { username: "nikk", token: "nikk-session" } as Session;
  ({ queue } = registerSpacesHosting(app, {
    spacesRoot: root,
    store,
    auth: new SpaceAuth(fakeClient),
    sessionOf: (request) => (request.headers.cookie === "who=nikk" ? session : request.headers.cookie === "who=baiwei" ? ({ username: "baiwei", token: "baiwei-session" } as Session) : request.headers.cookie === "who=sill" ? ({ username: "Sill", token: "sill-token" } as Session) : undefined),
    tickets: new SpaceTickets(),
    live,
    bodyOf: (username) => (username === "nikk" ? "lotus" : null),
    benchChanged: (space) => benchCalls.push(space),
    bodyFile: async (slug) => {
      if (slug !== "lotus") return { ok: false as const, code: 404, error: "no such body" };
      const path = join(work, "lotus.vrm");
      await writeFile(path, "glTF-lotus");
      return { ok: true as const, path };
    },
  }));
  base = await app.listen({ port: 0, host: "127.0.0.1" });
}, 30_000);

afterAll(async () => {
  live?.stop();
  await app?.close();
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe("spaces: our own git and deploy, one per room (Nikk, 6148)", () => {
  it("makes a space for a room you are in, with a live starter page", async () => {
    const made = await app.inject({ method: "POST", url: "/bff/spaces", headers: { cookie: "who=nikk" }, payload: { room: "meditation.AR" } });
    expect(made.statusCode).toBe(200);
    expect(made.json()).toMatchObject({ name: "meditation.ar", gitPath: "/git/meditation.ar.git", sitePath: "/s/meditation.ar/" });
    const live = await page("/s/meditation.ar/");
    expect(live.status).toBe(200);
    expect(await live.text()).toContain("This page is multiplayer");
    expect(live.headers.get("content-security-policy")).toBe(SITE_SANDBOX);
    expect((await page("/s/meditation.ar")).status).toBe(302);
  });

  it("refuses a space for a room you are not in, and a second space for the same room", async () => {
    const stranger = await app.inject({ method: "POST", url: "/bff/spaces", headers: { cookie: "who=baiwei" }, payload: { room: "meditation.AR" } });
    expect(stranger.statusCode).toBe(403);
    const again = await app.inject({ method: "POST", url: "/bff/spaces", headers: { cookie: "who=nikk" }, payload: { room: "meditation.ar" } });
    expect(again.statusCode).toBe(409);
  });

  it("lets a member clone with a password, and an agent push with its token; the push is live", async () => {
    const human = join(work, "human");
    await gitAs("nikk", "lotus", work, "clone", urlFor("nikk", "lotus", "meditation.ar"), human);
    expect(await readFile(join(human, "README.md"), "utf8")).toContain("meditation.ar");

    const agent = join(work, "agent");
    await gitAs("Sill", "sill-token", work, "clone", urlFor("Sill", "sill-token", "meditation.ar"), agent);
    await mkdir(join(agent, "dist", "models"), { recursive: true });
    await writeFile(join(agent, "dist", "index.html"), "<h1>breathe</h1>");
    await writeFile(join(agent, "dist", "models", "orb.txt"), "a model");
    await writeFile(join(agent, "dist", ".env"), "SECRET=1");
    await symlink("/etc/passwd", join(agent, "dist", "passwd.txt"));
    await gitAs("Sill", "sill-token", agent, "add", "-A");
    await gitAs("Sill", "sill-token", agent, "commit", "-m", "the orb");
    const pushed = await gitAs("Sill", "sill-token", agent, "push", "origin", "main");
    expect(pushed).toContain("saha.ing: deploying main");
    await queue.idle();

    expect(await (await page("/s/meditation.ar/")).text()).toBe("<h1>breathe</h1>");
    expect(await (await page("/s/meditation.ar/models/orb.txt")).text()).toBe("a model");
    // Never shipped: a dotfile, and a symlink out of the repo.
    expect((await page("/s/meditation.ar/.env")).status).toBe(404);
    expect((await page("/s/meditation.ar/passwd.txt")).status).toBe(404);
    const detail = await app.inject({ method: "GET", url: "/bff/spaces/meditation.ar", headers: { cookie: "who=nikk" } });
    expect(detail.json().space.live).toMatchObject({ branch: "main", pushedBy: "Sill", message: "the orb", status: "ready", files: 2 });
  }, 60_000);

  it("gives another branch its own preview, leaving main alone", async () => {
    const agent = join(work, "agent");
    await gitAs("Sill", "sill-token", agent, "checkout", "-b", "rain");
    await writeFile(join(agent, "dist", "index.html"), "<h1>rain</h1>");
    await gitAs("Sill", "sill-token", agent, "commit", "-am", "rain");
    await gitAs("Sill", "sill-token", agent, "push", "origin", "rain");
    await queue.idle();
    expect(await (await page("/s/meditation.ar/@rain/")).text()).toBe("<h1>rain</h1>");
    expect(await (await page("/s/meditation.ar/")).text()).toBe("<h1>breathe</h1>");
  }, 60_000);

  it("keeps what was live when a push has nothing to publish, and says why", async () => {
    const agent = join(work, "agent");
    await gitAs("Sill", "sill-token", agent, "checkout", "main");
    await gitAs("Sill", "sill-token", agent, "rm", "-rq", "dist", "index.html");
    await gitAs("Sill", "sill-token", agent, "commit", "-m", "oops");
    await gitAs("Sill", "sill-token", agent, "push", "origin", "main");
    await queue.idle();
    expect(await (await page("/s/meditation.ar/")).text()).toBe("<h1>breathe</h1>");
    const detail = (await app.inject({ method: "GET", url: "/bff/spaces/meditation.ar", headers: { cookie: "who=nikk" } })).json();
    expect(detail.deploys[0]).toMatchObject({ status: "failed", message: "oops" });
    expect(detail.deploys[0].problem).toMatch(/Nothing to publish/);
  }, 60_000);

  it("rolls back to an earlier deploy", async () => {
    const detail = (await app.inject({ method: "GET", url: "/bff/spaces/meditation.ar", headers: { cookie: "who=nikk" } })).json();
    const starter = detail.deploys.find((deploy: { branch: string; message: string }) => deploy.branch === "main" && deploy.message.startsWith("A new space"));
    const back = await app.inject({ method: "POST", url: "/bff/spaces/meditation.ar/live", headers: { cookie: "who=nikk" }, payload: { deployId: starter.id } });
    expect(back.statusCode).toBe(200);
    expect(await (await page("/s/meditation.ar/")).text()).toContain("This page is multiplayer");
  });

  it("asks git for a login, and refuses wrong passwords and people outside the room", async () => {
    const none = await page("/git/meditation.ar.git/info/refs?service=git-upload-pack");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Basic");
    const wrong = await fetch(`${base}/git/meditation.ar.git/info/refs?service=git-upload-pack`, { headers: { authorization: `Basic ${Buffer.from("nikk:nope").toString("base64")}` } });
    expect(wrong.status).toBe(401);
    const outsider = await fetch(`${base}/git/meditation.ar.git/info/refs?service=git-receive-pack`, { headers: { authorization: `Basic ${Buffer.from("baiwei:tea").toString("base64")}` } });
    expect(outsider.status).toBe(403);
    // A token under somebody else's name is not that somebody.
    const borrowed = await fetch(`${base}/git/meditation.ar.git/info/refs?service=git-upload-pack`, { headers: { authorization: `Basic ${Buffer.from("nikk:sill-token").toString("base64")}` } });
    expect(borrowed.status).toBe(401);
  });

  it("serves nothing for a space that does not exist, and refuses paths that climb out", async () => {
    expect((await page("/s/nowhere/")).status).toBe(404);
    expect((await page("/git/nowhere.git/info/refs?service=git-upload-pack")).status).toBe(404);
    expect((await page("/s/meditation.ar/%2e%2e/%2e%2e/etc/passwd")).status).toBeGreaterThanOrEqual(400);
  });

  it("lists your spaces and the rooms you could make one for", async () => {
    const list = (await app.inject({ method: "GET", url: "/bff/spaces", headers: { cookie: "who=nikk" } })).json();
    expect(list.spaces.map((space: { name: string }) => space.name)).toEqual(["meditation.ar"]);
    expect(list.rooms).toEqual(["saha.ing"]);
  });
});

describe("the rules underneath", () => {
  it("chooses what to publish", () => {
    expect(publishDir(new Set(["dist/index.html", "index.html"]), null)).toEqual({ dir: "dist" });
    expect(publishDir(new Set(["index.html"]), null)).toEqual({ dir: "" });
    expect(publishDir(new Set(["public/index.html"]), { publish: "./public/" })).toEqual({ dir: "public" });
    expect(publishDir(new Set(["index.html"]), { publish: "../etc" })).toHaveProperty("problem");
    expect(normaliseDir("a/../b")).toBeNull();
  });

  it("maps URLs to files inside a deploy and nowhere else", () => {
    expect(siteFile("/")).toBe("index.html");
    expect(siteFile("/a/b.js")).toBe("a/b.js");
    expect(siteFile("/docs/")).toBe("docs/index.html");
    expect(siteFile("/../x")).toBeNull();
    expect(siteFile("/%2e%2e/x")).toBeNull();
    expect(siteFile("/a%5c..%5cb")).toBeNull();
  });

  it("names spaces after rooms", () => {
    expect(spaceNameProblem("meditation.ar")).toBeNull();
    expect(spaceNameProblem("x.git")).not.toBeNull();
    expect(spaceNameProblem("../x")).not.toBeNull();
    expect(parseBasic(`Basic ${Buffer.from("a:b:c").toString("base64")}`)).toEqual({ user: "a", pass: "b:c" });
  });
});

describe("spaces inside the real server", () => {
  it("answers /git/ and /s/ itself, not the app's fallback, and needs a login for /bff/spaces", async () => {
    const { buildServer } = await import("../index.js");
    const spacesRoot = await mkdtemp(join(tmpdir(), "spaces-built-"));
    const built = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: await mkdtemp(join(tmpdir(), "spaces-blobs-")),
      SPACES_ROOT: spacesRoot,
      LOG_LEVEL: "silent",
    });
    try {
      expect(built.config.spacesRoot).toBe(spacesRoot);
      const site = await built.app.inject({ method: "GET", url: "/s/nowhere/" });
      expect(site.statusCode).toBe(404);
      expect(site.body).toContain("Nothing is published");
      const repo = await built.app.inject({ method: "GET", url: "/git/nowhere.git/info/refs?service=git-upload-pack" });
      expect(repo.statusCode).toBe(404);
      expect(repo.body).toContain("no space called");
      expect((await built.app.inject({ method: "GET", url: "/bff/spaces" })).statusCode).toBe(401);
      // The kit itself, loadable from a sandboxed space page (dist is built by the suite's setup or earlier).
      const kitFile = await built.app.inject({ method: "GET", url: "/kit/saha.js" });
      if (kitFile.statusCode === 200) expect(kitFile.headers["access-control-allow-origin"]).toBe("*");
      expect((await built.app.inject({ method: "GET", url: "/bff/spaces/public" })).json()).toEqual({ spaces: [] });
    } finally {
      await built.app.close();
      await rm(spacesRoot, { recursive: true, force: true });
    }
  });
});


describe("the multiplayer kit: join a space and see each other (Nikk, 2026-09-29)", () => {
  // The very script space pages load, run here against the test server.
  const kit = () => import("../../src/kit/connect.js") as unknown as Promise<{ connectSaha: (options: Record<string, unknown>) => KitRoom }>;
  type KitRoom = {
    you: { id: string } | null;
    guest: boolean;
    connected: boolean;
    people: Map<string, { id: string; name: string; body: string | null; bodyUrl: string | null; p: number[] | null }>;
    state: Record<string, unknown>;
    on: (event: string, listener: (...args: unknown[]) => void) => () => void;
    pose: (p: number[], q: number[]) => void;
    set: (key: string, value: unknown) => void;
    say: (text: string) => void;
    send: (message: unknown) => void;
    emit: (name: string, data?: unknown) => void;
    leave: () => void;
  };
  const until = async (check: () => boolean, ms = 4000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error("timed out waiting");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const ticketFor = async (who: string, space = "meditation.ar") => app.inject({ method: "POST", url: `/bff/spaces/${space}/ticket`, headers: { cookie: `who=${who}` } });
  const join = async (ticket: string | null) => {
    const { connectSaha } = await kit();
    return connectSaha({ server: base, space: "meditation.ar", ticket, href: `${base}/s/meditation.ar/` });
  };

  it("gives members a ticket into the space, and nobody else while it is not public", async () => {
    const mine = await ticketFor("nikk");
    expect(mine.statusCode).toBe(200);
    expect(mine.json().path).toMatch(/^\/s\/meditation\.ar\/#saha=/);
    expect((await ticketFor("baiwei")).statusCode).toBe(403);
  });

  it("shows each person to the other: pose, name and chosen body", async () => {
    const nikk = await join((await ticketFor("nikk")).json().ticket);
    const sill = await join((await ticketFor("sill")).json().ticket);
    try {
      await until(() => nikk.connected && sill.connected);
      expect(nikk.guest).toBe(false);
      nikk.pose([1, 1.6, 2], [0, 0, 0, 1]);
      await until(() => sill.people.get("nikk")?.p?.[0] === 1);
      expect(sill.people.get("nikk")).toMatchObject({ name: "nikk", body: "lotus", bodyUrl: "/avatars/lotus.vrm", p: [1, 1.6, 2] });
      expect([...nikk.people.keys()].sort()).toEqual(["Sill", "nikk"]);
    } finally {
      nikk.leave();
      sill.leave();
    }
  });

  it("shows a person on two devices twice, rather than one figure flipping between them (Nikk, 6173)", async () => {
    const phone = await join((await ticketFor("nikk")).json().ticket);
    const headset = await join((await ticketFor("nikk")).json().ticket);
    try {
      await until(() => phone.connected && headset.connected);
      phone.pose([0, 1.6, 0], [0, 0, 0, 1]);
      headset.pose([2, 1.6, 0], [0, 0, 0, 1]);
      // Both of this person's figures, wherever an earlier connection still closing left the ids.
      const mine = () => [...phone.people.values()].filter((person) => person.id === phone.you?.id || person.id === headset.you?.id);
      await until(() => mine().length === 2 && mine().every((person) => person.p !== null));
      expect(mine().map((person) => person.name)).toEqual(["nikk", "nikk"]);
      expect(new Set(mine().map((person) => person.id)).size).toBe(2);
      expect(mine().map((person) => person.p?.[0]).sort()).toEqual([0, 2]);
      expect(phone.guest || headset.guest).toBe(false);
    } finally {
      phone.leave();
      headset.leave();
    }
  });

  it("shares values every visitor sees, remembered for the next one, and says lines out loud", async () => {
    const nikk = await join((await ticketFor("nikk")).json().ticket);
    const sill = await join((await ticketFor("sill")).json().ticket);
    const heard: unknown[] = [];
    sill.on("say", (message) => heard.push(message));
    try {
      await until(() => nikk.connected && sill.connected);
      nikk.set("lamp", { on: true });
      nikk.say("  hello   everyone ");
      await until(() => JSON.stringify(sill.state.lamp) === JSON.stringify({ on: true }) && heard.length === 1);
      expect(heard[0]).toMatchObject({ name: "nikk", text: "hello everyone" });
      const later = await join((await ticketFor("sill")).json().ticket);
      await until(() => later.connected);
      expect(later.state.lamp).toEqual({ on: true });
      later.leave();
    } finally {
      nikk.leave();
      sill.leave();
    }
  });

  it("keeps guests out of a private space, and lets them watch a public one without changing it", async () => {
    const shut = await join(null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(shut.connected).toBe(false);
    shut.leave();

    const published = await app.inject({ method: "POST", url: "/bff/spaces/meditation.ar/public", headers: { cookie: "who=nikk" }, payload: { public: true, title: "Meditation room" } });
    expect(published.json()).toMatchObject({ public: true, title: "Meditation room" });
    const doors = (await app.inject({ method: "GET", url: "/bff/spaces/public" })).json();
    expect(doors.spaces).toEqual([expect.objectContaining({ name: "meditation.ar", title: "Meditation room", sitePath: "/s/meditation.ar/" })]);
    // Public: anybody signed in may now have a ticket.
    expect((await ticketFor("baiwei")).statusCode).toBe(200);

    const nikk = await join((await ticketFor("nikk")).json().ticket);
    const guest = new WebSocket(`${base.replace("http", "ws")}/bff/spaces/meditation.ar/live`);
    const said: Array<{ t: string; guest?: boolean; people?: unknown[]; why?: string }> = [];
    guest.onmessage = (event) => said.push(JSON.parse(String(event.data)));
    try {
      await until(() => nikk.connected && said.some((message) => message.t === "hello"));
      expect(said.find((message) => message.t === "hello")).toMatchObject({ guest: true });
      guest.send(JSON.stringify({ t: "set", k: "lamp", v: "off" }));
      await until(() => said.some((message) => message.t === "refused"));
      expect(nikk.state.lamp).toEqual({ on: true });
      // Guests are not people: they are not in anyone's list.
      expect([...nikk.people.keys()]).toEqual(["nikk"]);
    } finally {
      guest.close();
      nikk.leave();
    }
  });

  it("lets a space page with a ticket load a saha.ing body, and nobody without one", async () => {
    const ticket = (await ticketFor("nikk")).json().ticket;
    expect((await page("/bff/spaces/meditation.ar/body/lotus.vrm")).status).toBe(401);
    expect((await page("/bff/spaces/meditation.ar/body/lotus.vrm?ticket=wrong")).status).toBe(401);
    const body = await page(`/bff/spaces/meditation.ar/body/lotus.vrm?ticket=${ticket}`);
    expect(body.status).toBe(200);
    expect(body.headers.get("access-control-allow-origin")).toBe("*");
    expect(await body.text()).toBe("glTF-lotus");
    expect((await page(`/bff/spaces/meditation.ar/body/nobody.vrm?ticket=${ticket}`)).status).toBe(404);
  });

  it("passes a call's setup to the one person it is for, and shows who has their microphone on", async () => {
    const nikk = await join((await ticketFor("nikk")).json().ticket);
    const sill = await join((await ticketFor("sill")).json().ticket);
    const baiwei = await join((await ticketFor("baiwei")).json().ticket).catch(() => null);
    const heardBySill: unknown[][] = [];
    sill.on("signal", (...args) => heardBySill.push(args));
    try {
      await until(() => nikk.connected && sill.connected);
      nikk.send({ t: "voice", on: true });
      await until(() => sill.people.get(nikk.you!.id)?.voice === true);
      nikk.send({ t: "signal", to: sill.you!.id, s: { kind: "offer", sdp: "v=0 fake" } });
      await until(() => heardBySill.length === 1);
      expect(heardBySill[0]).toEqual([nikk.you!.id, { kind: "offer", sdp: "v=0 fake" }]);
    } finally {
      nikk.leave();
      sill.leave();
      baiwei?.leave();
    }
  });

  it("sends a moment (a note struck) to everyone else, not back to the sender, and caps a flood", async () => {
    const nikk = await join((await ticketFor("nikk")).json().ticket);
    const sill = await join((await ticketFor("sill")).json().ticket);
    const bySill: unknown[][] = [];
    const byNikk: unknown[][] = [];
    sill.on("event", (...args) => bySill.push(args));
    nikk.on("event", (...args) => byNikk.push(args));
    try {
      await until(() => nikk.connected && sill.connected);
      nikk.emit("note", { bar: 3, velocity: 0.8 });
      await until(() => bySill.length === 1);
      expect(bySill[0]).toEqual(["note", { bar: 3, velocity: 0.8 }, nikk.you!.id]);
      for (let i = 0; i < 60; i += 1) nikk.emit("note", { bar: i });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(bySill.length).toBeLessThanOrEqual(31);
      expect(byNikk).toEqual([]);
    } finally {
      nikk.leave();
      sill.leave();
    }
  });

  it("serves three.js and its addons from saha.ing, to any origin, and nothing outside them", async () => {
    const three = await page("/kit/three/three.module.js");
    expect(three.status).toBe(200);
    expect(three.headers.get("access-control-allow-origin")).toBe("*");
    expect((await page("/kit/three/addons/webxr/VRButton.js")).status).toBe(200);
    expect((await page("/kit/three/%2e%2e/package.json")).status).toBe(404);
    expect((await page("/kit/three/addons/../../package.json")).status).toBe(404);
  });
});

describe("what the kit accepts on the wire", () => {
  it("takes poses, values and lines of a sane size, and nothing else", async () => {
    const { readClientMessage } = await import("../../shared/space-kit.js");
    expect(readClientMessage({ t: "pose", p: [0, 1.6, 0], q: [0, 0, 0, 1] })).toMatchObject({ t: "pose" });
    expect(readClientMessage({ t: "pose", p: [0, 1e9, 0], q: [0, 0, 0, 1] })).toBeNull();
    expect(readClientMessage({ t: "pose", p: [0, Number.NaN, 0], q: [0, 0, 0, 1] })).toBeNull();
    expect(readClientMessage({ t: "set", k: "lamp", v: "x".repeat(5000) })).toBeNull();
    expect(readClientMessage({ t: "set", k: "bad key!", v: 1 })).toBeNull();
    expect(readClientMessage({ t: "say", text: "   " })).toBeNull();
    expect(readClientMessage({ t: "exec", code: "x" })).toBeNull();
    expect(readClientMessage({ t: "signal", to: "nikk", s: { kind: "offer", sdp: "x".repeat(20_000) } })).toBeNull();
    expect(readClientMessage({ t: "signal", to: "nikk", s: { kind: "hack" } })).toBeNull();
    expect(readClientMessage({ t: "voice", on: "yes" })).toEqual({ t: "voice", on: false });
  });
});


describe("the workbench: a space's pieces, live in its saha.ing room (Nikk, 2026-09-29)", () => {
  it("records the pieces a push lists, follows the branch the team picks, and tells the room each time", async () => {
    const agent = join(work, "agent");
    await gitAs("Sill", "sill-token", agent, "checkout", "-q", "-B", "wip", "origin/main");
    await mkdir(join(agent, "dist", "models"), { recursive: true });
    await writeFile(join(agent, "dist", "index.html"), "<h1>wip</h1>");
    await writeFile(join(agent, "dist", "models", "orb.glb"), "glTF-not-really");
    await mkdir(join(agent, "dist", "bell"), { recursive: true });
    await writeFile(join(agent, "dist", "bell", "index.html"), "<h1>bell</h1>");
    await writeFile(join(agent, "saha-pieces.json"), JSON.stringify({ pieces: [
      { id: "orb", name: "Meditation orb", model: "models/orb.glb", spin: true },
      { id: "bell", name: "Bell instrument", page: "bell/" },
      { id: "ghost", name: "Missing", model: "models/ghost.glb" },
    ] }));
    await gitAs("Sill", "sill-token", agent, "add", "-A");
    await gitAs("Sill", "sill-token", agent, "commit", "-qm", "pieces");

    const follow = await app.inject({ method: "POST", url: "/bff/spaces/meditation.ar/bench", headers: { cookie: "who=nikk" }, payload: { branch: "wip" } });
    expect(follow.statusCode).toBe(200);
    benchCalls.length = 0;
    await gitAs("Sill", "sill-token", agent, "push", "-q", "origin", "wip");
    await queue.idle();
    expect(benchCalls).toEqual(["meditation.ar"]);

    const bench = (await app.inject({ method: "GET", url: "/bff/spaces/meditation.ar/bench", headers: { cookie: "who=nikk" } })).json();
    expect(bench.branch).toBe("wip");
    expect(bench.pieces.map((piece: { id: string; kind: string }) => [piece.id, piece.kind])).toEqual([["orb", "model"], ["bell", "page"]]);
    expect(bench.pieces[0].url).toBe(`/s/meditation.ar/@wip/models/orb.glb?v=${encodeURIComponent(bench.deploy.id)}`);
    expect(bench.problems).toEqual(["ghost: models/ghost.glb is not in what was published."]);
    // The model is really there, at the URL the room will load.
    expect(await (await page(bench.pieces[0].url)).text()).toBe("glTF-not-really");
    // A push to main does not disturb a bench that follows wip.
    benchCalls.length = 0;
    await gitAs("Sill", "sill-token", agent, "push", "-q", "origin", "wip:main");
    await queue.idle();
    expect(benchCalls).toEqual([]);
  }, 60_000);

  it("shows the bench only to the room, or to anyone when the space is public", async () => {
    await app.inject({ method: "POST", url: "/bff/spaces/meditation.ar/public", headers: { cookie: "who=nikk" }, payload: { public: false } });
    expect((await app.inject({ method: "GET", url: "/bff/spaces/meditation.ar/bench", headers: { cookie: "who=baiwei" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/bff/spaces/meditation.ar/bench", headers: { cookie: "who=baiwei" }, payload: { branch: "main" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/bff/spaces/nowhere/bench", headers: { cookie: "who=nikk" } })).statusCode).toBe(404);
  });
});

describe("what saha-pieces.json may say", () => {
  it("keeps good pieces, names every bad one, and never lets a path leave the site", async () => {
    const { readPieces } = await import("../../shared/space-bench.js");
    const published = new Map<string, number>([["m/a.glb", 10], ["m/huge.glb", 60 * 1024 * 1024], ["pic.png", 5], ["ui/index.html", 3]]);
    const { pieces, problems } = readPieces(JSON.stringify({ pieces: [
      { id: "a", model: "m/a.glb" },
      { id: "a", model: "m/a.glb" },
      { id: "huge", model: "m/huge.glb" },
      { id: "pic", name: "A picture", image: "pic.png" },
      { id: "ui", page: "ui/" },
      { id: "up", model: "../secret.glb" },
      { id: "two", model: "m/a.glb", image: "pic.png" },
      { id: "txt", image: "ui/index.html" },
    ] }), published);
    expect(pieces.map((piece) => piece.id)).toEqual(["a", "pic", "ui"]);
    expect(problems).toHaveLength(5);
    expect(problems.join(" ")).toMatch(/unique "id"/);
    expect(problems.join(" ")).toMatch(/60 MB/);
    expect(problems.join(" ")).toMatch(/inside the published site/);
    expect(readPieces("{", published).problems).toEqual(["saha-pieces.json is not valid JSON."]);
    const many = readPieces(JSON.stringify({ pieces: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, model: "m/a.glb" })) }), published);
    expect(many.pieces).toHaveLength(8);
  });
});

describe("starter kinds", () => {
  it("defaults to the saha.ing room and accepts only known kinds", async () => {
    const { starterKind } = await import("../../shared/spaces");
    expect(starterKind("flat")).toBe("flat");
    expect(starterKind("webxr")).toBe("webxr");
    expect(starterKind(undefined)).toBe("vr");
    expect(starterKind("../evil")).toBe("vr");
  });
});
