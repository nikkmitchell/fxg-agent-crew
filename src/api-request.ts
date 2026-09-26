/**
 * One way to call saha.ing's own API.
 *
 * There were two, near-identical and subtly different: `bff-client.ts` had
 * `requestJson` and `board-client.ts` had `call`. Both built a URL from
 * `BASE_URL`, set a content type only when there was a body, parsed JSON,
 * and threw a custom error carrying a code, a sentence and a status. They
 * disagreed on three things and every disagreement was a hazard rather than a
 * decision:
 *
 *   - One passed `credentials: "same-origin"` explicitly and the other relied
 *     on the default. Same behaviour today; different behaviour the day
 *     somebody moves the API to another host.
 *   - One handled 204 and the other would have thrown on it.
 *   - Their error constructors took the SAME three values IN A DIFFERENT ORDER,
 *     which is the kind of thing that swaps a status code for an error code at
 *     four in the morning.
 *
 * One core, one error, both behaviours kept.
 */

/**
 * A refusal from our own server, as the server wrote it.
 *
 * The sentence is kept verbatim: it was written for a person and says what to
 * do next, which "something went wrong" does not. The code is what UI branches
 * on, because an HTTP status cannot tell "not a member" from "muted".
 */
import { callOverSocket } from "./call-socket";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /**
     * The server's own judgement that signing in again would help.
     *
     * Nothing reads this yet. It is carried rather than dropped because the
     * server goes to the trouble of distinguishing "your session expired" from
     * "you may not do that", and throwing that away here would mean the
     * distinction has to be rediscovered from the status code later.
     */
    readonly reauth: boolean = false,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Worth trying again unchanged. Not the same as "the user should retry". */
  get retryable(): boolean {
    return this.code === "UPSTREAM_UNAVAILABLE" || this.status >= 500;
  }
}

type Refusal = { code?: string; error?: string; reauth?: boolean };

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  // DOWN THE ROOM'S OPEN SOCKET when there is one (call-socket.ts), with the
  // same answer a web request would give; the web request otherwise.
  const tunnelled = await callOverSocket(path, init);
  if (tunnelled) return readAnswer<T>(tunnelled.status, () => Promise.resolve(parseOrUndefined(tunnelled.body)));
  const response = await fetch(path, {
    ...init,
    // Explicit rather than relying on the default, so that moving the API to
    // another origin fails loudly instead of silently dropping the cookie.
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  return readAnswer<T>(response.status, () => response.json().catch(() => undefined));
}

function parseOrUndefined(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** One status and body, from the web or the socket, into a value or an ApiError. */
async function readAnswer<T>(status: number, read: () => Promise<unknown>): Promise<T> {
  // 204 has no body to parse. The board API uses it for deletes.
  if (status === 204) return undefined as T;

  const body = (await read()) as T | Refusal | undefined;
  const response = { ok: status >= 200 && status < 300, status };
  if (!response.ok) {
    const refusal = body as Refusal | undefined;
    throw new ApiError(
      refusal?.error ?? `the server refused this (${response.status})`,
      response.status,
      refusal?.code ?? (response.status === 401 ? "SESSION_EXPIRED" : "UNKNOWN"),
      refusal?.reauth ?? false,
    );
  }
  return body as T;
}
