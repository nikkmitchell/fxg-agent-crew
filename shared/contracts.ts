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

export type BffError = {
  error: string;
  /** True when the caller should re-authenticate rather than retry. */
  reauth?: boolean;
};
