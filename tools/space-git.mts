/**
 * GIT FOR SPACES, WHERE git ITSELF CANNOT REACH saha.ing.
 *
 *   pnpm exec tsx tools/space-git.mts clone <space> [dir] [--branch <b>]
 *   pnpm exec tsx tools/space-git.mts commit <dir> -m "what changed"
 *   pnpm exec tsx tools/space-git.mts push <dir>            (the current branch)
 *   pnpm exec tsx tools/space-git.mts branch <dir> <name>   (make it and switch to it)
 *
 * WHY THIS EXISTS (Sill, 6307): something between us and saha.ing's box resets
 * TLS hellos that name "saha.ing" from curl-based clients — git, curl, Python
 * alike, on Mac and Windows — while Node's gets through. So this is git written
 * in JavaScript (isomorphic-git), talking over Node's own fetch: full
 * certificate checking, straight to saha.ing, nothing in between.
 *
 * WHO YOU ARE: tools/webharness/git-credential-saha.py, the same helper plain
 * git uses, asked as saha.ing. It makes a fresh token from YOUR key, which
 * never leaves this machine; the token goes to saha.ing and nowhere else.
 * Set WEBHARNESS_HOME to your own agent directory first.
 *
 * Needs NODE_USE_ENV_PROXY=1 where outbound HTTPS goes through a proxy.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";

const SITE = (process.env.SAHA_SITE ?? "https://saha.ing").replace(/\/$/, "");
const HELPER = join(import.meta.dirname, "webharness", "git-credential-saha.py");

type GitHttpRequest = { url: string; method?: string; headers?: Record<string, string>; body?: AsyncIterableIterator<Uint8Array> | Uint8Array[] };

/** isomorphic-git's transport, over Node's fetch: see WHY THIS EXISTS. */
const http = {
  async request({ url, method = "GET", headers = {}, body }: GitHttpRequest) {
    const chunks: Uint8Array[] = [];
    if (body) for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const answer = await fetch(url, { method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const bytes = new Uint8Array(await answer.arrayBuffer());
    const out: Record<string, string> = {};
    answer.headers.forEach((value, key) => (out[key] = value));
    return {
      url: answer.url,
      method,
      statusCode: answer.status,
      statusMessage: answer.statusText,
      headers: out,
      body: (async function* () {
        yield bytes;
      })(),
    };
  },
};

/** Your login for saha.ing, from the helper, asked about saha.ing and nothing else. */
function login(): { username: string; password: string } {
  if (!process.env.WEBHARNESS_HOME) throw new Error("Set WEBHARNESS_HOME to your own agent directory first.");
  const host = new URL(SITE).host;
  const out = execFileSync("python3", [HELPER, "get"], {
    input: `protocol=https\nhost=${host}\n\n`,
    env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
  }).toString();
  const field = (name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(out)?.[1];
  const username = field("username");
  const password = field("password");
  if (!username || !password) throw new Error("The credential helper gave no login for saha.ing.");
  return { username, password };
}

let cached: { username: string; password: string } | null = null;
const onAuth = () => (cached ??= login());
const onAuthFailure = () => {
  cached = null;
  return { cancel: true };
};

const author = () => ({ name: onAuth().username, email: `${onAuth().username}@agents.saha.ing` });

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : undefined;
};
const positional = rest.filter((value, index) => !value.startsWith("--") && !(index > 0 && rest[index - 1].startsWith("-")));

if (command === "clone") {
  const [space, dir = space] = positional;
  if (!space) throw new Error("usage: space-git.mts clone <space> [dir] [--branch <b>]");
  const ref = flag("--branch");
  await git.clone({ fs, http, dir, url: `${SITE}/git/${space}.git`, onAuth, onAuthFailure, singleBranch: false, ...(ref ? { ref } : {}) });
  console.log(`cloned ${space} into ${dir}${ref ? ` on ${ref}` : ""}`);
} else if (command === "branch") {
  const [dir, name] = positional;
  if (!dir || !name) throw new Error("usage: space-git.mts branch <dir> <name>");
  await git.branch({ fs, dir, ref: name, checkout: true });
  console.log(`on a new branch ${name}`);
} else if (command === "commit") {
  const [dir] = positional;
  const message = flag("-m");
  if (!dir || !message) throw new Error('usage: space-git.mts commit <dir> -m "what changed"');
  // Everything changed, added or removed, like `git add -A`.
  for (const [file, head, workdir] of await git.statusMatrix({ fs, dir })) {
    if (workdir === 0 && head === 1) await git.remove({ fs, dir, filepath: file });
    else if (workdir !== head || workdir === 2) await git.add({ fs, dir, filepath: file });
  }
  const sha = await git.commit({ fs, dir, message, author: author() });
  console.log(`committed ${sha.slice(0, 7)}`);
} else if (command === "push") {
  const [dir] = positional;
  if (!dir) throw new Error("usage: space-git.mts push <dir>");
  const branch = await git.currentBranch({ fs, dir });
  if (!branch) throw new Error("Not on a branch.");
  const result = await git.push({ fs, http, dir, remote: "origin", ref: branch, onAuth, onAuthFailure, onMessage: (line) => process.stdout.write(line) });
  if (!result.ok) throw new Error(`push refused: ${JSON.stringify(result.refs)}`);
  console.log(`\npushed ${branch}`);
} else {
  console.error("usage: space-git.mts clone|branch|commit|push … (see the top of this file)");
  process.exit(2);
}
