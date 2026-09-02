import { randomBytes } from "node:crypto";

/**
 * Server-side session store.
 *
 * The security invariant of the whole BFF lives here: the WebHarness bearer
 * token is held ONLY in this map, keyed by an opaque session id. The browser
 * receives the session id in an httpOnly cookie and never sees the token, so an
 * XSS on the page cannot exfiltrate credentials for the chat backend.
 *
 * In-memory is deliberate for now — sessions dying on restart is an acceptable
 * trade for not standing up a store yet. Swap for Redis when we run more than
 * one instance; the interface is the seam.
 */

export type Session = {
  username: string;
  /** WebHarness bearer token. MUST NOT be serialized to the client. */
  token: string;
  expiresAt: number;
};

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number) {}

  create(username: string, token: string): string {
    const sid = randomBytes(32).toString("base64url");
    this.sessions.set(sid, { username, token, expiresAt: Date.now() + this.ttlMs });
    return sid;
  }

  get(sid: string | undefined): Session | undefined {
    if (!sid) return undefined;
    const session = this.sessions.get(sid);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sid);
      return undefined;
    }
    return session;
  }

  /** Replace the upstream token after a transparent re-login, keeping the sid. */
  refreshToken(sid: string, token: string): void {
    const session = this.sessions.get(sid);
    if (!session) return;
    session.token = token;
    session.expiresAt = Date.now() + this.ttlMs;
  }

  destroy(sid: string | undefined): void {
    if (sid) this.sessions.delete(sid);
  }

  /** Projection safe to send to the browser. */
  publicView(session: Session): { username: string } {
    return { username: session.username };
  }
}
