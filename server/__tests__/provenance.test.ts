import { describe, expect, it } from "vitest";
import {
  combine,
  demo,
  describeProvenance,
  hasValue,
  isVerifiedFact,
  known,
  mapSourced,
  provenanceLabel,
  toStale,
  unknown,
  type ActorRef,
  type Environment,
  type EvidenceSource,
} from "../../shared/provenance.js";

const production: Environment = { target: "production", origin: "https://webharness.example:10443" };
const localClone: Environment = { target: "local", origin: "http://127.0.0.1:8765", revision: "abc1234" };

const agent: ActorRef = { kind: "agent", username: "claude-nikk2mbp" };
const operator: ActorRef = { kind: "human", username: "nikk" };

const transport: EvidenceSource = { kind: "webharness_transport", roomName: "AgentParty", messageId: 42 };
const selfReport: EvidenceSource = { kind: "agent_self_report", actor: agent };

const at = { observedAt: "2026-09-03T01:00:00Z", receivedAt: "2026-09-03T01:00:02Z" };

describe("unknown carries no value at all", () => {
  it("has no value property", () => {
    const u = unknown("enforcement not verified on this deployment");

    // The central rule. If we do not know whether a room enforces its password,
    // there is no boolean to render — so a guess cannot be smuggled onto a
    // screen wearing an UNKNOWN badge.
    expect(u).not.toHaveProperty("value");
    expect(hasValue(u)).toBe(false);
  });

  it("cannot be turned into a value by mapping", () => {
    const mapped = mapSourced(unknown("no data"), () => "invented");

    expect(mapped).not.toHaveProperty("value");
    expect(mapped.state).toBe("unknown");
  });

  it("poisons a combination rather than yielding a computed number", () => {
    const real = known(10, transport, production, at);
    const missing = unknown("never fetched");

    const result = combine(real, missing, (a, b: number) => a + b);

    // A figure derived from something we do not know is a figure we invented.
    expect(result.state).toBe("unknown");
    expect(result).not.toHaveProperty("value");
    expect(hasValue(result)).toBe(false);
  });

  it("explains the lineage of its degradation", () => {
    const result = combine(known(1, transport, production, at), unknown("poll never ran"), (a, b: number) => a + b);

    expect(result.state === "unknown" && result.reason).toContain("poll never ran");
  });
});

describe("self-reports cannot masquerade as transport facts", () => {
  it("a live self-report is not a verified fact", () => {
    const claim = known("Claude Opus 5", selfReport, production, at);

    // Transport proves who SENT it. Nothing verifies the content. An agent
    // claiming its own model, runtime or location is unverifiable by
    // construction, however fresh the claim is.
    expect(claim.freshness.kind).toBe("live");
    expect(isVerifiedFact(claim)).toBe(false);
  });

  it("a transport-sourced live value IS a verified fact", () => {
    expect(isVerifiedFact(known("AgentParty", transport, production, at))).toBe(true);
  });

  it("labels a self-report distinctly, never as LIVE", () => {
    const label = provenanceLabel(known("somewhere in Europe", selfReport, production, at));

    expect(label).toBe("SELF-REPORTED");
    expect(label).not.toContain("LIVE");
  });

  it("says plainly in the description that a self-report is unverifiable", () => {
    const text = describeProvenance(known("gpt-9", selfReport, production, at));

    expect(text).toContain("about itself");
    expect(text).toContain("unverifiable");
  });

  it("does not promote a self-report through a map", () => {
    const derived = mapSourced(known("gpt-9", selfReport, production, at), (m) => m.toUpperCase());

    expect(isVerifiedFact(derived)).toBe(false);
  });

  it("degrades a combination of transport and self-report to the weaker source", () => {
    const fact = known(1, transport, production, at);
    const claim = known(2, selfReport, production, at);

    const result = combine(fact, claim, (a, b) => a + b);

    // Mixing a verifiable fact with an unverifiable claim does not produce a
    // verifiable fact.
    expect(isVerifiedFact(result)).toBe(false);
  });
});

describe("attestation is evidence, not a property of the environment", () => {
  it("carries the actor, statement and time", () => {
    const attestation: EvidenceSource = {
      kind: "operator_attestation",
      actor: operator,
      statement: "production runs abc1234",
      attestedAt: "2026-09-03T02:00:00Z",
    };

    const text = describeProvenance(known(true, attestation, production, at));

    expect(provenanceLabel(known(true, attestation, production, at))).toBe("ATTESTED");
    expect(text).toContain("nikk");
    expect(text).toContain("production runs abc1234");
  });

  it("marks an unattested revision claim as unattested", () => {
    // The mistake that prompted all of this: a local reproduction read as a
    // statement about the deployed service.
    const text = describeProvenance(known("bypass reproduced", transport, localClone, at));

    expect(text).toContain("local");
    expect(text).toContain("abc1234");
    expect(text).toContain("unattested");
  });
});

describe("freshness is orthogonal to source", () => {
  it("preserves when a value was last actually observed", () => {
    const demoted = toStale(known("data", transport, production, at), "offline");

    expect(demoted.state === "known" && demoted.freshness).toMatchObject({
      kind: "stale",
      lastObservedAt: "2026-09-03T01:00:00Z",
      reason: "offline",
    });
  });

  it("keeps the original observation time across repeated demotions", () => {
    const once = toStale(known("data", transport, production, at), "offline");
    const twice = toStale(once, "poll_failed");

    // A human judging old data needs its true age, not the moment we last
    // noticed it was old.
    expect(twice.state === "known" && twice.freshness).toMatchObject({
      lastObservedAt: "2026-09-03T01:00:00Z",
    });
  });

  it("keeps source and freshness independent", () => {
    const staleSelfReport = toStale(known("gpt-9", selfReport, production, at), "offline");

    expect(provenanceLabel(staleSelfReport)).toBe("SELF-REPORTED (STALE)");
    expect(isVerifiedFact(staleSelfReport)).toBe(false);
  });

  it("does not make demo or unknown go stale — they were never live", () => {
    expect(toStale(demo(1, "fixture"), "offline").state).toBe("demo");
    expect(toStale(unknown("no data"), "offline").state).toBe("unknown");
  });

  it("distinguishes observedAt from receivedAt", () => {
    // Under long-polling and replay these differ; conflating them makes
    // replayed history look freshly observed.
    const value = known(1, transport, production, at);

    expect(value.state === "known" && value.observedAt).toBe("2026-09-03T01:00:00Z");
    expect(value.state === "known" && value.receivedAt).toBe("2026-09-03T01:00:02Z");
  });
});

describe("labels and rendering", () => {
  it("gives every state a non-empty label", () => {
    for (const sourced of [
      known(1, transport, production, at),
      toStale(known(1, transport, production, at), "offline"),
      known(1, selfReport, production, at),
      demo(1, "fixture"),
      unknown("no data"),
    ]) {
      expect(provenanceLabel(sourced).length).toBeGreaterThan(0);
    }
  });

  it("distinguishes a local observation from a production one", () => {
    expect(provenanceLabel(known(1, transport, localClone, at))).toBe("LIVE (LOCAL)");
    expect(provenanceLabel(known(1, transport, production, at))).toBe("LIVE");
  });

  it("marks demo data as demo in the description, not just the badge", () => {
    expect(describeProvenance(demo(1, "seeded fixture"))).toContain("demo data");
  });
});
