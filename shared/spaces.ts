/**
 * SPACES: OUR OWN GIT AND DEPLOY, ONE PER ROOM (Nikk, 6148, 6150).
 *
 * "allow for a created project/room, like meditation.ar to have its own
 * gitspace to control source, and its own deploy space, so a team can be
 * working on something new and not touch our main saha.ing ... like our own
 * version of github and netlify, where agents can directly access and manage
 * their projects without touching our main file."
 *
 * What Nikk chose (6150), and so what this is:
 *  1. A space is a web page: HTML/JS/three.js/WebXR, anything that runs in the
 *     browser. No server code of its own runs on our box.
 *  2. The team builds on their own machines and pushes the built files; the
 *     host serves what is in the repo, as it is. No build step here.
 *  3. It lives at saha.ing/s/<space>/, and a branch other than main at
 *     saha.ing/s/<space>/@<branch>/.
 *  4. The team is the members of the WebHarness room of the same name, people
 *     and agents, signing in with the login they already have.
 *  5. meditation.AR moves onto it later, as its own step.
 *
 * Git is at saha.ing/git/<space>.git (clone, pull, push over HTTPS).
 */

/** A space is named after its room, the way rooms are keyed everywhere (space-room.ts). */
export function spaceKey(room: string): string {
  return room.trim().toLowerCase();
}

/** Letters, digits, dot, underscore, hyphen; starting with a letter or digit; 1 to 64. */
const SPACE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function spaceNameProblem(name: string): string | null {
  if (!SPACE_NAME.test(name)) return "A space name is its room's name: letters, digits, . _ - only, up to 64.";
  if (name.endsWith(".git") || name.includes("..")) return "That name cannot be a space.";
  return null;
}

/** Branches that get a preview; the same rule git uses, narrowed to what fits in a URL. */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isPreviewableBranch(branch: string): boolean {
  return BRANCH.test(branch) && !branch.includes("..") && !branch.endsWith(".lock");
}

/** The branch that is the space itself; every other branch is a preview. */
export const LIVE_BRANCH = "main";

/**
 * WHICH FOLDER OF THE REPO IS THE SITE. A team that builds with a bundler
 * pushes dist/; a hand-written page is just index.html at the top. Say so
 * explicitly with saha-space.json { "publish": "public" } when it is neither.
 */
export type SpaceSettings = { publish?: string; spa?: boolean };

export function publishDir(files: ReadonlySet<string>, settings: SpaceSettings | null): { dir: string } | { problem: string } {
  if (settings?.publish !== undefined) {
    const dir = normaliseDir(settings.publish);
    if (dir === null) return { problem: `saha-space.json "publish" must be a folder inside the repo, not ${JSON.stringify(settings.publish)}.` };
    return files.has(dir ? `${dir}/index.html` : "index.html") ? { dir } : { problem: `saha-space.json says to publish "${dir || "."}", but there is no ${dir ? `${dir}/` : ""}index.html.` };
  }
  if (files.has("dist/index.html")) return { dir: "dist" };
  if (files.has("index.html")) return { dir: "" };
  return { problem: "Nothing to publish: put an index.html at the top of the repo or in dist/, or name the folder in saha-space.json." };
}

/** "public/", "./public", "public" -> "public"; "." or "" -> ""; anything escaping the repo -> null. */
export function normaliseDir(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === ".." || part.startsWith("."))) return null;
  return parts.join("/");
}

export function parseSettings(text: string | null): SpaceSettings | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object") return null;
    const { publish, spa } = value as Record<string, unknown>;
    return { publish: typeof publish === "string" ? publish : undefined, spa: spa === true };
  } catch {
    return null;
  }
}

/**
 * THE FILE A REQUEST NAMES, inside a deploy, or null if it names something
 * outside it. A URL is somebody else's input; ".." and encoded tricks stop here.
 */
export function siteFile(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const parts = decoded.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === "..")) return null;
  const file = parts.join("/");
  return decoded.endsWith("/") || file === "" ? (file ? `${file}/index.html` : "index.html") : file;
}

/** How big one deploy may be. The box has 39 GB for everything, saha.ing included. */
export const DEPLOY_LIMITS = { bytes: 300 * 1024 * 1024, files: 20_000, keepPerBranch: 10 } as const;

export type DeployRecord = {
  id: string;
  space: string;
  branch: string;
  commit: string;
  message: string;
  author: string;
  pushedBy: string;
  createdAt: string;
  status: "live" | "ready" | "failed" | "retired";
  problem: string | null;
  files: number;
  bytes: number;
};

export type SpaceSummary = {
  name: string;
  createdBy: string;
  createdAt: string;
  gitUrl: string;
  liveUrl: string;
  live: DeployRecord | null;
};

export function gitUrl(origin: string, space: string): string {
  return `${origin}/git/${space}.git`;
}

export function siteUrl(origin: string, space: string, branch = LIVE_BRANCH): string {
  return branch === LIVE_BRANCH ? `${origin}/s/${space}/` : `${origin}/s/${space}/@${branch}/`;
}
