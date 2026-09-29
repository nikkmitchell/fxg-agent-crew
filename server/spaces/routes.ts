import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  LIVE_BRANCH,
  isPreviewableBranch,
  siteFile,
  spaceKey,
  spaceNameProblem,
  type DeployRecord,
} from "../../shared/spaces.js";
import type { Session } from "../session.js";
import { doorTitle, spaceEntryPath } from "../../shared/space-kit.js";
import { pieceUrl } from "../../shared/space-bench.js";
import { iceServersFrom } from "../space/ice.js";
import type { SpaceLive } from "./live.js";
import type { SpaceTickets } from "./tickets.js";
import { WebharnessError } from "../webharness/client.js";
import { SpaceAuth, parseBasic, type GitIdentity } from "./auth.js";
import { DeployQueue, deployCommit, siteDir } from "./deploy.js";
import { branches, createRepo, gitEnv } from "./git.js";
import { SpaceStore, type StoredDeploy } from "./store.js";

/**
 * SPACES, OVER HTTP (shared/spaces.ts has the whole story).
 *
 *   /git/<space>.git/...          git clone / fetch / push (members of the room)
 *   /s/<space>/...                the space's main branch, for anyone
 *   /s/<space>/@<branch>/...      a preview of another branch
 *   GET  /bff/spaces              your spaces, and your rooms that have none yet
 *   POST /bff/spaces              { room }  make the space for a room you are in
 *   GET  /bff/spaces/<space>      its branches and deploys
 *   POST /bff/spaces/<space>/live { branch, deployId }  roll back (or forward)
 */

/**
 * A SPACE RUNS SOMEBODY ELSE'S JAVASCRIPT ON OUR DOMAIN. Served plainly, a
 * space's page at saha.ing/s/x/ would share saha.ing's origin: it could call
 * /bff/* with the visitor's session and post as them. So every file is sent
 * with a CSP sandbox and no allow-same-origin: the browser gives the page an
 * origin of its own that is nobody's, our cookies do not go with its
 * requests, and it cannot read saha.ing. It can still run scripts, open
 * windows, go full screen and lock the pointer. The price: no localStorage or
 * cookies of its own. A separate domain for spaces would lift that later.
 */
export const SITE_SANDBOX =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock allow-presentation allow-orientation-lock";

const STARTER = (space: string, by: string) => [
  {
    path: "index.html",
    content: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${space}</title>
<style>
  html, body { margin: 0; height: 100%; background: #14171c; color: #eef0f3; font-family: system-ui, sans-serif; }
  #about { position: fixed; top: 12px; left: 12px; right: 12px; max-width: 30rem; padding: 10px 14px; border-radius: 10px; background: rgba(20,23,28,.72); line-height: 1.5; }
  code { background: #232830; padding: .05rem .3rem; border-radius: 4px; }
</style>
<!-- three.js comes from saha.ing itself, so no outside CDN is needed; the kit uses the same copy. -->
<script type="importmap">
{ "imports": { "three": "/kit/three/three.module.js", "three/addons/": "/kit/three/addons/" } }
</script>
</head>
<body>
<div id="about">
  <strong>${space}</strong>, made by ${by}. This page is multiplayer: everyone who enters it from
  saha.ing sees everyone else. Change it with <code>git clone</code>, edit <code>index.html</code>,
  <code>git push</code>. See README.md.
</div>
<script type="module">
  import * as THREE from "three";
  import { joinSaha } from "/kit/saha.js";

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2028);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
  camera.position.set(0, 1.6, 3);
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x30281f, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 6, 2);
  scene.add(sun);
  scene.add(new THREE.GridHelper(20, 20, 0x556070, 0x2c3440));
  const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), new THREE.MeshStandardMaterial({ color: 0x8fb3a4, flatShading: true }));
  stone.position.set(0, 1, 0);
  scene.add(stone);

  // One line brings saha.ing: everyone else, moving the saha.ing way (sticks,
  // snap turn, palm joystick; WASD and drag on a computer), Enter VR, hands,
  // and a wrist menu. room.set / room.on("state") share things; room.say talks.
  const room = joinSaha({ scene, camera, renderer });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop((time) => {
    stone.rotation.y = time / 4000;
    renderer.render(scene, camera);
  });
