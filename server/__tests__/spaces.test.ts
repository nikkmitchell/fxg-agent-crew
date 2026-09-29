import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import staticPlugin from "@fastify/static";
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
  const session: Session = { username: "nikk", token: "nikk-session" } as Session;
  ({ queue } = registerSpacesHosting(app, {
    spacesRoot: root,
    store,
    auth: new SpaceAuth(fakeClient),
    sessionOf: (request) => (request.headers.cookie === "who=nikk" ? session : request.headers.cookie === "who=baiwei" ? ({ username: "baiwei", token: "baiwei-session" } as Session) : undefined),
  }));
  base = await app.listen({ port: 0, host: "127.0.0.1" });
}, 30_000);

afterAll(async () => {
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
    expect(await live.text()).toContain("This space is live");
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
    expect(await (await page("/s/meditation.ar/")).text()).toContain("This space is live");
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
    } finally {
      await built.app.close();
      await rm(spacesRoot, { recursive: true, force: true });
    }
  });
});
