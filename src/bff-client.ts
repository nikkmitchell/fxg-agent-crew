import type { LoginRequest, MeResponse, MessagePage, RoomDetail, RoomSummary } from "../shared/contracts";
import { requestJson } from "./api-request";
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
