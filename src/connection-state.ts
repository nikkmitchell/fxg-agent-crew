import type { Message, RoomDetail, RoomSummary } from "../shared/contracts";

export type ConnectionPhase =
  | "checking_session"
  | "signed_out"
  | "loading_rooms"
  | "selecting_room"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "read_only";

export type ConnectionState = {
  phase: ConnectionPhase;
  username?: string;
  /**
   * Human or agent. Undefined means the server did not say, which is shown as
   * unknown rather than assumed — an unlabelled session is not evidence of a
   * human one.
   */
  kind?: "human" | "agent";
  rooms: RoomSummary[];
  roomName?: string;
  room?: RoomDetail;
  messages: Message[];
  lastCursor?: number;
  attempt: number;
  errorCode?: string;
  notice?: string;
  stale: boolean;
  outbox: Array<{
    clientId: string;
    content: string;
    state: "queued" | "pending" | "acknowledged" | "failed";
    errorCode?: string;
  }>;
};

export type ConnectionEvent =
  | { type: "SESSION_MISSING"; code?: string }
  | { type: "SESSION_READY"; username: string; kind?: "human" | "agent" }
  | { type: "LOGIN_STARTED" }
  | { type: "LOGIN_SUCCEEDED"; username: string; kind?: "human" | "agent" }
  | { type: "LOGIN_FAILED"; code: string }
  | { type: "ROOMS_LOADED"; rooms: RoomSummary[] }
  | { type: "ROOM_SELECTED"; roomName: string }
  | { type: "ROOM_CONNECTED"; room: RoomDetail }
  | { type: "MESSAGES_RECEIVED"; messages: Message[]; cursor: number | null }
  | { type: "POLL_FAILED"; code: string }
  | { type: "RETRY_REQUESTED" }
  | { type: "BROWSER_OFFLINE" }
  | { type: "BROWSER_ONLINE" }
  | { type: "MESSAGE_QUEUED"; clientId: string; content: string }
  | { type: "MESSAGE_SENDING"; clientId: string }
  | { type: "MESSAGE_ACKNOWLEDGED"; clientId: string; message: Message }
  | { type: "MESSAGE_FAILED"; clientId: string; code: string }
  | { type: "LOGGED_OUT" };

export const initialConnectionState: ConnectionState = {
  phase: "checking_session",
  rooms: [],
  messages: [],
  attempt: 0,
  stale: false,
  outbox: [],
};

const readOnlyCodes = new Set(["MUTED", "NOT_A_MEMBER", "ROOM_ARCHIVED"]);

export function reduceConnection(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case "SESSION_MISSING":
      return { ...initialConnectionState, phase: "signed_out", errorCode: event.code };
    case "SESSION_READY":
    case "LOGIN_SUCCEEDED":
      return { ...initialConnectionState, phase: "loading_rooms", username: event.username, kind: event.kind };
    case "LOGIN_STARTED":
      return { ...state, phase: "signed_out", errorCode: undefined, notice: "Signing in…" };
    case "LOGIN_FAILED":
      return { ...state, phase: "signed_out", errorCode: event.code, notice: undefined };
    case "ROOMS_LOADED":
      return { ...state, phase: "selecting_room", rooms: event.rooms, errorCode: undefined };
    case "ROOM_SELECTED":
      return { ...state, phase: "connecting", roomName: event.roomName, room: undefined, messages: [], outbox: [], lastCursor: undefined, attempt: 0, stale: false };
    case "ROOM_CONNECTED":
      return {
        ...state,
        phase: event.room.muted ? "read_only" : "connected",
        roomName: event.room.roomName,
        room: event.room,
        errorCode: event.room.muted ? "MUTED" : undefined,
        attempt: 0,
        stale: false,
      };
    case "MESSAGES_RECEIVED": {
      const byId = new Map(state.messages.map((message) => [message.id, message]));
      for (const message of event.messages) byId.set(message.id, message);
      return {
        ...state,
        phase: state.room?.muted ? "read_only" : "connected",
        messages: [...byId.values()].sort((a, b) => a.id - b.id).slice(-500),
        lastCursor: event.cursor ?? state.lastCursor,
        attempt: 0,
        errorCode: state.room?.muted ? "MUTED" : undefined,
        stale: false,
      };
    }
    case "POLL_FAILED":
      if (event.code === "SESSION_EXPIRED") {
        return { ...initialConnectionState, phase: "signed_out", errorCode: event.code };
      }
      if (readOnlyCodes.has(event.code)) {
        return { ...state, phase: "read_only", errorCode: event.code, stale: state.messages.length > 0 };
      }
      return { ...state, phase: "reconnecting", errorCode: event.code, attempt: state.attempt + 1, stale: state.messages.length > 0 };
    case "RETRY_REQUESTED":
      return { ...state, phase: "connecting", errorCode: undefined, notice: "Retrying…" };
    case "BROWSER_OFFLINE":
      return { ...state, phase: "reconnecting", errorCode: "OFFLINE", notice: "Offline · showing saved activity", stale: state.messages.length > 0 };
    case "BROWSER_ONLINE":
      return state.phase === "reconnecting" ? { ...state, phase: "connecting", errorCode: undefined, notice: "Back online · reconnecting" } : state;
    case "MESSAGE_QUEUED":
      return { ...state, outbox: [...state.outbox, { clientId: event.clientId, content: event.content, state: "queued" as const }].slice(-20) };
    case "MESSAGE_SENDING":
      return { ...state, outbox: state.outbox.map((item) => item.clientId === event.clientId ? { ...item, state: "pending", errorCode: undefined } : item) };
    case "MESSAGE_ACKNOWLEDGED": {
      const messages = new Map(state.messages.map((message) => [message.id, message]));
      messages.set(event.message.id, event.message);
      return {
        ...state,
        messages: [...messages.values()].sort((a, b) => a.id - b.id).slice(-500),
        outbox: state.outbox.map((item) => item.clientId === event.clientId ? { ...item, state: "acknowledged", errorCode: undefined } : item),
      };
    }
    case "MESSAGE_FAILED":
      return { ...state, outbox: state.outbox.map((item) => item.clientId === event.clientId ? { ...item, state: "failed", errorCode: event.code } : item) };
    case "LOGGED_OUT":
      return { ...initialConnectionState, phase: "signed_out" };
  }
}
