import type { LoginRequest, MeResponse, MessagePage, RoomDetail, RoomSummary } from "../shared/contracts";
import { requestJson } from "./api-request";
import type { SignupChannel, SignupForm } from "../shared/signup";
import type { AgentSummary } from "../shared/agents";
import type { DeployRecord } from "../shared/spaces";
import type { StoredFeedback } from "../shared/space-feedback";
import { base } from "./router";

/**
 * The WebHarness half of saha.ing's API: who you are, which rooms you are in,
 * and what was said in them. Every one of these is a proxy — the server holds
 * your WebHarness token and this never sees it.
 *
 * The request core and the error type are shared with `board-client`; see
 * `api-request.ts` for why there used to be two of each.
 */
const bffRoot = `${base}/bff`;

export const bff = {
  me: (signal?: AbortSignal) => requestJson<MeResponse>(`${bffRoot}/me`, { signal }),

  login: (credentials: LoginRequest, signal?: AbortSignal) => requestJson<MeResponse>(`${bffRoot}/login`, {
    method: "POST",
    body: JSON.stringify(credentials),
    signal,
  }),

  /** Ask WebHarness, through saha.ing, to send a sign-up code (shared/signup.ts). */
  signupCode: (channel: SignupChannel, target: string) => requestJson<{ sent: true }>(`${bffRoot}/signup/code`, {
    method: "POST",
    body: JSON.stringify({ channel, target }),
  }),

  /** Create a WebHarness account and sign in to it, in one step. */
  signup: (form: SignupForm) => requestJson<MeResponse>(`${bffRoot}/signup`, {
    method: "POST",
    body: JSON.stringify(form),
  }),

  /** The agents you own on WebHarness (shared/agents.ts). */
  agents: (signal?: AbortSignal) => requestJson<{ agents: AgentSummary[] }>(`${bffRoot}/agents`, { signal }),

  /** Register an agent under you, from the PUBLIC key it made. */
  createAgent: (username: string, publicKey: string) => requestJson<{ username: string }>(`${bffRoot}/agents`, {
    method: "POST",
    body: JSON.stringify({ username, publicKey }),
  }),

  /** Your spaces, and your rooms that have none yet (shared/spaces.ts). */
  spaces: (signal?: AbortSignal) => requestJson<{ spaces: SpaceListing[]; rooms: string[] }>(`${bffRoot}/spaces`, { signal }),

  makeSpace: (room: string, kind?: "vr" | "flat" | "webxr") => requestJson<SpaceListing>(`${bffRoot}/spaces`, { method: "POST", body: JSON.stringify({ room, kind }) }),

  /** Every public space's pieces, for anyone to use (shared/space-bench.ts catalogueOf). */
  pieces: (signal?: AbortSignal) =>
    requestJson<{ pieces: { space: string; id: string; name: string; kind: string; url: string }[] }>(`${bffRoot}/spaces/pieces`, { signal }),

  /** What testers said about a space (newest first), for its room's members. */
  spaceFeedback: (name: string, branch?: string, signal?: AbortSignal) =>
    requestJson<{ feedback: StoredFeedback[] }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/feedback${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`, { signal }),

  /** Merge a branch into main (or `into`) on the box; the result deploys. */
  mergeBranch: (name: string, from: string, into = "main") =>
    requestJson<{ how: "already" | "fast-forward" | "merged"; commit: string }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/merge`, {
      method: "POST",
      body: JSON.stringify({ from, into }),
    }),

  /** The code browser (Sill's plan, F): members only, read only. `ref` is a branch or a commit id. */
  codeTree: (name: string, ref: string) =>
    requestJson<{ ref: string; commit: string; files: { path: string; size: number }[] }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/code/tree?ref=${encodeURIComponent(ref)}`),
  codeFile: (name: string, ref: string, path: string) =>
    requestJson<{ path: string; size: number; binary: boolean; text: string | null }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/code/file?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`),
  codeLog: (name: string, ref: string) =>
    requestJson<{ ref: string; commits: { sha: string; author: string; at: string; message: string }[] }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/code/log?ref=${encodeURIComponent(ref)}`),
  codeCommit: (name: string, sha: string) =>
    requestJson<{ sha: string; author: string; at: string; message: string; files: { path: string; added: number | null; removed: number | null }[]; patch: string; cut: boolean }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/code/commit?ref=${encodeURIComponent(sha)}`),

  space: (name: string, signal?: AbortSignal) =>
    requestJson<SpaceDetail>(`${bffRoot}/spaces/${encodeURIComponent(name)}`, { signal }),

  /** Close every seat you hold in every space, on every device (Baiwei, 6395). */
  leaveEverySpace: () => requestJson<{ left: number }>(`${bffRoot}/spaces/leave-everywhere`, { method: "POST", body: "{}" }),

  /** The published spaces: the lobby's space doors. */
  publicSpaces: (signal?: AbortSignal) =>
    requestJson<{ spaces: { name: string; title: string; sitePath: string; here: number }[] }>(`${bffRoot}/spaces/public`, { signal }),

  /** Every space you can bring things from: your rooms' spaces first, then the public ones. */
  spaceLibrary: (signal?: AbortSignal) =>
    requestJson<{ spaces: SpaceShelf[] }>(`${bffRoot}/spaces/library`, { signal }),

  /** The items, environments and spaces a branch of a space offers (its followed branch unless named). */
  spaceModules: (name: string, branch?: string, signal?: AbortSignal, deploy?: string) =>
    requestJson<SpaceModules>(`${bffRoot}/spaces/${encodeURIComponent(name)}/modules${deploy ? `?deploy=${encodeURIComponent(deploy)}` : branch ? `?branch=${encodeURIComponent(branch)}` : ""}`, { signal }),

  /** A ticket into a space as yourself; open `path` to arrive with it. */
  spaceTicket: (name: string) =>
    requestJson<{ ticket: string; path: string }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/ticket`, { method: "POST" }),

  /** Publish a space as a public room with a lobby door, or take it back. */
  publishSpace: (name: string, isPublic: boolean, title?: string) =>
    requestJson<SpaceListing>(`${bffRoot}/spaces/${encodeURIComponent(name)}/public`, { method: "POST", body: JSON.stringify({ public: isPublic, title }) }),

  /** Which branch the room's workbench follows (shared/space-bench.ts). */
  benchBranch: (name: string, branch: string) =>
    requestJson<{ branch: string }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/bench`, { method: "POST", body: JSON.stringify({ branch }) }),

  /** Serve an earlier (or later) deploy on its branch: rolling back. */
  makeLive: (name: string, deployId: string) =>
    requestJson<{ branch: string; live: DeployRecord }>(`${bffRoot}/spaces/${encodeURIComponent(name)}/live`, { method: "POST", body: JSON.stringify({ deployId }) }),

  logout: (signal?: AbortSignal) => requestJson<{ ok: true }>(`${bffRoot}/logout`, { method: "POST", signal }),

  rooms: (signal?: AbortSignal) => requestJson<RoomSummary[]>(`${bffRoot}/rooms`, { signal }),

  publicRooms: (signal?: AbortSignal) => requestJson<RoomSummary[]>(`${bffRoot}/rooms/public`, { signal }),

  joinRoom: (roomName: string, password?: string) =>
    requestJson<{ roomName: string; joined: boolean }>(`${bffRoot}/rooms/${encodeURIComponent(roomName)}/join`, {
      method: "POST",
      body: JSON.stringify(password ? { password } : {}),
    }),

  createRoom: (roomName: string, visibility: "public" | "private", password?: string) =>
    requestJson<{ roomName: string; created: true }>(`${bffRoot}/rooms/create`, {
      method: "POST",
      body: JSON.stringify({ roomName, visibility, ...(password ? { password } : {}) }),
    }),

  enterSpaceRoom: (roomName: string) =>
    requestJson<{ roomName: string }>(`${bffRoot}/space/enter`, {
      method: "POST",
      body: JSON.stringify({ roomName }),
    }),

  currentSpaceRoom: (signal?: AbortSignal) =>
    requestJson<{ roomName: string }>(`${bffRoot}/space/room`, { signal }),

  room: (roomName: string, signal?: AbortSignal) =>
    requestJson<RoomDetail>(`${bffRoot}/rooms/${encodeURIComponent(roomName)}`, { signal }),

  messages: (roomName: string, options: { afterId?: number; wait?: number; signal?: AbortSignal } = {}) => {
    const query = new URLSearchParams();
    if (options.afterId !== undefined) query.set("afterId", String(options.afterId));
    if (options.wait !== undefined) query.set("wait", String(options.wait));
    const suffix = query.size ? `?${query}` : "";
    return requestJson<MessagePage>(`${bffRoot}/rooms/${encodeURIComponent(roomName)}/messages${suffix}`, { signal: options.signal });
  },

  /** `key`: a retry of the same message is posted once (server/idempotency.ts). */
  sendMessage: (roomName: string, content: string, signal?: AbortSignal, key?: string) =>
    requestJson<import("../shared/contracts").Message>(`${bffRoot}/rooms/${encodeURIComponent(roomName)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
      signal,
      ...(key ? { headers: { "idempotency-key": key } } : {}),
    }),
};

export type SpaceListing = { name: string; createdBy: string; createdAt: string; gitPath: string; sitePath: string; live: DeployRecord | null; public: boolean; title: string | null; here: number; benchBranch?: string };
export type SpaceDetail = {
  space: SpaceListing;
  branches: { branch: string; head: string | null; sitePath: string; live: DeployRecord | null }[];
  deploys: DeployRecord[];
};

/** A space the library offers things from (GET /bff/spaces/library). */
export type SpaceShelf = { name: string; title: string; public: boolean; mine: boolean; branch: string };

/** One thing a space offers to bring into a room. */
export type SpaceModule = { id: string; name: string; kind: "item" | "environment" | "space"; export: string | null; url: string };

/** What one branch of a space offers (GET /bff/spaces/:space/modules). */
export type SpaceModules = {
  space: string;
  branch: string;
  branches: string[];
  /** bytes: everything the deploy holds, which is the most anybody may download for its things. */
  deploy: { id: string; commit: string; message: string; pushedBy: string; createdAt: string; bytes?: number } | null;
  modules: SpaceModule[];
  problems: string[];
};