</script>
</body>
</html>
`,
  },
  {
    path: "README.md",
    content: `# ${space}

This is the source of the space **${space}** on saha.ing.

- Live: https://saha.ing/s/${space}/
- Git:  https://saha.ing/git/${space}.git

Anyone in the WebHarness room \`${space}\` can clone and push, with their saha.ing login
(people: WebHarness password; agents: their WebHarness token — see docs/SPACES.md in saha.ing).

## Multiplayer

\`index.html\` loads saha.ing's kit and calls \`joinSaha({ THREE, scene, camera, renderer })\`:
everyone who enters the space from saha.ing sees everyone else. \`room.set(key, value)\` and
\`room.on("state", ...)\` share values every visitor sees; \`room.say(text)\` shows a line
over your head. People who open the address directly watch as guests.

## Publishing

Every push deploys. \`main\` is the space itself; any other branch is a preview at
\`/s/${space}/@<branch>/\`. Make it a PUBLIC ROOM on the Spaces page and it gets a door
in the saha.ing lobby.

What is published: \`dist/\` if it has an index.html, else the top of the repo, or the
folder named in \`saha-space.json\` (\`{ "publish": "public", "spa": true }\`).
Nothing runs on the server. The page runs sandboxed: it cannot read saha.ing or use its
sign-in, and has no localStorage or cookies of its own.
`,
  },
];

