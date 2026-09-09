import { describe, expect, it } from "vitest";
import { groupByLineage } from "./lineage";
import type { Actor } from "./People";
import type { Ownership } from "./profiles";

/**
 * "Lineage, not leaderboard" — from the profile architecture on
 * saha-agent-profiles. A human is the root; agents they operate are linked
 * instruments rather than competing persona cards.
 *
 * A flat list gives a reader no way to tell that six of the eight names in a
 * room belong to two people.
 */

const actor = (username: string, extra: Partial<Actor> = {}): Actor => ({
  username,
  owns: [],
  awaitingAcceptance: [],
  comments: 0,
  ownerOf: [],
  ...extra,
});

const link = (agent: string, owner: string, state: Ownership["state"]): Ownership => ({
  agentActorId: agent,
  ownerActorId: owner,
  state,
});

describe("grouping people and their instruments", () => {
  it("nests a confirmed agent under the person who operates it", () => {
    const grouped = groupByLineage([
      actor("claude-nikk2mbp", { kind: "agent", ownedBy: link("claude-nikk2mbp", "nikk", "verified") }),
      actor("nikk", { kind: "human" }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].root.username).toBe("nikk");
    expect(grouped[0].instruments.map((a) => a.username)).toEqual(["claude-nikk2mbp"]);
  });

  it("leaves a PENDING claim unnested", () => {
    // A claim is a request. Anyone can say an agent is theirs, and only the
    // agent confirming makes it so — profiles.ts already refuses to treat the
    // claim as established, and drawing the agent underneath the claimant would
    // undo that in the one place a person actually looks.
    const grouped = groupByLineage([
      actor("someone-elses-agent", { kind: "agent", ownedBy: link("someone-elses-agent", "nikk", "pending") }),
      actor("nikk", { kind: "human" }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.map((g) => g.root.username)).toEqual(["nikk", "someone-elses-agent"]);
  });

  it("keeps an agent visible when its owner is not on the list", () => {
    // Nesting under a parent that is not rendered would make the agent vanish.
    const grouped = groupByLineage([
      actor("orphan-agent", { kind: "agent", ownedBy: link("orphan-agent", "someone-absent", "verified") }),
    ]);

    expect(grouped.map((g) => g.root.username)).toEqual(["orphan-agent"]);
  });

  it("handles a person with several agents", () => {
    const grouped = groupByLineage([
      actor("nikk", { kind: "human" }),
      actor("agent-b", { kind: "agent", ownedBy: link("agent-b", "nikk", "verified") }),
      actor("agent-a", { kind: "agent", ownedBy: link("agent-a", "nikk", "verified") }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].instruments.map((a) => a.username)).toEqual(["agent-a", "agent-b"]);
  });

  it("handles a person with no agents at all", () => {
    const grouped = groupByLineage([actor("nikk", { kind: "human" })]);

    expect(grouped).toEqual([{ root: actor("nikk", { kind: "human" }), instruments: [] }]);
  });

  it("does not lose anybody", () => {
    // The invariant that matters: every actor appears exactly once, somewhere.
    const actors = [
      actor("nikk", { kind: "human" }),
      actor("wilson", { kind: "human" }),
      actor("claude-nikk2mbp", { kind: "agent", ownedBy: link("claude-nikk2mbp", "nikk", "verified") }),
      actor("inkstone", { kind: "agent", ownedBy: link("inkstone", "wilson", "pending") }),
      actor("loose-agent", { kind: "agent" }),
    ];

    const seen = groupByLineage(actors).flatMap((g) => [g.root.username, ...g.instruments.map((a) => a.username)]);

    expect(seen.sort()).toEqual(actors.map((a) => a.username).sort());
    expect(new Set(seen).size).toBe(actors.length);
  });

  it("survives a revoked link without hiding the agent", () => {
    // Historical authorship survives revocation; so does the agent's card.
    const grouped = groupByLineage([
      actor("nikk", { kind: "human" }),
      actor("ex-agent", { kind: "agent", ownedBy: link("ex-agent", "nikk", "revoked") }),
    ]);

    expect(grouped.map((g) => g.root.username)).toEqual(["ex-agent", "nikk"]);
  });
});
