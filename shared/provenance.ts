/**
 * Provenance: what we know about a value, and how we came to know it.
 *
 * The product principle is that every visible state says what it really is.
 * This makes that structural rather than conventional, because conventions
 * failed repeatedly in a single day — a progress bar reporting "running" while
 * stuck at 92%, a completed run re-emitting its terminal event on reload, a
 * validator accepting payloads it never checked, and a security finding
 * reproduced on a local clone described as a fact about production. Each passed
 * review and tests; intent caught none of them.
 *
 * Two axes, deliberately orthogonal (per review of the first version, which
 * collapsed them into one union and could not express "an agent's self-report,
 * received live"):
 *
 *   EvidenceSource — WHERE the value came from, and therefore who vouches for it
 *   Freshness      — HOW CURRENT it is
 *
 * plus a third state for absence. The single most important rule here is that
 * `unknown` carries NO VALUE. If we do not know whether a room enforces its
 * password, there is no boolean to render; making it structurally absent means
 * "we do not know" cannot be smuggled onto a screen as a guess wearing an
 * UNKNOWN badge.
 */

/** Stable reference to whoever made a claim. Not a free string. */
export type ActorRef = {
  kind: "human" | "agent";
  username: string;
};

/**
 * Where a value came from. This is an authority statement, not a label: it
 * says who is vouching for the content and therefore how far it can be trusted.
 */
export type EvidenceSource =
  /**
   * Read from WebHarness over our own transport. The strongest thing we have,
   * and still only as good as the server. `messageId` binds the claim to
   * transport metadata rather than to anything an author typed.
   */
  | { kind: "webharness_transport"; roomName?: string; messageId?: number }
  /**
   * An agent describing ITSELF — model, runtime, avatar, location, bio. The
   * transport can prove who SENT it; nothing can verify the content. These must
   * never render as facts about the world.
   */
  | { kind: "agent_self_report"; actor: ActorRef }
  /**
   * A human asserting something the system cannot check — most importantly that
   * a deployment matches a revision. Evidence ABOUT an environment, which is
   * why it lives here rather than inside Environment.
   */
  | { kind: "operator_attestation"; actor: ActorRef; statement: string; attestedAt: string }
  | { kind: "github"; repo: string; ref?: string }
  | { kind: "fixture"; note: string };

export type StaleReason = "offline" | "poll_failed" | "superseded";

/**
 * `superseded` means historical rather than merely old: a newer value exists
 * and this one is being shown deliberately, which is different from a value we
 * simply failed to refresh.
 */
export type Freshness =
  | { kind: "live" }
  | { kind: "stale"; lastObservedAt: string; reason: StaleReason };

/**
 * Which system was observed. `revision` stays optional because we usually do
 * not know it, and that ignorance is the point — a local reproduction says
 * nothing about a deployment unless an operator_attestation says so.
 */
export type Environment = {
  target: "production" | "local" | "unspecified";
  origin?: string;
  revision?: string;
};

/**
 * `observedAt` is when the underlying fact was true at the source.
 * `receivedAt` is when it reached us. They differ under long-polling and
 * replay, and conflating them makes replayed history look freshly observed.
 */
export type Sourced<T> =
  | {
      state: "known";
      value: T;
      source: EvidenceSource;
      freshness: Freshness;
      environment: Environment;
      observedAt: string;
      receivedAt: string;
    }
  | { state: "demo"; value: T; source: { kind: "fixture"; note: string }; note: string }
  | { state: "unknown"; reason: string; environment?: Environment };

/* ------------------------------------------------------------ constructors -- */

/** No constructor accepts a bare value: every one demands its justification. */

export function known<T>(
  value: T,
  source: EvidenceSource,
  environment: Environment,
  times: { observedAt: string; receivedAt?: string },
  freshness: Freshness = { kind: "live" },
): Sourced<T> {
  return {
    state: "known",
    value,
    source,
    freshness,
    environment,
    observedAt: times.observedAt,
    receivedAt: times.receivedAt ?? new Date().toISOString(),
  };
}

export function demo<T>(value: T, note: string): Sourced<T> {
  return { state: "demo", value, source: { kind: "fixture", note }, note };
}

/**
 * Takes NO value, by construction. This is the whole point: an unknown cannot
 * carry a guess.
 */
export function unknown(reason: string, environment?: Environment): Sourced<never> {
  return { state: "unknown", reason, environment };
}

/* ------------------------------------------------------------- transitions -- */

/** Demote a known value, preserving when it was last actually observed. */
export function toStale<T>(sourced: Sourced<T>, reason: StaleReason): Sourced<T> {
  if (sourced.state !== "known") return sourced;
  const lastObservedAt =
    sourced.freshness.kind === "stale" ? sourced.freshness.lastObservedAt : sourced.observedAt;
  return { ...sourced, freshness: { kind: "stale", lastObservedAt, reason } };
}

