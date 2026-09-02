import { describe, expect, it } from "vitest";
import type { Message, RoomDetail } from "../shared/contracts";
import { initialConnectionState, reduceConnection, type ConnectionState } from "./connection-state";

const room: RoomDetail = {
  roomName: "AgentParty",
  ownerName: "Nikk2",
  onlineUsers: [],
  onlineCount: 0,
  isOwner: false,
  muted: false,
};

const message = (id: number, content = String(id)): Message => ({
  id,
  username: "nikk",
  content,
  msgType: "text",
  createdAt: "now",
  updatedAt: "now",
  streaming: false,
});

describe("connection state", () => {
  it("moves through session, room list, and connection", () => {
    let state = reduceConnection(initialConnectionState, { type: "SESSION_READY", username: "nikk" });
    state = reduceConnection(state, { type: "ROOMS_LOADED", rooms: [{ roomName: "AgentParty", ownerName: "Nikk2", visibility: "public" }] });
    state = reduceConnection(state, { type: "ROOM_SELECTED", roomName: "AgentParty" });
    state = reduceConnection(state, { type: "ROOM_CONNECTED", room });
    expect(state).toMatchObject({ phase: "connected", username: "nikk", roomName: "AgentParty", stale: false });
  });

  it("keeps cached messages visible during a retryable outage", () => {
    let state: ConnectionState = { ...initialConnectionState, phase: "connected", roomName: "AgentParty", room, messages: [message(1)] };
    state = reduceConnection(state, { type: "POLL_FAILED", code: "UPSTREAM_UNAVAILABLE" });
    expect(state).toMatchObject({ phase: "reconnecting", stale: true, attempt: 1, messages: [{ id: 1 }] });
  });

  it("never shows an expired session as a reconnect loop", () => {
    const state = reduceConnection({ ...initialConnectionState, phase: "connected", username: "nikk" }, { type: "POLL_FAILED", code: "SESSION_EXPIRED" });
    expect(state).toMatchObject({ phase: "signed_out", errorCode: "SESSION_EXPIRED" });
    expect(state.username).toBeUndefined();
  });

  it("renders muted and archived states as read-only", () => {
    const muted = reduceConnection({ ...initialConnectionState, phase: "connecting", messages: [message(1)] }, { type: "ROOM_CONNECTED", room: { ...room, muted: true } });
    const archived = reduceConnection(muted, { type: "POLL_FAILED", code: "ROOM_ARCHIVED" });
    expect(muted).toMatchObject({ phase: "read_only", errorCode: "MUTED" });
    expect(archived).toMatchObject({ phase: "read_only", errorCode: "ROOM_ARCHIVED", stale: true });
  });

  it("deduplicates streaming message updates by id", () => {
    let state: ConnectionState = { ...initialConnectionState, phase: "connected", room, messages: [message(4, "partial")] };
    state = reduceConnection(state, { type: "MESSAGES_RECEIVED", messages: [message(4, "complete")], cursor: 4 });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("complete");
  });

  it("switches offline data to stale and reconnects when the browser returns", () => {
    let state: ConnectionState = { ...initialConnectionState, phase: "connected", messages: [message(1)] };
    state = reduceConnection(state, { type: "BROWSER_OFFLINE" });
    expect(state).toMatchObject({ phase: "reconnecting", errorCode: "OFFLINE", stale: true });
    state = reduceConnection(state, { type: "BROWSER_ONLINE" });
    expect(state).toMatchObject({ phase: "connecting", errorCode: undefined });
  });
});
