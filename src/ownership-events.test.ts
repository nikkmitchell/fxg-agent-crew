import { describe, expect, it } from "vitest";
import { initialCrewState, reduceCrewEvent, type EventEnvelope } from "./event-core";

/**
 * The ownership handshake as it behaves over the wire.
 *
 * The pure model is tested separately. What matters here is that the reducer
 * takes the ACTING identity from the authenticated author of the event and
 * never from the payload — which is what stops a claimant confirming their own
 * claim by writing the agent's id into the body.
 */
const envelope = (
  eventId: string,
  source: string,
  cursor: number,
  payload: EventEnvelope["payload"],
): EventEnvelope => ({
  version: 1,
  eventId,
  stream: "AgentParty",
  source,
  sourceCursor: cursor,
  occurredAt: "2026-09-05T00:00:00Z",
  payload,
});

const declare = (id: string, source: string, cursor: number) =>
  envelope(id, source, cursor, {
    type: "ownership.acted",
    agentActorId: "claude-nikk2mbp",
    ownerActorId: "nikk",
    action: "declare",
  });

const act = (id: string, source: string, cursor: number, action: "confirm" | "revoke") =>
  envelope(id, source, cursor, {
    type: "ownership.acted",
    agentActorId: "claude-nikk2mbp",
    ownerActorId: "nikk",
    action,
  });

describe("ownership over the wire", () => {
  it("records a declaration as pending, not verified", () => {
    const state = reduceCrewEvent(initialCrewState, declare("e1", "nikk", 1));
    expect(state.ownerships["claude-nikk2mbp"].state).toBe("pending");
  });

  it("refuses a confirmation from the claimant, however the payload is written", () => {
    // The attack this defends: nikk declares, then nikk confirms. The payload
    // names the agent either way; only the authenticated author differs.
    const declared = reduceCrewEvent(initialCrewState, declare("e1", "nikk", 1));
    const attempted = reduceCrewEvent(declared, act("e2", "nikk", 2, "confirm"));

    expect(attempted.ownerships["claude-nikk2mbp"].state).toBe("pending");
    expect(attempted.rejectedEvents.at(-1)?.reason).toContain("may not confirm");
  });

  it("verifies when the agent itself confirms", () => {
    const declared = reduceCrewEvent(initialCrewState, declare("e1", "nikk", 1));
    const confirmed = reduceCrewEvent(declared, act("e2", "claude-nikk2mbp", 2, "confirm"));
    expect(confirmed.ownerships["claude-nikk2mbp"].state).toBe("verified");
  });

  it("surfaces an unauthorised attempt as a rejection rather than a silent no-op", () => {
    // A refused action that looks like nothing happening is indistinguishable
    // from success to whoever attempted it.
    const declared = reduceCrewEvent(initialCrewState, declare("e1", "nikk", 1));
    const stranger = reduceCrewEvent(declared, act("e2", "someone-else", 2, "revoke"));
    expect(stranger.rejectedEvents.at(-1)?.reason).toContain("may not revoke");
  });

  it("will not let a second owner claim an agent that already has one", () => {
    const declared = reduceCrewEvent(initialCrewState, declare("e1", "nikk", 1));
    const second = reduceCrewEvent(
      declared,
      envelope("e2", "someone-else", 2, {
        type: "ownership.acted",
        agentActorId: "claude-nikk2mbp",
        ownerActorId: "someone-else",
        action: "declare",
      }),
    );
    expect(second.ownerships["claude-nikk2mbp"].ownerActorId).toBe("nikk");
    expect(second.rejectedEvents.at(-1)?.reason).toContain("already has an owner");
  });

  it("allows a fresh declaration after revocation", () => {
    const declared = reduceCrewEvent(initialCrewState, declare("e1", "nikk", 1));
    const revoked = reduceCrewEvent(declared, act("e2", "nikk", 2, "revoke"));
    const again = reduceCrewEvent(revoked, declare("e3", "nikk", 3));
    expect(again.ownerships["claude-nikk2mbp"].state).toBe("pending");
  });

  it("rejects acting on an ownership that does not exist", () => {
    const state = reduceCrewEvent(initialCrewState, act("e1", "claude-nikk2mbp", 1, "confirm"));
    expect(state.rejectedEvents.at(-1)?.reason).toBe("no ownership to act on");
  });
});

describe("profiles over the wire", () => {
  it("stores a declared profile under its stable actor id", () => {
    const state = reduceCrewEvent(
      initialCrewState,
      envelope("e1", "nikk", 1, {
        type: "profile.upserted",
        profile: { actorId: "nikk", kind: "human", displayName: "Nikk" },
      }),
    );
    expect(state.profiles.nikk.displayName).toBe("Nikk");
  });

  it("replaces rather than merges, so a new statement is the whole statement", () => {
    // Merging would attribute a field to someone that their latest declaration
    // did not contain.
    const first = reduceCrewEvent(
      initialCrewState,
      envelope("e1", "nikk", 1, {
        type: "profile.upserted",
        profile: { actorId: "nikk", kind: "human", displayName: "Nikk", bio: "first" },
      }),
    );
    const second = reduceCrewEvent(
      first,
      envelope("e2", "nikk", 2, {
        type: "profile.upserted",
        profile: { actorId: "nikk", kind: "human", displayName: "Nikk" },
      }),
    );
    expect(second.profiles.nikk.bio).toBeUndefined();
  });
});
