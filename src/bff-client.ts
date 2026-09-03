import type { BffError, LoginRequest, MeResponse, MessagePage, RoomDetail, RoomSummary } from "../shared/contracts";

type ErrorBody = BffError & { code?: string };

export class BffRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly reauth: boolean,
  ) {
    super(message);
    this.name = "BffRequestError";
  }

  get retryable(): boolean {
    return this.code === "UPSTREAM_UNAVAILABLE" || this.status >= 500;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const body = await response.json().catch(() => undefined) as T | ErrorBody | undefined;
  if (!response.ok) {
    const error = body as ErrorBody | undefined;
    throw new BffRequestError(
      error?.error ?? `request failed (${response.status})`,
      response.status,
      error?.code ?? (response.status === 401 ? "SESSION_EXPIRED" : "UNKNOWN"),
      error?.reauth ?? false,
    );
  }
  return body as T;
}

export const bff = {
  me: (signal?: AbortSignal) => requestJson<MeResponse>("/bff/me", { signal }),

  login: (credentials: LoginRequest, signal?: AbortSignal) => requestJson<MeResponse>("/bff/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    signal,
  }),

  logout: (signal?: AbortSignal) => requestJson<{ ok: true }>("/bff/logout", { method: "POST", signal }),

  rooms: (signal?: AbortSignal) => requestJson<RoomSummary[]>("/bff/rooms", { signal }),

  room: (roomName: string, signal?: AbortSignal) =>
    requestJson<RoomDetail>(`/bff/rooms/${encodeURIComponent(roomName)}`, { signal }),

  messages: (roomName: string, options: { afterId?: number; wait?: number; signal?: AbortSignal } = {}) => {
    const query = new URLSearchParams();
    if (options.afterId !== undefined) query.set("afterId", String(options.afterId));
    if (options.wait !== undefined) query.set("wait", String(options.wait));
    const suffix = query.size ? `?${query}` : "";
    return requestJson<MessagePage>(`/bff/rooms/${encodeURIComponent(roomName)}/messages${suffix}`, { signal: options.signal });
  },

  sendMessage: (roomName: string, content: string, signal?: AbortSignal) =>
    requestJson<import("../shared/contracts").Message>(`/bff/rooms/${encodeURIComponent(roomName)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
      signal,
    }),
};
