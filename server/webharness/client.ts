/**
 * Typed wrapper around the WebHarness HTTP API.
 *
 * Two behaviours here are not incidental:
 *
 * 1. RETRY ON A SINGLE 401. During roughly three hours of agent polling
 *    against one deployment, an uncounted but repeated number of logins
 *    returned 401 ("签名验证失败" or "challenge 不存在或已过期") and then
 *    succeeded on an immediate retry with the same key; one observed cycle
 *    needed three attempts.
 *
 *    The CAUSE IS NOT ESTABLISHED. It is tempting to call it a nonce/validation
 *    race, but that agent's key later stopped verifying altogether, and the
 *    account may have had overlapping key registrations — so credential or
 *    identity confusion is at least as plausible as anything server-side, and
 *    the sample was never counted properly. What is observed is the retry
 *    behaviour, not the reason for it.
 *
 * *    The retry is justified by consequence rather than by diagnosis: treating a
 *    first 401 as "session invalid" would sign people out on a transient
 *    failure we have seen happen, and one extra request is cheap.
 *
 *    RETRY IS RESTRICTED TO REQUESTS THAT CAN SAFELY BE REPEATED — methods with
 *    safe semantics, plus an explicit per-call opt-in currently used only by
 *    login. A
 *    401 says the response was rejected, not that the server did no work, so
 *    blindly repeating a POST could duplicate a write. A duplicated mutation is
 *    worse than an extra sign-in prompt. Everything else surfaces the 401 at
 *    once, and a second consecutive 401 always means re-auth.
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
  /**
   * Opt a non-idempotent request into the single 401 retry.
   *
   * Off by default and deliberately explicit. Retrying an arbitrary POST is not
   * safe in general: a 401 tells us the response was rejected, not that the
   * server did no work, and a retried create can duplicate. Set this only where
   * repeating the call has been reasoned about — currently just login, where a
   * rejected attempt leaves nothing behind.
   */
  retryUnsafeOn401?: boolean;
};

/**
 * Methods with SAFE semantics — ones where the client is not asking the server
 * to change anything, so re-sending is not a request to do the work twice.
 *
 * Deliberately not called IDEMPOTENT: in HTTP terms PUT and DELETE are also
 * idempotent, but they are excluded here on purpose. Idempotency is a promise
 * about the END STATE after repeats, which does not tell us it is safe to
 * resend when we cannot see whether the first attempt was applied.
 *
 * Nor is "safe" a claim that these are literally side-effect-free — a GET may
 * log, count, or touch a last-seen timestamp. It means the request does not ASK
 * for a change, which is the property that makes repeating it acceptable here.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class WebharnessClient {
  constructor(private readonly baseUrl: string) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const attempt = () => this.rawRequest<T>(path, options);
    const method = (options.method ?? "GET").toUpperCase();
    const mayRetry = SAFE_METHODS.has(method) || options.retryUnsafeOn401 === true;

    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof WebharnessError) || error.status !== 401) throw error;

      // A 401 on a request we cannot safely repeat is surfaced immediately.
      // Retrying a mutation would risk duplicating it, and a duplicated write
      // is worse than an extra sign-in prompt.
      if (!mayRetry) throw new WebharnessError(401, error.detail, true);

      try {
        return await attempt();
      } catch (retryError) {
        if (retryError instanceof WebharnessError && retryError.status === 401) {
          throw new WebharnessError(401, retryError.detail, true);
        }
        throw retryError;
      }
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
  /**
   * Send a voice message: the recording, and the words the browser heard.
   *
   * NOT THROUGH `rawRequest`, which sets `Content-Type: application/json` and
   * stringifies its body. This is multipart with a file in it, and the boundary
   * has to be the one `fetch` generates for this exact FormData — a hand-set
   * content type here produces a body the server cannot parse.
   *
   * NOT RETRIED ON 401 either, and that is the same rule as every other write:
   * a repeat could post the message twice, and a duplicated voice note is worse
   * than being asked to sign in again.
   *
   * WHY SAHA.ING CARRIES THIS AT ALL rather than the browser posting straight
   * to WebHarness: the WebHarness token lives on this server, keyed to the
   * session cookie. A browser that could upload directly would need the token,
   * and then a headset would be holding a credential it has no way to protect.
   */
  async sendVoice(
    token: string,
    room: string,
    voice: { audio: Buffer; filename: string; contentType: string; text: string; durationMs: number },
  ): Promise<unknown> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(voice.audio)], { type: voice.contentType }),
      voice.filename,
    );
    // Sent even when empty. An empty transcript with audio attached is a real
    // and useful outcome — "I said something and the recogniser did not catch
    // it" — and it is exactly the case where the recording matters most.
    form.append("text", voice.text);
    form.append("durationMs", String(Math.round(voice.durationMs)));

    const response = await fetch(
      `${this.baseUrl}/api/rooms/${encodeURIComponent(room)}/voice`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
    );
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const parsed = (await response.json()) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        /* keep statusText */
      }
      throw new WebharnessError(response.status, detail);
    }
    return await response.json();
  }

  async login(username: string, password: string): Promise<string> {
    const result = await this.request<{ token: string }>("/api/login", {
      method: "POST",
      body: { username, password },
      // Safe to repeat: a rejected login leaves no state behind, and this is
      // the request where the transient 401s were actually observed.
      retryUnsafeOn401: true,
    });
    return result.token;
  }

  /**
   * Who does upstream think this bearer token belongs to?
   *
   * This is the whole of agent authentication in the BFF. An agent already
   * holds a token, issued to it on its own machine; this asks WebHarness
   * whether that token is currently valid and, if so, for whom. Upstream
   * remains the only authority on identity — the BFF verifies nothing itself
   * and stores no key material.
   *
   * Deliberately NOT a login: it mints no credential and can only ever confirm
   * something the caller already had. A token upstream rejects gets a 401 here
   * for the same reason a bad password does.
   */
  async whoami(token: string): Promise<string> {
    return (await this.identify(token)).username;
  }

  /**
   * Whose token this is, and whether upstream registered that account as an
   * agent or a person.
   *
   * The kind is WebHarness's own record, not anything the caller said about
   * itself. `null` when upstream gives no kind we recognise, so an unfamiliar
   * value is never guessed into one.
   */
  async identify(token: string): Promise<{ username: string; kind: "human" | "agent" | null }> {
    const result = await this.request<{ username: string; kind?: unknown }>("/api/me", { token });
    const kind = result.kind === "agent" || result.kind === "human" ? result.kind : null;
    return { username: result.username, kind };
  }
}
