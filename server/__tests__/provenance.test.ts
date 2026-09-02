import { describe, expect, it } from "vitest";
import {
  combine,
  demo,
  describeProvenance,
  isTrustworthy,
  live,
  mapSourced,
  provenanceLabel,
  stale,
  toStale,
  unknown,
  type Environment,
} from "../../shared/provenance.js";

const production: Environment = { target: "production", origin: "https://webharness.example:10443" };
const localClone: Environment = { target: "local", origin: "http://127.0.0.1:8765", revision: "abc1234" };

describe("Sourced values", () => {
  it("carries provenance alongside the value", () => {
    const sourced = live(42, production, "2026-09-03T01:00:00Z");

    expect(sourced.value).toBe(42);
    expect(sourced.provenance.kind).toBe("live");
  });

  it("only treats live values as presentable fact", () => {
    expect(isTrustworthy(live(1, production))).toBe(true);
    expect(isTrustworthy(stale(1, production, "offline", "2026-09-03T00:00:00Z"))).toBe(false);
    expect(isTrustworthy(demo(1, "fixture"))).toBe(false);
    expect(isTrustworthy(unknown(1, "never fetched"))).toBe(false);
  });

  it("gives every state a non-empty label", () => {
    // An unlabelled value on screen reads as authoritative, so there is no
    // case where the badge can be blank.
    for (const sourced of [
      live(1, production),
      stale(1, production, "offline", "2026-09-03T00:00:00Z"),
      demo(1, "fixture"),
      unknown(1, "never fetched"),
    ]) {
      expect(provenanceLabel(sourced.provenance).length).toBeGreaterThan(0);
    }
  });

  it("distinguishes a local observation from a production one in the label", () => {
    // The mistake this exists to prevent: a finding reproduced against a local
    // clone being read as a statement about the deployed service.
    expect(provenanceLabel(live(1, localClone).provenance)).toBe("LIVE (LOCAL)");
    expect(provenanceLabel(live(1, production).provenance)).toBe("LIVE");
  });
});

describe("unobserved values carry no timestamp", () => {
  it.each([
    ["demo", demo(1, "fixture")],
    ["unknown", unknown(1, "never fetched")],
  ])("%s has no observedAt", (_label, sourced) => {
    // Stamping a time on something never observed makes fabricated data look
    // sourced, which is the precise deception this module is against.
    expect(sourced.provenance).not.toHaveProperty("observedAt");
    expect(sourced.provenance).not.toHaveProperty("environment");
  });
});

describe("staleness", () => {
  it("preserves when the value was last actually seen", () => {
    const sourced = live("data", production, "2026-09-03T01:00:00Z");
    const demoted = toStale(sourced, "offline");

    expect(demoted.provenance.kind).toBe("stale");
    // A human judging whether to trust old data needs its age, not the moment
    // we noticed the connection dropped.
    expect(demoted.provenance).toMatchObject({ observedAt: "2026-09-03T01:00:00Z", reason: "offline" });
  });

  it("does not invent staleness for values that were never live", () => {
    expect(toStale(demo(1, "fixture"), "offline").provenance.kind).toBe("demo");
    expect(toStale(unknown(1, "no fetch"), "offline").provenance.kind).toBe("unknown");
  });

  it("keeps the environment when demoting", () => {
    const demoted = toStale(live(1, localClone, "2026-09-03T01:00:00Z"), "poll_failed");

    expect(demoted.provenance).toMatchObject({ environment: localClone });
  });
});

describe("derivation cannot manufacture freshness", () => {
  it("keeps provenance through a map", () => {
    const derived = mapSourced(stale(2, production, "offline", "2026-09-03T00:00:00Z"), (n) => n * 10);

    expect(derived.value).toBe(20);
    // A computation is no fresher than its input.
    expect(derived.provenance.kind).toBe("stale");
  });

  it("takes the weaker provenance when combining", () => {
    const fresh = live(1, production);
    const old = stale(2, production, "offline", "2026-09-03T00:00:00Z");

    expect(combine(fresh, old, (a, b) => a + b).provenance.kind).toBe("stale");
    expect(combine(old, fresh, (a, b) => a + b).provenance.kind).toBe("stale");
  });

  it("degrades all the way to unknown", () => {
    // A figure built from one live and one unknown input is not live. This is
    // how a confident-looking number gets assembled out of nothing.
    const result = combine(live(1, production), unknown(2, "never fetched"), (a, b) => a + b);

    expect(result.provenance.kind).toBe("unknown");
    expect(isTrustworthy(result)).toBe(false);
  });

  it("ranks demo below stale, so a fixture cannot pass as old real data", () => {
    const result = combine(stale(1, production, "offline", "2026-09-03T00:00:00Z"), demo(2, "fixture"), (a, b) => a + b);

    expect(result.provenance.kind).toBe("demo");
  });
});

describe("descriptions state the environment", () => {
  it("names a local origin and revision, and says when it is unattested", () => {
    const text = describeProvenance(live(1, localClone, "2026-09-03T01:00:00Z").provenance);

    expect(text).toContain("local");
    expect(text).toContain("127.0.0.1:8765");
    expect(text).toContain("abc1234");
    // The gap that caused tonight's over-claim must be visible, not assumed.
    expect(text).toContain("unattested");
  });

  it("names who attested a deployment match", () => {
    const attested: Environment = { ...localClone, target: "production", attestedBy: "nikk" };
    const text = describeProvenance(live(1, attested, "2026-09-03T01:00:00Z").provenance);

    expect(text).toContain("attested by nikk");
    expect(text).not.toContain("unattested");
  });

  it("explains why an unknown value is unknown", () => {
    expect(describeProvenance(unknown(1, "enforcement not verified on this deployment").provenance))
      .toContain("enforcement not verified");
  });

  it("marks demo data as demo in the description, not just the badge", () => {
    expect(describeProvenance(demo(1, "seeded fixture").provenance)).toContain("demo data");
  });
});
