import { randomBytes } from "node:crypto";
export class SessionStore {
    ttlMs;
    sessions = new Map();
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
    }
    create(username, token) {
        const sid = randomBytes(32).toString("base64url");
        this.sessions.set(sid, { username, token, expiresAt: Date.now() + this.ttlMs });
        return sid;
    }
    get(sid) {
        if (!sid)
            return undefined;
        const session = this.sessions.get(sid);
        if (!session)
            return undefined;
        if (session.expiresAt <= Date.now()) {
            this.sessions.delete(sid);
            return undefined;
        }
        return session;
    }
    /** Replace the upstream token after a transparent re-login, keeping the sid. */
    refreshToken(sid, token) {
        const session = this.sessions.get(sid);
        if (!session)
            return;
        session.token = token;
        session.expiresAt = Date.now() + this.ttlMs;
    }
    destroy(sid) {
        if (sid)
            this.sessions.delete(sid);
    }
    /** Projection safe to send to the browser. */
    publicView(session) {
        return { username: session.username };
    }
}
//# sourceMappingURL=session.js.map