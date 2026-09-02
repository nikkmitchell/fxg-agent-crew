import { describe, expect, it } from "vitest";
import {
  combine,
  demo,
  describeProvenance,
  hasValue,
  isMixedEnvironment,
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

const serverFact: EvidenceSource = { kind: "webharness_api", endpoint: "/api/rooms/AgentParty" };
const participantClaim: EvidenceSource = {
  kind: "participant_statement",
  ref: { roomName: "AgentParty", messageId: 42, username: "mallory" },
};
const github: EvidenceSource = { kind: "github", repo: "nikkmitchell/fxg-agent-crew" };
const transport = serverFact;
const selfReport: EvidenceSource = {
  kind: "agent_self_report",
  actor: agent,
  // Binding is required: a self-report with no transport ref is an
  // unattributable assertion, and we could not check the claimed actor against
  // the authenticated sender.
  ref: { roomName: "AgentParty", messageId: 7, username: "claude-nikk2mbp" },
};

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

  it("a server-owned API fact IS verified", () => {
    expect(isVerifiedFact(known("AgentParty", serverFact, production, at))).toBe(true);
  });

  it("an authenticated participant's CLAIM is not a verified fact", () => {
    // Transport proves who spoke. It says nothing about whether they were
    // right. A chat claim cannot become verified merely because HTTPS
    // delivered it reliably.
    const claim = known("the deploy is green", participantClaim, production, at);

    expect(claim.freshness.kind).toBe("live");
    expect(isVerifiedFact(claim)).toBe(false);
    expect(provenanceLabel(claim)).toBe("CLAIMED");
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

    // Must keep BOTH axes. Collapsing to "STALE" erases who vouched for it,
    // so an unverifiable self-report and a server fact would look identical
    // once either went stale.
    expect(provenanceLabel(staleSelfReport)).toBe("SELF-REPORTED · STALE");
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

/**
 * The five cases named in re-review. Each is a path by which a value could be
 * presented as better-evidenced than it is.
 */
describe("derivation preserves every contributing source", () => {
  it("keeps both environments when production and local are combined", () => {
    const prod = known(1, serverFact, production, at);
    const local = known(2, serverFact, localClone, at);

    const result = combine(prod, local, (a, b) => a + b);

    // Attributing this to either environment alone is precisely the overclaim
    // that started all of this.
    expect(result.state === "known" && result.environments).toHaveLength(2);
    expect(isMixedEnvironment(result)).toBe(true);
    expect(provenanceLabel(result)).toContain("MIXED");
    expect(describeProvenance(result)).toContain("production");
    expect(describeProvenance(result)).toContain("local");
  });

  it("keeps both sources when GitHub and a self-report are combined", () => {
    const repo = known("v1.2.0", github, production, at);
    const claim = known("running v1.2.0", selfReport, production, at);

    const result = combine(repo, claim, (a, b) => `${a}/${b}`);

    // One unverifiable input taints the result: an agent agreeing with GitHub
    // does not make the agent's claim verified.
    expect(isVerifiedFact(result)).toBe(false);
    const text = describeProvenance(result);
    expect(text).toContain("nikkmitchell/fxg-agent-crew");
    expect(text).toContain("about itself");
  });

  it("is invariant to operand order, on normalized provenance", () => {
    const prod = known(1, serverFact, production, at);
    const claim = known(2, selfReport, localClone, at);

    const ab = combine(prod, claim, (a, b) => a + b);
    const ba = combine(claim, prod, (a, b) => b + a);

    // Assert the whole provenance, order-normalized — not just that a couple of
    // fields happen to agree. Order deciding which source survives is exactly
    // how a weaker contributor disappears depending on argument position.
    const normalize = (s: typeof ab) =>
      s.state === "known"
        ? {
            sources: [...(s.source.kind === "derived" ? s.source.from : [s.source])]
              .map((x) => JSON.stringify(x))
              .sort(),
            environments: s.environments.map((e) => JSON.stringify(e)).sort(),
            freshness: s.freshness,
            verified: isVerifiedFact(s),
            label: provenanceLabel(s),
          }
        : null;

    expect(normalize(ab)).toEqual(normalize(ba));
  });

  it("flattens nested derivations so lineage stays inspectable", () => {
    const one = known(1, serverFact, production, at);
    const two = known(2, github, production, at);
    const three = known(3, selfReport, production, at);

    const nested = combine(combine(one, two, (a, b) => a + b), three, (a, b) => a + b);

    expect(nested.state === "known" && nested.source.kind === "derived" && nested.source.from).toHaveLength(3);
  });

  it("a derivation of only verifiable sources stays verifiable", () => {
    const result = combine(known(1, serverFact, production, at), known(2, github, production, at), (a, b) => a + b);

    expect(isVerifiedFact(result)).toBe(true);
  });
});

describe("historical is not stale", () => {
  it("labels a superseded value HISTORICAL, never STALE", () => {
    const historical = known("old title", serverFact, production, at, {
      kind: "historical",
      observedAt: "2026-09-01T00:00:00Z",
      supersededBy: "wh:99:0",
    });

    // Stale means we tried to know the current value and failed — unreliable.
    // Historical means a newer value exists and this one is shown on purpose —
    // perfectly reliable about the past. A connection-problem badge on a
    // deliberate history view is a false alarm.
    expect(provenanceLabel(historical)).toBe("LIVE · HISTORICAL");
    expect(provenanceLabel(historical)).not.toContain("STALE");
    expect(describeProvenance(historical)).toContain("historical");
  });

  it("does not admit superseded as a stale reason", () => {
    // Compile-time: StaleReason no longer includes it. This pins the runtime
    // consequence so a future widening does not quietly reintroduce it.
    const stale = toStale(known(1, serverFact, production, at), "offline");

    expect(stale.state === "known" && stale.freshness.kind).toBe("stale");
    expect(JSON.stringify(stale)).not.toContain("superseded");
  });

  it("ranks stale below historical when combining", () => {
    const hist = known(1, serverFact, production, at, { kind: "historical", observedAt: "2026-09-01T00:00:00Z" });
    const brokenPoll = toStale(known(2, serverFact, production, at), "poll_failed");

    // An unreliable reading contaminates more than a deliberate old one.
    const result = combine(hist, brokenPoll, (a, b) => a + b);

    expect(result.state === "known" && result.freshness.kind).toBe("stale");
  });
});


/**
 * The label must never collapse the two axes. Required by re-review: the type
 * being orthogonal is worthless if rendering flattens it back on the way to the
 * screen, which is the last place the distinction actually matters.
 */
describe("labels keep source and freshness independent", () => {
  it.each([
    ["CLAIMED · STALE", toStale(known(1, participantClaim, production, at), "offline")],
    ["SELF-REPORTED · HISTORICAL", known(1, selfReport, production, at, { kind: "historical", observedAt: "2026-09-01T00:00:00Z" })],
    ["CLAIMED (LOCAL)", known(1, participantClaim, localClone, at)],
    ["SELF-REPORTED (LOCAL) · STALE", toStale(known(1, selfReport, localClone, at), "poll_failed")],
    ["LIVE (LOCAL)", known(1, serverFact, localClone, at)],
    ["ATTESTED", known(1, { kind: "operator_attestation", actor: operator, statement: "s", attestedAt: at.observedAt }, production, at)],
  ])("renders %s", (expected, sourced) => {
    expect(provenanceLabel(sourced)).toBe(expected);
  });

  it("a stale server fact and a stale claim are distinguishable", () => {
    const fact = toStale(known(1, serverFact, production, at), "offline");
    const claim = toStale(known(1, participantClaim, production, at), "offline");

    // Previously both read "STALE" and were indistinguishable on screen.
    expect(provenanceLabel(fact)).not.toBe(provenanceLabel(claim));
  });
});