export function registerSpacesHosting(app: FastifyInstance, deps: {
  spacesRoot: string;
  store: SpaceStore;
  auth: SpaceAuth;
  sessionOf: (request: FastifyRequest) => Session | undefined;
  /** The multiplayer kit (shared/space-kit.ts). */
  tickets: SpaceTickets;
  live: SpaceLive;
  /** The body a person chose in saha.ing, if any. */
  bodyOf: (username: string) => string | null;
  /** A catalogue body's file on disk, fetched and cached on first use (server/space/body-files.ts). */
  bodyFile?: (slug: string) => Promise<{ ok: true; path: string } | { ok: false; code: number; error: string }>;
  /**
   * What a room's bench shows may have changed (a deploy, a rollback, a
   * different branch followed): tell the saha.ing room of that name.
   */
  benchChanged?: (space: string) => void;
  queue?: DeployQueue;
  now?: () => Date;
}): { queue: DeployQueue } {
  const { spacesRoot: root, store, auth } = deps;
  const queue = deps.queue ?? new DeployQueue();
  const now = deps.now ?? (() => new Date());

  /** The visitor, for limits: nginx's X-Real-IP, believed only from the local proxy. */
  const visitor = (request: FastifyRequest): string => {
    const local = request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
    const real = request.headers["x-real-ip"];
    return local && typeof real === "string" && real ? real : request.ip;
  };

  const summary = (name: string, createdBy: string, createdAt: string) => {
    const shown = store.publicInfo(name);
    return {
      name,
      createdBy,
      createdAt,
      gitPath: `/git/${name}.git`,
      sitePath: `/s/${name}/`,
      live: publicDeploy(store.live(name, LIVE_BRANCH)),
      public: shown.public,
      title: shown.title,
      benchBranch: store.benchBranch(name),
      here: deps.live.count(name),
    };
  };

  const deployFor = (space: string, branch: string, commit: string, pushedBy: string) =>
    queue.run(space, async () => {
      const deploy = await deployCommit({ root, store, space, branch, commit, pushedBy, now });
      if (deploy.status === "ready" && branch === store.benchBranch(space)) deps.benchChanged?.(space);
      return deploy;
    });

  // ---------------------------------------------------------------- git
  app.register(async (scope) => {
    // git's request bodies are streamed straight into git; nothing parses them.
    scope.addContentTypeParser(
      ["application/x-git-upload-pack-request", "application/x-git-receive-pack-request"],
      (_request, payload, done) => done(null, payload),
    );

    scope.route({
      method: ["GET", "POST"],
      url: "/git/*",
      handler: async (request, reply) => {
        const url = new URL(request.url, "http://placeholder");
        const match = /^\/git\/([^/]+)\.git(\/(?:info\/refs|git-upload-pack|git-receive-pack))$/.exec(url.pathname);
        if (!match) return reply.code(404).send("Not a space repository path. Clone https://saha.ing/git/<space>.git\n");
        const space = spaceKey(decodeURIComponent(match[1]));
        const action = match[2];
        const service = action === "/info/refs" ? url.searchParams.get("service") : action.slice(1);
        if (service !== "git-upload-pack" && service !== "git-receive-pack") {
          return reply.code(403).send("Only git's smart HTTP protocol is served here; update git.\n");
        }
        if (spaceNameProblem(space) || !store.exists(space)) return reply.code(404).send(`There is no space called ${space}.\n`);

        const who = visitor(request);
        const ask = (why: string) =>
          reply.code(401).header("www-authenticate", 'Basic realm="saha.ing spaces"').send(`${why}\n`);
        if (auth.blocked(who)) return reply.code(429).send("Too many failed sign-ins from here. Wait ten minutes.\n");
        const credentials = parseBasic(request.headers.authorization);
        if (!credentials) return ask("Sign in with your saha.ing (WebHarness) name, and your password or agent token.");
        let identity: GitIdentity | null;
        try {
          identity = await auth.identify(credentials.user, credentials.pass, who);
          if (identity && !(await auth.isMember(identity, space))) {
            return reply.code(403).send(`${identity.username} is not a member of the room ${space}, so cannot use its space.\n`);
          }
        } catch (error) {
          request.log.error({ err: error }, "space sign-in could not reach WebHarness");
          return reply.code(502).send("saha.ing could not reach WebHarness to check who you are. Try again shortly.\n");
        }
        if (!identity) return ask("WebHarness did not accept that name and password (or token).");

        const pushing = service === "git-receive-pack" && request.method === "POST";
        const before = pushing ? await branches(root, space) : null;
        await runBackend(request, reply, {
          root,
          pathInfo: `/${space}.git${action}`,
          query: url.search.slice(1),
          user: identity.username,
          visitor: who,
          onFinished: pushing
            ? async (ok) => {
                if (!ok || !before) return;
                const after = await branches(root, space);
                for (const [branch, commit] of after) {
                  if (before.get(branch) === commit || !isPreviewableBranch(branch)) continue;
                  void deployFor(space, branch, commit, identity!.username).catch((error) => request.log.error({ err: error, space, branch }, "space deploy failed"));
                }
                for (const branch of before.keys()) if (!after.has(branch)) store.clearLive(space, branch);
              }
            : undefined,
        });
        return reply;
      },
    });
  });

  // ---------------------------------------------------------------- sites
  const serveSite = async (request: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(request.url, "http://placeholder");
    const match = /^\/s\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return reply.code(404).send("not found");
    const asked = decodeURIComponent(match[1]);
    const space = spaceKey(asked);
    if (asked !== space || match[2] === undefined) return reply.redirect(`/s/${space}${match[2] ?? "/"}${url.search}`);
    let rest = match[2];
    let branch = LIVE_BRANCH;
    const preview = /^\/@([^/]+)(\/.*)?$/.exec(rest);
    if (preview) {
      branch = decodeURIComponent(preview[1]);
      if (preview[2] === undefined) return reply.redirect(`/s/${space}/@${branch}/${url.search}`);
      rest = preview[2];
    }
    const deploy = !spaceNameProblem(space) && isPreviewableBranch(branch) ? store.live(space, branch) : null;
    if (!deploy) {
      return reply.code(404).type("text/plain; charset=utf-8").send(
        branch === LIVE_BRANCH ? `Nothing is published at /s/${space}/ yet.\n` : `Branch ${branch} of ${space} has no preview.\n`,
      );
    }
    const file = siteFile(rest);
    if (file === null) return reply.code(400).send("bad path");
    const dir = siteDir(root, space, deploy.id);

    reply
      .header("content-security-policy", SITE_SANDBOX)
      .header("access-control-allow-origin", "*")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-cache");
    const isFile = async (relative: string) => (await stat(join(dir, relative)).catch(() => null))?.isFile() === true;

    if (await isFile(file)) return reply.sendFile(file, dir);
    // /s/x/about -> /s/x/about/ when about/index.html exists, so its relative links work.
    if (!/\.[A-Za-z0-9]+$/.test(file) && !rest.endsWith("/") && (await isFile(`${file}/index.html`))) {
      return reply.redirect(`${url.pathname}/${url.search}`);
    }
    if (deploy.spa) return reply.sendFile("index.html", dir);
    if (await isFile("404.html")) return reply.code(404).type("text/html; charset=utf-8").send(await readFile(join(dir, "404.html")));
    return reply.code(404).type("text/plain; charset=utf-8").send("not found\n");
  };
  app.get("/s/*", serveSite);

  // ---------------------------------------------------------------- the web side
  const signedIn = (request: FastifyRequest, reply: FastifyReply): GitIdentity | null => {
    const session = deps.sessionOf(request);
    if (!session) {
      reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
      return null;
    }
    return { username: session.username, token: session.token };
  };
  const upstream = (reply: FastifyReply, error: unknown) => {
    if (error instanceof WebharnessError && error.status === 401) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "Sign in again.", reauth: true });
    return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "WebHarness could not be reached to check your rooms." });
  };

  app.get("/bff/spaces", async (request, reply) => {
    const me = signedIn(request, reply);
    if (!me) return reply;
    let rooms: string[];
    try {
      rooms = await auth.roomsOf(me);
    } catch (error) {
      return upstream(reply, error);
    }
    const spaces = rooms.filter((room) => store.exists(room)).map((room) => {
      const space = store.get(room)!;
      return summary(space.name, space.createdBy, space.createdAt);
    });
    const withoutSpace = rooms.filter((room) => !store.exists(room) && !spaceNameProblem(room));
    return reply.header("cache-control", "no-store").send({ spaces, rooms: withoutSpace });
  });

  app.post<{ Body: { room?: unknown } }>("/bff/spaces", async (request, reply) => {
    const me = signedIn(request, reply);
    if (!me) return reply;
    const room = typeof request.body?.room === "string" ? spaceKey(request.body.room) : "";
    const problem = spaceNameProblem(room);
    if (problem) return reply.code(400).send({ code: "BAD_SPACE", error: problem });
    try {
      auth.forgetRooms(me.username);
      if (!(await auth.isMember(me, room))) return reply.code(403).send({ code: "NOT_A_MEMBER", error: `You are not in the room ${room}, so cannot make its space.` });
    } catch (error) {
      return upstream(reply, error);
    }
    if (store.exists(room)) return reply.code(409).send({ code: "SPACE_EXISTS", error: `${room} already has a space.` });
    const at = now().toISOString();
    const commit = await createRepo(root, room, STARTER(room, me.username), me.username);
    store.create(room, me.username, at);
    await deployFor(room, LIVE_BRANCH, commit, me.username);
    return reply.send(summary(room, me.username, at));
  });

  const memberSpace = async (request: FastifyRequest<{ Params: { space: string } }>, reply: FastifyReply) => {
    const me = signedIn(request, reply);
    if (!me) return null;
    const space = spaceKey(request.params.space);
    const record = store.get(space);
    if (!record) {
      reply.code(404).send({ code: "NO_SPACE", error: `There is no space called ${space}.` });
      return null;
    }
    try {
      if (!(await auth.isMember(me, space))) {
        reply.code(403).send({ code: "NOT_A_MEMBER", error: `You are not in the room ${space}.` });
        return null;
      }
    } catch (error) {
      upstream(reply, error);
      return null;
    }
    return { me, space, record };
  };

  app.get<{ Params: { space: string } }>("/bff/spaces/:space", async (request, reply) => {
    const found = await memberSpace(request, reply);
    if (!found) return reply;
    const { space, record } = found;
    const heads = await branches(root, space);
    const branchList = [...new Set([...heads.keys(), ...store.liveBranches(space)])].sort((a, b) =>
      a === LIVE_BRANCH ? -1 : b === LIVE_BRANCH ? 1 : a.localeCompare(b),
    ).map((branch) => ({
      branch,
      head: heads.get(branch) ?? null,
      sitePath: branch === LIVE_BRANCH ? `/s/${space}/` : `/s/${space}/@${branch}/`,
      live: publicDeploy(store.live(space, branch)),
    }));
    return reply.header("cache-control", "no-store").send({
      space: summary(record.name, record.createdBy, record.createdAt),
      branches: branchList,
      deploys: store.deploys(space).map(publicDeploy),
    });
  });

  app.post<{ Params: { space: string }; Body: { branch?: unknown; deployId?: unknown } }>("/bff/spaces/:space/live", async (request, reply) => {
    const found = await memberSpace(request, reply);
    if (!found) return reply;
    const deploy = typeof request.body?.deployId === "string" ? store.deploy(request.body.deployId) : null;
    if (!deploy || deploy.space !== found.space) return reply.code(404).send({ code: "NO_DEPLOY", error: "No such deploy in this space." });
    if (deploy.status !== "ready") return reply.code(409).send({ code: "NOT_SERVABLE", error: deploy.status === "failed" ? "That deploy failed; there is nothing to serve." : "That deploy's files have been cleared; push it again." });
    store.setLive(found.space, deploy.branch, deploy.id);
    if (deploy.branch === store.benchBranch(found.space)) deps.benchChanged?.(found.space);
    return reply.send({ branch: deploy.branch, live: publicDeploy(deploy) });
  });

  // ---------------------------------------------------------------- the multiplayer kit

  /**
   * A TICKET INTO A SPACE, for the person signed in here: the lobby door and
   * the Spaces page ask for one, then open /s/<space>/#saha=<ticket>. Members
   * of the room always; anybody signed in when the team has made it public.
   */
  app.post<{ Params: { space: string } }>("/bff/spaces/:space/ticket", async (request, reply) => {
    const me = signedIn(request, reply);
    if (!me) return reply;
    const space = spaceKey(request.params.space);
    if (!store.exists(space)) return reply.code(404).send({ code: "NO_SPACE", error: `There is no space called ${space}.` });
    if (!store.publicInfo(space).public) {
      try {
        if (!(await auth.isMember(me, space))) return reply.code(403).send({ code: "NOT_A_MEMBER", error: `${space} is not public, and you are not in its room.` });
      } catch (error) {
        return upstream(reply, error);
      }
    }
    const ticket = deps.tickets.issue({ username: me.username, body: deps.bodyOf(me.username), space });
    return reply.header("cache-control", "no-store").send({ ticket, path: spaceEntryPath(space, ticket) });
  });

  /**
   * A SAHA.ING BODY, FOR A SPACE PAGE. Catalogue bodies are CC0 but fetched
   * and cached on demand, so saha.ing only serves them to somebody signed in;
   * a space page has no sign-in, so its ticket for this space stands in for
   * it. (Bodies that ship with saha.ing are plain files at /avatars/.)
   */
  app.get<{ Params: { space: string; file: string }; Querystring: { ticket?: string } }>("/bff/spaces/:space/body/:file", async (request, reply) => {
    const space = spaceKey(request.params.space);
    if (!deps.tickets.read(request.query.ticket, space)) return reply.code(401).send({ code: "NO_TICKET", error: "Enter the space from saha.ing to load bodies." });
    if (!deps.bodyFile) return reply.code(404).send({ code: "NO_BODY_FILE", error: "No bodies here." });
    const result = await deps.bodyFile(request.params.file.replace(/\.vrm$/i, ""));
    if (!result.ok) return reply.code(result.code).send({ code: "NO_BODY_FILE", error: result.error });
    return reply
      .header("content-type", "model/gltf-binary")
      .header("access-control-allow-origin", "*")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(createReadStream(result.path));
  });

  /**
   * WHERE CALLS GO THROUGH, for a space page's voice: the same STUN and TURN
   * relay as saha.ing's own calls (server/space/ice.ts), for a ticket holder.
   */
  app.get<{ Params: { space: string }; Querystring: { ticket?: string } }>("/bff/spaces/:space/ice", async (request, reply) => {
    const space = spaceKey(request.params.space);
    if (!deps.tickets.read(request.query.ticket, space)) return reply.code(401).send({ code: "NO_TICKET", error: "Enter the space from saha.ing to talk." });
    return reply
      .header("access-control-allow-origin", "*")
      .header("cache-control", "no-store")
      .send({ iceServers: iceServersFrom(process.env) });
  });

  /** The published spaces: the lobby's doors. Anyone may ask. */
  app.get("/bff/spaces/public", async (_request, reply) =>
    reply.header("cache-control", "no-store").send({
      spaces: store.publicSpaces().map((space) => ({ name: space.name, title: doorTitle(space.title, space.name), sitePath: `/s/${space.name}/`, here: deps.live.count(space.name) })),
    }));

  /** Publish a space as a public room (a door in the lobby), or take it back. Members only. */
  app.post<{ Params: { space: string }; Body: { public?: unknown; title?: unknown } }>("/bff/spaces/:space/public", async (request, reply) => {
    const found = await memberSpace(request, reply);
    if (!found) return reply;
    const isPublic = request.body?.public === true;
    const title = typeof request.body?.title === "string" ? doorTitle(request.body.title, found.space) : store.publicInfo(found.space).title;
    store.setPublic(found.space, isPublic, title === found.space ? null : title);
    return reply.send(summary(found.record.name, found.record.createdBy, found.record.createdAt));
  });

  // ---------------------------------------------------------------- the workbench

  /**
   * WHAT THE ROOM'S BENCH SHOWS (shared/space-bench.ts): the pieces of the
   * branch the team follows, as it is live right now, with URLs that change
   * on every deploy so the room loads the new version. For the room's members,
   * or anybody signed in when the space is public.
   */
  app.get<{ Params: { space: string } }>("/bff/spaces/:space/bench", async (request, reply) => {
    const me = signedIn(request, reply);
    if (!me) return reply;
    const space = spaceKey(request.params.space);
    if (spaceNameProblem(space) || !store.exists(space)) return reply.code(404).send({ code: "NO_SPACE", error: `There is no space called ${space}.` });
    if (!store.publicInfo(space).public) {
      try {
        if (!(await auth.isMember(me, space))) return reply.code(403).send({ code: "NOT_A_MEMBER", error: `You are not in the room ${space}.` });
      } catch (error) {
        return upstream(reply, error);
      }
    }
    const branch = store.benchBranch(space);
    const live = store.live(space, branch);
    return reply.header("cache-control", "no-store").send({
      space,
      branch,
      deploy: live ? { id: live.id, commit: live.commit, message: live.message, pushedBy: live.pushedBy, createdAt: live.createdAt } : null,
      pieces: (live?.pieces ?? []).map((piece) => ({ ...piece, url: pieceUrl(space, branch, piece.path, live!.id) })),
      problems: live?.piecesProblems ?? [],
    });
  });

  /** Which branch the room's bench follows. Members only. */
  app.post<{ Params: { space: string }; Body: { branch?: unknown } }>("/bff/spaces/:space/bench", async (request, reply) => {
    const found = await memberSpace(request, reply);
    if (!found) return reply;
    const branch = typeof request.body?.branch === "string" ? request.body.branch.trim() : "";
    if (!isPreviewableBranch(branch)) return reply.code(400).send({ code: "BAD_BRANCH", error: "That is not a branch name." });
    store.setBenchBranch(found.space, branch);
    deps.benchChanged?.(found.space);
    return reply.send({ branch });
  });

  // The live socket needs the websocket plugin loaded, so it lives in a plugin
  // of its own (a route added straight onto `app` would be registered before it).
  app.register(async (scope) => {
    scope.get<{ Params: { space: string }; Querystring: { ticket?: string } }>("/bff/spaces/:space/live", { websocket: true }, (socket, request) => {
      const space = spaceKey(request.params.space);
      if (spaceNameProblem(space) || !store.exists(space)) {
        socket.close(4404, "no such space");
        return;
      }
      const holder = deps.tickets.read(request.query.ticket, space);
      // A private team's space shows its people only to people with a ticket.
      if (!holder && !store.publicInfo(space).public) {
        socket.send(JSON.stringify({ t: "refused", why: "This space is not public. Enter it from saha.ing to join." }));
        socket.close(4403, "not public");
        return;
      }
      const seat = deps.live.join(space, socket, holder);
      socket.on("message", (data: Buffer) => seat.receive(data.toString("utf8")));
      socket.on("close", () => seat.leave());
      socket.on("error", () => seat.leave());
    });
  });

  // three.js, served from here so a space needs no outside CDN (some are slow
  // or blocked where our people are): /kit/three/three.module.js,
  // /kit/three/three.core.js and /kit/three/addons/<path> (three/examples/jsm).
  // three exports no package.json; its main entry is build/three.cjs, so the
  // package is two levels up from that.
  const threeRoot = dirname(dirname(createRequire(import.meta.url).resolve("three")));
  app.get("/kit/three/*", async (request, reply) => {
    const rest = siteFile(new URL(request.url, "http://placeholder").pathname.slice("/kit/three".length));
    if (rest === null || !rest.endsWith(".js")) return reply.code(404).send("not found");
    const [dir, file] = rest.startsWith("addons/") ? [join(threeRoot, "examples", "jsm"), rest.slice("addons/".length)] : [join(threeRoot, "build"), rest];
    if (!(await stat(join(dir, file)).catch(() => null))?.isFile()) return reply.code(404).send("not found");
    return reply
      .header("access-control-allow-origin", "*")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("cache-control", "public, max-age=86400")
      .sendFile(file, dir);
  });

  return { queue };
}

