import { describe, expect, it } from "vitest";
import { initialConnectionState, reduceConnection, type ConnectionState } from "./connection-state";
import type { Message } from "../shared/contracts";

/**
 * Live Chat is a BOUNDED RECENT WINDOW, and it has to say so.
 *
 * `saha-pagination-contract` asked for every room-history reader to be
 * classified: either exhaustive and using the shared traversal, or deliberately
 * bounded with tests stating that contract. Live Chat is the second.
 *
 * The first read asks for the most recent 50 and polls forward. There is no
 * backwards paging, because upstream's `before` cursor does not page — it
 * returned the same message twelve times (docs/OPERATING-NOTES.md). The client
 * additionally caps its transcript at 500.
 *
 * That is a defensible design for a chat. What was not defensible is that
 * nothing said so: the oldest loaded message sat at the top of the transcript
 * with nothing above it, which is indistinguishable from the start of the room.
 */

const message = (id: number): Message => ({
  id,
  username: "someone",
  content: `message ${id}`,
  msgType: "text",
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
  streaming: false,
});

const connected: ConnectionState = { ...initialConnectionState, phase: "connected", roomName: "AgentParty" };

describe("the top of the transcript", () => {
  it("is marked as a boundary when the first page came back full", () => {
    const state = reduceConnection(connected, {
      type: "MESSAGES_RECEIVED",
      messages: Array.from({ length: 50 }, (_, i) => message(i + 78)),
      cursor: 127,
      mayHaveEarlier: true,
    });

    expect(state.mayHaveEarlier).toBe(true);
  });

  it("is not marked when the whole room fitted", () => {
    // A short room must not be labelled as truncated. Warning about missing
    // history that is not missing teaches people to ignore the warning.
    const state = reduceConnection(connected, {
      type: "MESSAGES_RECEIVED",
      messages: [message(1), message(2)],
      cursor: 2,
      mayHaveEarlier: false,
    });

    expect(state.mayHaveEarlier).toBe(false);
  });

  it("stays marked as newer messages arrive", () => {
    // Later pages come from the far end. Nothing arriving from the newest side
    // can restore what was never fetched from the oldest side, so a flag that
    // cleared itself on the next poll would be a lie with a two-second delay.
    const opened = reduceConnection(connected, {
      type: "MESSAGES_RECEIVED",
      messages: Array.from({ length: 50 }, (_, i) => message(i + 78)),
      cursor: 127,
      mayHaveEarlier: true,
    });
    const later = reduceConnection(opened, { type: "MESSAGES_RECEIVED", messages: [message(128)], cursor: 128 });

    expect(later.mayHaveEarlier).toBe(true);
  });

  it("starts unmarked, so a room is never accused of hiding history before it loads", () => {
    expect(initialConnectionState.mayHaveEarlier).toBe(false);
  });

  it("is reset when a different room is opened", () => {
    const opened = reduceConnection(connected, {
      type: "MESSAGES_RECEIVED",
      messages: Array.from({ length: 50 }, (_, i) => message(i + 78)),
      cursor: 127,
      mayHaveEarlier: true,
    });
    const switched = reduceConnection(opened, { type: "ROOM_SELECTED", roomName: "OtherRoom" });

    expect(switched.mayHaveEarlier).toBe(false);
  });
});
