/**
 * Wire contracts shared by the BFF and the UI.
 *
 * Nothing in here carries a WebHarness bearer token. That is deliberate and is
 * enforced by server/__tests__/session.test.ts: the upstream token lives only in
 * the server-side session, and the browser holds an opaque httpOnly cookie.
 */

export type LoginRequest = {
  username: string;
  password: string;
};

/** What the page learns about its own session. Note the absence of a token. */
export type MeResponse = {
  username: string;
};

export type RoomSummary = {
  roomName: string;
  ownerName: string;
  visibility: "public" | "private";
  unreadCount?: number;
};

export type OnlineUser = {
  username: string;
  lastSeenAt: string;
};

export type RoomDetail = {
  roomName: string;
  ownerName: string;
  onlineUsers: OnlineUser[];
  onlineCount: number;
  isOwner: boolean;
  muted: boolean;
  myPermissions?: { canSpeak?: boolean; canUpload?: boolean };
};

export type Message = {
  id: number;
  username: string;
  content: string;
  msgType: string;
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
};

export type MessagePage = {
  roomName: string;
  messages: Message[];
  /** Highest id in this page; feed straight back as `afterId`. */
  cursor: number | null;
};

/**
 * Stable error codes for the UI to switch on.
 *
 * These exist because HTTP status alone cannot carry the distinctions the UX
 * needs: upstream answers 403 for "not a member", "muted", and "no upload
 * rights" alike, and those are three different screens. Binding a state machine
 * to a status number would either collapse them or force the client to
 * pattern-match on human-readable (and Chinese-localised) detail strings.
 */
export type BffErrorCode =
  /** No session, or the session's upstream token is genuinely dead. Sign in again. */
  | "SESSION_EXPIRED"
  /** Credentials rejected by upstream. Distinct from an expired session. */
  | "INVALID_CREDENTIALS"
  /** No room by that name. Do not offer to create it. */
  | "ROOM_NOT_FOUND"
  /** Room exists but the caller has not joined it. */
  | "NOT_A_MEMBER"
  /** Room exists and needs a password to join. Prompt for it. */
  | "ROOM_PASSWORD_REQUIRED"
  /** Caller is in the room but may not speak. Render read-only, not an error. */
  | "MUTED"
  /** Room archived or ended. History lives under /api/archives. */
  | "ROOM_ARCHIVED"
  /** Malformed request from us — a bug, not a user-facing state. */
  | "BAD_REQUEST"
  /** WebHarness unreachable or erroring. Retryable; keep showing stale data. */
  | "UPSTREAM_UNAVAILABLE";

export type BffError = {
  /** Stable and switchable. Prefer this over `error` for control flow. */
  code: BffErrorCode;
  /** Human-readable detail. For display and logs, never for branching. */
  error: string;
  /**
   * True only when re-authenticating will actually help. Set after the upstream
   * retry, so a transient server-side auth flake does not bounce a signed-in
   * human to the login screen.
   */
  reauth?: boolean;
};