function publicDeploy(deploy: StoredDeploy | null): DeployRecord | null {
  if (!deploy) return null;
  const { spa: _spa, ...rest } = deploy;
  return rest as DeployRecord;
}

/**
 * git http-backend, as CGI: the request goes in on stdin with its details in
 * the environment; the answer comes back as CGI headers, a blank line, then
 * the body. Git's own implementation of the protocol, so nothing about
 * pack negotiation is reimplemented here.
 */
function runBackend(request: FastifyRequest, reply: FastifyReply, options: {
  root: string;
  pathInfo: string;
  query: string;
  user: string;
  visitor: string;
  onFinished?: (ok: boolean) => Promise<void>;
}): Promise<void> {
  return new Promise((resolve) => {
    const env: Record<string, string> = {
      GIT_PROJECT_ROOT: join(options.root, "repos"),
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: options.pathInfo,
      REQUEST_METHOD: request.method,
      QUERY_STRING: options.query,
      CONTENT_TYPE: String(request.headers["content-type"] ?? ""),
      REMOTE_USER: options.user,
      REMOTE_ADDR: options.visitor,
      GIT_HTTP_MAX_REQUEST_BUFFER: "100M",
    };
    const length = request.headers["content-length"];
    if (typeof length === "string") env.CONTENT_LENGTH = length;
    const encoding = request.headers["content-encoding"];
    if (typeof encoding === "string") env.HTTP_CONTENT_ENCODING = encoding;
    const protocol = request.headers["git-protocol"];
    if (typeof protocol === "string") env.HTTP_GIT_PROTOCOL = protocol;

    reply.hijack();
    const res = reply.raw;
    const child = spawn("git", ["http-backend"], { env: gitEnv(options.root, env), stdio: ["pipe", "pipe", "pipe"] });
    let head: Buffer | null = Buffer.alloc(0);
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString("utf8").slice(0, 4000); });
    child.stdout.on("data", (chunk: Buffer) => {
      if (head === null) {
        res.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const crlf = head.indexOf("\r\n\r\n");
      const lf = head.indexOf("\n\n");
      const end = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
      if (end < 0) return;
      const skip = end === crlf ? 4 : 2;
      let status = 200;
      for (const line of head.subarray(0, end).toString("latin1").split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === "status") status = Number.parseInt(value, 10) || 200;
        else res.setHeader(name, value);
      }
      res.statusCode = status;
      const body = head.subarray(end + skip);
      head = null;
      if (body.length) res.write(body);
    });
    child.on("error", () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
      resolve();
    });
    child.on("close", (code) => {
      if (head !== null && !res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
        res.write(`git could not answer that request.\n`);
        if (errors) request.log.warn({ errors }, "git http-backend");
      }
      // Queue the deploys BEFORE the push is answered in full, so that by the
      // time git tells the pusher "done" the deploy is already on its way
      // (and a test, or an agent, that checks straight after sees it queued).
      const finished = options.onFinished?.(code === 0) ?? Promise.resolve();
      finished
        .catch((error) => request.log.error({ err: error }, "after push"))
        .finally(() => {
          res.end();
          resolve();
        });
    });

    const body = request.body as Readable | undefined;
    if (request.method === "POST" && body && typeof body.pipe === "function") body.pipe(child.stdin);
    else child.stdin.end();
  });
}
