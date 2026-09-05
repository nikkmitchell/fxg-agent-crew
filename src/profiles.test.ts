import { describe, expect, it } from "vitest";
import {
  agentsOwnedBy,
  checkProfile,
  confirmOwnership,
  declareOwnership,
  projectAuthority,
  revokeOwnership,
} from "./profiles";

const human = { actorId: "actor-nikk", kind: "human", displayName: "Nikk" };
const agent = { actorId: "actor-claude", kind: "agent", displayName: "claude-nikk2mbp" };

describe("what a profile may never carry", () => {
  // Storage concern, not display. Once a hostname is in the durable log it is in
  // every replay forever, and "we do not render it" is a promise about one
  // screen rather than about the data.
  it.each([
    ["ipAddress", "203.0.113.4"],
    ["hostname", "iZj6c53elqjv7oah42okk4Z"],
    ["token", "eyJhbGciOi"],
    ["privateKey", "-----BEGIN"],
    ["latitude", "22.31"],
    ["preciseLocation", "22.3193,114.1694"],
  ])("refuses %s outright", (key, value) => {
    const result = checkProfile({ ...agent, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("may never be stored");
  });

  it("rejects the whole profile rather than silently stripping the field", () => {
    // Dropping it quietly would tell the sender it was stored, and they would
    // believe it.
    const result = checkProfile({ ...agent, hostname: "box-1", bio: "kept?" });
    expect(result.ok).toBe(false);
  });

  it("accepts a coarse location, which is the consented form", () => {
    const result = checkProfile({ ...human, coarseLocation: "Hong Kong", timeZone: "Asia/Hong_Kong" });
    expect(result.ok).toBe(true);
  });

  it("refuses runtime details on a human, which describe a machine", () => {
    expect(checkProfile({ ...human, model: "gpt-5" }).ok).toBe(false);
  });
});

describe("stable ids under mutable names", () => {
  it("keeps the same actorId when the display name changes", () => {
    const before = checkProfile(agent);
    const after = checkProfile({ ...agent, displayName: "Claude (Nikk's MacBook)" });
    expect(before.ok && after.ok && before.value.actorId === after.value.actorId).toBe(true);
  });

  it("does not accept a profile without a stable id", () => {
    const { actorId: _dropped, ...withoutId } = agent;
    expect(checkProfile(withoutId).ok).toBe(false);
  });
});

describe("ownership is a claim until the agent agrees", () => {
  it("starts pending, because anyone can say it", () => {
    expect(declareOwnership("actor-claude", "actor-nikk").state).toBe("pending");
  });

  it("cannot be confirmed by the person who claimed it", () => {
    // Otherwise the pending state is decorative and a claim is a fact.
    const claim = declareOwnership("actor-claude", "actor-nikk");
    expect(confirmOwnership(claim, "actor-nikk").state).toBe("pending");
  });

  it("is verified only when the agent itself confirms", () => {
    const claim = declareOwnership("actor-claude", "actor-nikk");
    expect(confirmOwnership(claim, "actor-claude").state).toBe("verified");
  });

  it("lets either side revoke, and neither revoke for the other", () => {
    const verified = confirmOwnership(declareOwnership("actor-claude", "actor-nikk"), "actor-claude");
    expect(revokeOwnership(verified, "actor-claude").state).toBe("revoked");
    expect(revokeOwnership(verified, "actor-nikk").state).toBe("revoked");
    expect(revokeOwnership(verified, "actor-stranger").state).toBe("verified");
  });

  it("cannot be resurrected by confirming after revocation", () => {
    const revoked = revokeOwnership(declareOwnership("actor-claude", "actor-nikk"), "actor-nikk");
    expect(confirmOwnership(revoked, "actor-claude").state).toBe("revoked");
  });

  it("drops revoked links from the present without deleting the record", () => {
    const links = [
      confirmOwnership(declareOwnership("a1", "actor-nikk"), "a1"),
      revokeOwnership(declareOwnership("a2", "actor-nikk"), "actor-nikk"),
    ];
    expect(agentsOwnedBy("actor-nikk", links).map((o) => o.agentActorId)).toEqual(["a1"]);
    // The revoked one is still in the log that was passed in — historical
    // authorship survives revocation.
    expect(links).toHaveLength(2);
  });

  it("handles a human owning zero agents and several", () => {
    expect(agentsOwnedBy("actor-nikk", [])).toEqual([]);
    const many = ["a1", "a2", "a3"].map((id) => confirmOwnership(declareOwnership(id, "actor-nikk"), id));
    expect(agentsOwnedBy("actor-nikk", many)).toHaveLength(3);
  });
});

describe("ownership grants no project authority", () => {
  const memberships = [{ projectId: "saha-ing", actorId: "actor-nikk", active: true }];

  it("does not let an owned agent inherit its owner's membership", () => {
    // THE security rule of this whole model. An agent verified as owned by a
    // member of a project still has no authority in that project.
    confirmOwnership(declareOwnership("actor-claude", "actor-nikk"), "actor-claude");
    expect(projectAuthority("actor-claude", memberships, "saha-ing")).toBe(false);
  });

  it("grants authority only through the agent's own active membership", () => {
    const withAgent = [...memberships, { projectId: "saha-ing", actorId: "actor-claude", active: true }];
    expect(projectAuthority("actor-claude", withAgent, "saha-ing")).toBe(true);
  });

  it("removes authority when that membership is revoked, regardless of ownership", () => {
    const revokedMember = [{ projectId: "saha-ing", actorId: "actor-claude", active: false }];
    expect(projectAuthority("actor-claude", revokedMember, "saha-ing")).toBe(false);
  });
});
