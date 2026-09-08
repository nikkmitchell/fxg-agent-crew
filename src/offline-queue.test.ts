import { describe, expect, it } from "vitest";
import { canCompose, reduceConnection, initialConnectionState, type ConnectionState } from "./connection-state";

/**
 * A message queued while offline must not be stranded when the network returns.
 *
 * Found in a browser, not in a test. The flush watched `phase` for a transition
 * back into "connected". But the browser can report offline while the
 * connection still works — flaky wifi, a captive portal, a lid closed and
 * reopened, a spurious `offline` event — and then polling never fails, every
 * response resets phase to "connected", and by the time `online` fires there is
 * no transition left to observe.
 *
 * The message sat queued for 45 seconds under a receipt reading "waiting for
 * the connection · will send itself". Losing a message is bad. Promising to
 * send it and then not sending it is worse, because the sender stops watching.
 */

const connected: ConnectionState = {
  ...initialConnectionState,
  phase: "connected",
  online: true,
  roomName: "AgentParty",
};

describe("the browser's own connectivity signal", () => {
  it("is recorded separately from whether polling is succeeding", () => {
    const offline = reduceConnection(connected, { type: "BROWSER_OFFLINE" });

    expect(offline.online).toBe(false);
    expect(offline.phase).toBe("reconnecting");
  });

  it("comes back even when polling never noticed anything was wrong", () => {
    // THE REGRESSION. Offline, then a poll succeeds and resets phase to
    // "connected", then the browser comes back online. The old reducer returned
    // `state` untouched here, so nothing downstream could tell connectivity had
    // been restored, and the flush effect never re-ran.
    const offline = reduceConnection(connected, { type: "BROWSER_OFFLINE" });
    const pollSucceededAnyway = reduceConnection(offline, {
      type: "MESSAGES_RECEIVED",
      messages: [],
      cursor: 1,
    });
    expect(pollSucceededAnyway.phase).toBe("connected");
    expect(pollSucceededAnyway.online).toBe(false);

    const back = reduceConnection(pollSucceededAnyway, { type: "BROWSER_ONLINE" });

    expect(back.online).toBe(true);
    expect(back).not.toBe(pollSucceededAnyway);
  });

  it("still moves a genuinely reconnecting session back to connecting", () => {
    const reconnecting = reduceConnection(connected, { type: "POLL_FAILED", code: "UPSTREAM_UNAVAILABLE" });
    const back = reduceConnection(reconnecting, { type: "BROWSER_ONLINE" });

    expect(back.phase).toBe("connecting");
    expect(back.online).toBe(true);
  });

  it("keeps a queued message queued while offline rather than failing it", () => {
    // Queued and failed mean different things to a reader: one is a promise,
    // the other is a request for a decision. Offline must not produce the second.
    const offline = reduceConnection(connected, { type: "BROWSER_OFFLINE" });
    const queued = reduceConnection(offline, { type: "MESSAGE_QUEUED", clientId: "c1", content: "hello" });

    expect(queued.outbox).toEqual([{ clientId: "c1", content: "hello", state: "queued" }]);
  });

  it("leaves the flush with something to observe: online and connected together", () => {
    // The flush condition is (phase === "connected" && online). This asserts the
    // exact state the browser ends up in after the sequence above, because that
    // combination is what the effect's dependencies now key on.
    const offline = reduceConnection(connected, { type: "BROWSER_OFFLINE" });
    const queued = reduceConnection(offline, { type: "MESSAGE_QUEUED", clientId: "c1", content: "hello" });
    const polled = reduceConnection(queued, { type: "MESSAGES_RECEIVED", messages: [], cursor: 1 });
    const back = reduceConnection(polled, { type: "BROWSER_ONLINE" });

    expect(back.phase).toBe("connected");
    expect(back.online).toBe(true);
    expect(back.outbox.filter((item) => item.state === "queued")).toHaveLength(1);
  });
});

describe("who may write, and when", () => {
  it("lets someone keep writing while the browser is offline", () => {
    // The outbox exists precisely for this moment, and the receipt promises
    // "waiting for the connection · will send itself". The composer used to be
    // removed the instant the browser went offline, so that machinery was
    // unreachable in exactly the situation it was built for. It only ever
    // appeared to work when polling happened to keep succeeding after the
    // offline event and snapped the phase back to "connected".
    expect(canCompose({ phase: "reconnecting", errorCode: "OFFLINE" })).toBe(true);
  });

  it("still allows writing when everything is fine", () => {
    expect(canCompose({ phase: "connected", errorCode: undefined })).toBe(true);
  });

  it("refuses for interruptions that are actually refusals", () => {
    // Offering a text box here would invite someone to write something that can
    // never be sent, which is a worse failure than an absent box.
    for (const errorCode of ["ROOM_ARCHIVED", "NOT_A_MEMBER", "UPSTREAM_UNAVAILABLE"]) {
      expect(canCompose({ phase: "reconnecting", errorCode }), errorCode).toBe(false);
    }
    expect(canCompose({ phase: "read_only", errorCode: "MUTED" })).toBe(false);
    expect(canCompose({ phase: "signed_out", errorCode: "SESSION_EXPIRED" })).toBe(false);
    expect(canCompose({ phase: "selecting_room", errorCode: undefined })).toBe(false);
  });
});
