/**
 * Typed wrapper around the WebHarness HTTP API.
 *
 * Two behaviours here are not incidental:
 *
 * 1. RETRY ON A SINGLE 401. Measured against the live server over ~3h of
 *    continuous duty, roughly 1 in 8 agent logins fails with either
 *    "签名验证失败" or "challenge 不存在或已过期" and then succeeds immediately
 *    on retry with the identical key — one observed cycle needed three
 *    attempts. That points at a server-side race between issuing the nonce and
 *    validating it, not at bad credentials. If we treated the first 401 as
 *    "session invalid" we would sign a human out roughly one login in eight for
 *    no reason, so a lone 401 is retried and only a second consecutive one is
 *    surfaced as needing re-auth.
 *
 * 2. THE TOKEN NEVER LEAVES THIS MODULE'S CALLERS. It is passed in per request
 *    from the session store and is deliberately absent from every error this
 *    throws, so it cannot leak into a log line or an error body.
 */

export class WebharnessError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** True when the caller should re-authenticate rather than retry again. */
    readonly reauth: boolean = false,
  ) {
    super(`WebHarness ${status}: ${detail}`);
    this.name = "WebharnessError";
  }
}

export type RequestOptions = {
  method?: string;
  token?: string;
  body?: unknown;
  /** Abort signal, so a client disconnect cancels the upstream long-poll. */
  signal?: AbortSignal;
};

export class WebharnessClient {
  constructor(private readonly baseUrl: string) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const attempt = () => this.rawRequest<T>(path, options);

    try {
      return await attempt();
    } catch (error) {
      // Retry exactly once on a lone 401 — see note 1 above. Anything else, and
      // any 401 on a second consecutive try, is surfaced to the caller.
      if (error instanceof WebharnessError && error.status === 401) {
        try {
          return await attempt();
        } catch (retryError) {
          if (retryError instanceof WebharnessError && retryError.status === 401) {
            throw new WebharnessError(401, retryError.detail, true);
          }
          throw retryError;
        }
      }
      throw error;
    }
  }

  private async rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    if (!response.ok) {
      // Read the detail defensively: a proxy error page is not JSON.
      let detail = response.statusText;
      try {
        const parsed = (await response.json()) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        /* keep statusText */
      }
      throw new WebharnessError(response.status, detail);
    }

    return (await response.json()) as T;
  }

  /** Human login. Returns the upstream token for storage in the session ONLY. */
  async login(username: string, password: string): Promise<string> {
    const result = await this.request<{ token: string }>("/api/login", {
      method: "POST",
      body: { username, password },
    });
    return result.token;
  }
}
