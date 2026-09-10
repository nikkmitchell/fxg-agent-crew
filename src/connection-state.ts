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
  /**
   * True when the transcript starts partway through the room's history.
   *
   * See MessagePage.mayHaveEarlier. Kept in state so the transcript can say so
   * at its top edge: a bounded window that does not announce itself reads as
   * the whole room.
   */
  mayHaveEarlier: boolean;
  /**
   * Whether the BROWSER believes it has a network, as distinct from whether
   * polling is currently succeeding.
   *
   * They are not the same thing and conflating them stranded a message. `phase`
   * is driven by the poll: while the browser reported offline, the poll kept
   * succeeding against a connection that still worked, so every response reset
   * phase to "connected". Coming back online then changed nothing — the flush
   * was watching for a transition INTO "connected" that had already happened,
   * so a queued message sat there under a receipt promising it "will send
   * itself". Recording the browser's own signal separately gives the flush
   * something that actually changes when connectivity is restored.
   */
  online: boolean;
  username?: string;
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
  | { type: "SESSION_READY"; username: string }
  | { type: "LOGIN_STARTED" }
  | { type: "LOGIN_SUCCEEDED"; username: string }
  | { type: "LOGIN_FAILED"; code: string }
  | { type: "ROOMS_LOADED"; rooms: RoomSummary[] }
  | { type: "ROOM_SELECTED"; roomName: string }
  | { type: "ROOM_CONNECTED"; room: RoomDetail }
  | { type: "MESSAGES_RECEIVED"; messages: Message[]; cursor: number | null; mayHaveEarlier?: boolean }
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
  // Assume online where there is no navigator (tests, SSR): starting "offline"
  // would queue the first message instead of sending it.
  mayHaveEarlier: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
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
      return { ...initialConnectionState, phase: "loading_rooms", username: event.username };
    case "LOGIN_STARTED":
      return { ...state, phase: "signed_out", errorCode: undefined, notice: "Signing in…" };
    case "LOGIN_FAILED":
      return { ...state, phase: "signed_out", errorCode: event.code, notice: undefined };
    case "ROOMS_LOADED":
      return { ...state, phase: "selecting_room", rooms: event.rooms, errorCode: undefined };
    case "ROOM_SELECTED":
      // mayHaveEarlier is per-room and must be cleared here. Carrying it over
      // would accuse a short room of hiding history it does not have, and a
      // warning that is sometimes wrong is one people learn to ignore.
      return { ...state, phase: "connecting", roomName: event.roomName, room: undefined, messages: [], outbox: [], lastCursor: undefined, attempt: 0, stale: false, mayHaveEarlier: false };
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
      // Once true it stays true: the flag describes where the transcript
      // STARTED, and later pages arriving from the other end cannot make the
      // missing history reappear. The client also caps the transcript at 500,
      // so a long-lived tab drops its own oldest messages too — either way the
      // top edge is a boundary and not the beginning of the room.
      const mayHaveEarlier = state.mayHaveEarlier || event.mayHaveEarlier === true;
      return {
        ...state,
        mayHaveEarlier,
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
      return { ...state, online: false, phase: "reconnecting", errorCode: "OFFLINE", notice: "Offline · showing saved activity", stale: state.messages.length > 0 };
    case "BROWSER_ONLINE":
      // `online` is set unconditionally; the phase change stays conditional.
      // Returning `state` untouched here — which is what this did when polling
      // had already recovered on its own — meant nothing downstream could tell
      // that connectivity had come back.
      return state.phase === "reconnecting"
        ? { ...state, online: true, phase: "connecting", errorCode: undefined, notice: "Back online · reconnecting" }
        : { ...state, online: true };
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

/**
 * May this person write a message right now?
 *
 * Pulled out of the panel's JSX so it can be tested. There is no DOM testing
 * library in this project, and the rule is too easy to get wrong to leave as an
 * inline condition — it was wrong until 2026-09-09, and the way it was wrong
 * disabled the whole outbox in the one situation the outbox exists for.
 *
 * Writable while connected, and while the BROWSER is offline. Not writable for
 * any other interruption: an archived room, a revoked membership or an expired
 * session are refusals, and offering a text box for one of those would invite
 * someone to write something that can never be sent.
 */
export function canCompose(state: Pick<ConnectionState, "phase" | "errorCode">): boolean {
  if (state.phase === "connected") return true;
  return state.phase === "reconnecting" && state.errorCode === "OFFLINE";
}
