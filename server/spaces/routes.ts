import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
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
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #14171c; color: #eef0f3; }
  main { max-width: 36rem; padding: 2rem; line-height: 1.6; }
  code { background: #232830; padding: .1rem .35rem; border-radius: 4px; }
</style>
</head>
<body>
<main>
  <h1>${space}</h1>
  <p>This space is live. It was made by ${by}.</p>
  <p>Change this page: <code>git clone</code> the space, edit <code>index.html</code>, then <code>git push</code>.
  It is live here a few seconds later. See README.md in the repository.</p>
</main>
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

## How it deploys

Every push deploys. \`main\` is the space itself; any other branch is a preview at
\`/s/${space}/@<branch>/\`. What is published:

- \`dist/\` if it has an index.html (push your build output), otherwise
- the top of the repo if it has an index.html, or
- the folder named in \`saha-space.json\`: \`{ "publish": "public" }\`.

Add \`"spa": true\` to \`saha-space.json\` to serve index.html for unknown paths (client-side routing).
Nothing runs on the server: a space is files a browser loads.

The page runs sandboxed: it cannot read saha.ing or use its sign-in, and has no
localStorage or cookies of its own.
`,
  },
];

export function registerSpacesHosting(app: FastifyInstance, deps: {
  spacesRoot: string;
  store: SpaceStore;
  auth: SpaceAuth;
  sessionOf: (request: FastifyRequest) => Session | undefined;
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

  const summary = (name: string, createdBy: string, createdAt: string) => ({
    name,
    createdBy,
    createdAt,
    gitPath: `/git/${name}.git`,
    sitePath: `/s/${name}/`,
    live: publicDeploy(store.live(name, LIVE_BRANCH)),
  });

  const deployFor = (space: string, branch: string, commit: string, pushedBy: string) =>
    queue.run(space, () => deployCommit({ root, store, space, branch, commit, pushedBy, now }));

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
    return reply.send({ branch: deploy.branch, live: publicDeploy(deploy) });
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