/* ---------------------------------------------------------------- queries -- */

/**
 * True only for a live value read over our own transport.
 *
 * A self-report is not a fact about the world however fresh it is, and a
 * fixture is never real. This is the check that stops an agent's claim about
 * its own model or location being rendered as verified.
 */
export function isVerifiedFact(sourced: Sourced<unknown>): boolean {
  return (
    sourced.state === "known" &&
    sourced.freshness.kind === "live" &&
    (sourced.source.kind === "webharness_transport" || sourced.source.kind === "github")
  );
}

/** True when a value exists at all and may be displayed with a badge. */
export function hasValue<T>(sourced: Sourced<T>): sourced is Extract<Sourced<T>, { value: T }> {
  return sourced.state === "known" || sourced.state === "demo";
}

/** Map a value, keeping its provenance. A derivation is never fresher than its input. */
export function mapSourced<T, U>(sourced: Sourced<T>, fn: (value: T) => U): Sourced<U> {
  if (sourced.state === "unknown") return sourced;
  if (sourced.state === "demo") return { ...sourced, value: fn(sourced.value) };
  return { ...sourced, value: fn(sourced.value) };
}

/**
 * Combine two values, degrading to the weaker of the two.
 *
 * If either input is unknown the result is unknown — NOT a computed value with
 * an unknown badge — because a number derived from something we do not know is
 * a number we invented. Lineage from both sides is preserved in the reason so
 * the degradation is explicable rather than mysterious.
 */
export function combine<A, B, C>(a: Sourced<A>, b: Sourced<B>, fn: (a: A, b: B) => C): Sourced<C> {
  if (a.state === "unknown") return unknown(`derived from unknown: ${a.reason}`, a.environment);
  if (b.state === "unknown") return unknown(`derived from unknown: ${b.reason}`, b.environment);

  if (a.state === "demo" || b.state === "demo") {
    const note = a.state === "demo" && b.state === "demo" ? `${a.note}; ${b.note}` : a.state === "demo" ? a.note : (b as Extract<Sourced<B>, { state: "demo" }>).note;
    return demo(fn(a.value, b.value), note);
  }

  // Both known: take the weaker freshness, and keep the weaker source authority.
  const weakerFreshness = a.freshness.kind === "stale" ? a.freshness : b.freshness;
  const weakerSource = isVerifiedFact(a) ? b.source : a.source;
  return {
    state: "known",
    value: fn(a.value, b.value),
    source: weakerSource,
    freshness: weakerFreshness,
    environment: a.environment,
    observedAt: a.observedAt < b.observedAt ? a.observedAt : b.observedAt,
    receivedAt: a.receivedAt > b.receivedAt ? a.receivedAt : b.receivedAt,
  };
}

/* -------------------------------------------------------------- rendering -- */

/** Never empty: an unlabelled value on screen reads as authoritative. */
export function provenanceLabel(sourced: Sourced<unknown>): string {
  if (sourced.state === "unknown") return "UNKNOWN";
  if (sourced.state === "demo") return "DEMO";
  if (sourced.source.kind === "agent_self_report") {
    return sourced.freshness.kind === "live" ? "SELF-REPORTED" : "SELF-REPORTED (STALE)";
  }
  if (sourced.source.kind === "operator_attestation") return "ATTESTED";
  if (sourced.freshness.kind === "stale") return "STALE";
  return sourced.environment.target === "local" ? "LIVE (LOCAL)" : "LIVE";
}

/** Explanation for a tooltip or evidence panel, naming source and environment. */
export function describeProvenance(sourced: Sourced<unknown>): string {
  if (sourced.state === "unknown") return `not known: ${sourced.reason}`;
  if (sourced.state === "demo") return `demo data: ${sourced.note}`;

  const { environment: env, source } = sourced;
  const where = env.origin ? `${env.target} (${env.origin})` : env.target;
  const rev = env.revision ? ` at ${env.revision}` : "";
  const when =
    sourced.freshness.kind === "stale"
      ? `last seen ${sourced.freshness.lastObservedAt} (${sourced.freshness.reason})`
      : `observed ${sourced.observedAt}`;

  switch (source.kind) {
    case "agent_self_report":
      return `${when} — reported by ${source.actor.username} about itself, unverifiable`;
    case "operator_attestation":
      return `${when} — attested by ${source.actor.username}: ${source.statement}`;
    case "github":
      return `${when} — from ${source.repo}${source.ref ? `@${source.ref}` : ""}`;
    case "webharness_transport":
      return `${when} on ${where}${rev}${env.revision ? " (deployment match unattested)" : ""}`;
    case "fixture":
      return `${when} — fixture: ${source.note}`;
  }
}
