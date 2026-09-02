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
/** Authoritative transport metadata: which message, from which authenticated sender. */
export type TransportRef = {
  roomName: string;
  messageId: number;
  /** Authenticated sender. Proves WHO SPOKE, never that what they said is true. */
  username: string;
};

export type EvidenceSource =
  /**
   * A field the SERVER owns and computes — room configuration, onlineUsers,
   * message metadata. The strongest evidence we have, and still only as good as
   * the server.
   */
  | { kind: "webharness_api"; endpoint: string }
  /**
   * Content a participant authored, delivered over authenticated transport.
   *
   * This is deliberately NOT the same as webharness_api. Transport proves who
   * sent a message; it says nothing about whether the message is true. Treating
   * the two alike is how "someone typed it in a chat room" becomes "verified
   * fact" purely because HTTPS carried it.
   */
  | { kind: "participant_statement"; ref: TransportRef }
  /**
   * An agent describing ITSELF — model, runtime, avatar, location, bio. The
   * transport can prove who SENT it; nothing can verify the content. These must
   * never render as facts about the world.
   */
  /**
   * An agent describing ITSELF. The transport can prove who sent the claim;
   * nothing can verify its content.
   *
   * `ref` is REQUIRED, not optional: a self-report with no transport binding is
   * an unattributable assertion, and we would have no way to show a reader who
   * made it or to check the claimed actor matches the authenticated sender.
   */
  | { kind: "agent_self_report"; actor: ActorRef; ref: TransportRef }
  /**
   * A human asserting something the system cannot check — most importantly that
   * a deployment matches a revision. Evidence ABOUT an environment, which is
   * why it lives here rather than inside Environment.
   */
  | { kind: "operator_attestation"; actor: ActorRef; statement: string; attestedAt: string }
  | { kind: "github"; repo: string; ref?: string }
  | { kind: "fixture"; note: string }
  /**
   * A value computed from several inputs. Keeps EVERY contributing source
   * rather than electing a winner: a figure built from production and a local
   * clone, or from GitHub and an agent's self-report, must not be attributed to
   * whichever one happened to rank higher.
   */
  | { kind: "derived"; from: EvidenceSource[] };

/** Why a value we wanted to refresh is out of date. */
export type StaleReason = "offline" | "poll_failed";

/**
 * `historical` is NOT a kind of stale, which is why it is a separate case
 * rather than a StaleReason.
 *
 * Stale means we tried to know the current value and failed — the reading is
 * unreliable. Historical means a newer value exists and this older one is being
 * shown deliberately, so it is perfectly reliable as a statement about the
 * past. Rendering a deliberate historical view with a "connection problem"
 * badge would be a false alarm; rendering a failed refresh as history would
 * hide a real one.
 */
export type Freshness =
  | { kind: "live" }
  | { kind: "stale"; lastObservedAt: string; reason: StaleReason }
  | { kind: "historical"; observedAt: string; supersededBy?: string };

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
      /**
       * Every environment that contributed. Usually one. A value derived from
       * production and a local clone keeps BOTH, so the mixture cannot be
       * quietly presented as though it came from either alone.
       */
      environments: Environment[];
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
  environment: Environment | Environment[],
  times: { observedAt: string; receivedAt?: string },
  freshness: Freshness = { kind: "live" },
): Sourced<T> {
  return {
    state: "known",
    value,
    source,
    freshness,
    environments: Array.isArray(environment) ? environment : [environment],
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
  if (sourced.state !== "known" || sourced.freshness.kind !== "live") return false;
  return isVerifiableSource(sourced.source);
}

/**
 * Only server-owned or repository-owned data counts.
 *
 * A participant_statement is excluded even though it arrived over authenticated
 * transport: the transport proves who spoke, never that they were right. A
 * derived value is verifiable only if EVERY contributor is — one unverifiable
 * input taints the result, which is the whole point of keeping lineage.
 */
function isVerifiableSource(source: EvidenceSource): boolean {
  switch (source.kind) {
    case "webharness_api":
    case "github":
      return true;
    case "derived":
      return source.from.length > 0 && source.from.every(isVerifiableSource);
    default:
      return false;
  }
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
    const notes = [a.state === "demo" ? a.note : null, b.state === "demo" ? b.note : null].filter(Boolean);
    return demo(fn(a.value, b.value), notes.join("; "));
  }

  // Both known. Keep EVERY contributing source and environment rather than
  // electing a winner — a value built from production and a local clone, or
  // from GitHub and an agent's self-report, must not end up attributed to
  // whichever one ranked higher. That attribution is exactly the overclaim
  // this type exists to prevent.
  const from = [...flattenSource(a.source), ...flattenSource(b.source)];
  const environments = dedupeEnvironments([...a.environments, ...b.environments]);

  return {
    state: "known",
    value: fn(a.value, b.value),
    source: { kind: "derived", from },
    freshness: weakerFreshness(a.freshness, b.freshness),
    environments,
    // Oldest contributing observation and newest receipt: the result is no
    // fresher than its stalest input.
    observedAt: a.observedAt < b.observedAt ? a.observedAt : b.observedAt,
    receivedAt: a.receivedAt > b.receivedAt ? a.receivedAt : b.receivedAt,
  };
}

/** Flatten nested derivations so lineage stays a flat, comparable list. */
function flattenSource(source: EvidenceSource): EvidenceSource[] {
  return source.kind === "derived" ? source.from.flatMap(flattenSource) : [source];
}

function dedupeEnvironments(environments: Environment[]): Environment[] {
  const seen = new Map<string, Environment>();
  for (const env of environments) {
    seen.set(`${env.target}|${env.origin ?? ""}|${env.revision ?? ""}`, env);
  }
  return [...seen.values()];
}

/**
 * Weakest wins, and the ordering is deliberate: stale beats historical beats
 * live. A stale input means we do not reliably know the current value, which
 * contaminates anything computed from it.
 */
function weakerFreshness(a: Freshness, b: Freshness): Freshness {
  const rank = { stale: 0, historical: 1, live: 2 } as const;
  return rank[a.kind] <= rank[b.kind] ? a : b;
}

/** True when a value came from more than one environment. */
export function isMixedEnvironment(sourced: Sourced<unknown>): boolean {
  return sourced.state === "known" && sourced.environments.length > 1;
}

/* -------------------------------------------------------------- rendering -- */

/**
 * Never empty, and never collapses the two axes into one.
 *
 * An earlier version returned "STALE" for anything not live, which silently
 * erased the source: an agent's unverifiable self-report and a server-owned
 * fact both rendered identically once they went stale. The whole reason source
 * and freshness are orthogonal in the type is that they answer different
 * questions — WHO says so, and HOW CURRENT it is — so the label must carry
 * both or the type's guarantee stops at the boundary of the screen.
 *
 * Shape: SOURCE [(LOCAL)] [· FRESHNESS]
 *   LIVE · SELF-REPORTED · CLAIMED (LOCAL) · CLAIMED · STALE · SELF-REPORTED · HISTORICAL
 */
export function provenanceLabel(sourced: Sourced<unknown>): string {
  if (sourced.state === "unknown") return "UNKNOWN";
  if (sourced.state === "demo") return "DEMO";

  const source = sourceLabel(sourced.source, sourced);
  const local = sourced.environments.length > 0 && sourced.environments.every((e) => e.target === "local");
  const mixed = sourced.environments.length > 1;

  const scope = mixed ? " (MIXED)" : local ? " (LOCAL)" : "";
  const freshness =
    sourced.freshness.kind === "stale" ? " · STALE"
    : sourced.freshness.kind === "historical" ? " · HISTORICAL"
    : "";

  return `${source}${scope}${freshness}`;
}

/** The source half of a label. Says WHO vouches, independent of currency. */
function sourceLabel(source: EvidenceSource, sourced: Sourced<unknown>): string {
  switch (source.kind) {
    case "agent_self_report":
      return "SELF-REPORTED";
    case "participant_statement":
      // Said by an authenticated participant: delivered reliably, not verified.
      return "CLAIMED";
    case "operator_attestation":
      return "ATTESTED";
    case "webharness_api":
    case "github":
      return "LIVE";
    case "fixture":
      return "DEMO";
    case "derived":
      // A derivation is only as strong as its weakest contributor.
      return isVerifiedFact(sourced) ? "LIVE" : "DERIVED";
  }
}

/** One-line summary of a source, used when describing a derivation. */
function describeSource(source: EvidenceSource): string {
  switch (source.kind) {
    case "webharness_api":
      return `server API ${source.endpoint}`;
    case "participant_statement":
      return `stated by ${source.ref.username} in message ${source.ref.messageId}`;
    case "agent_self_report":
      return `${source.actor.username} about itself, unverifiable`;
    case "operator_attestation":
      return `attested by ${source.actor.username}: ${source.statement}`;
    case "github":
      return `${source.repo}${source.ref ? `@${source.ref}` : ""}`;
    case "fixture":
      return `fixture: ${source.note}`;
    case "derived":
      return `derived from [${source.from.map(describeSource).join(" + ")}]`;
  }
}

/** Explanation for a tooltip or evidence panel, naming every source and environment. */
export function describeProvenance(sourced: Sourced<unknown>): string {
  if (sourced.state === "unknown") return `not known: ${sourced.reason}`;
  if (sourced.state === "demo") return `demo data: ${sourced.note}`;

  const when =
    sourced.freshness.kind === "stale"
      ? `last seen ${sourced.freshness.lastObservedAt} (${sourced.freshness.reason})`
      : sourced.freshness.kind === "historical"
        ? `historical, observed ${sourced.freshness.observedAt}`
        : `observed ${sourced.observedAt}`;

  const where = sourced.environments
    .map((env) => {
      const origin = env.origin ? ` (${env.origin})` : "";
      const rev = env.revision ? ` at ${env.revision}` : "";
      // An unattested revision must never read as a statement about a
      // deployment; say so rather than leaving it inferable.
      const attested = env.revision ? " (deployment match unattested)" : "";
      return `${env.target}${origin}${rev}${attested}`;
    })
    .join(" + ");

  return `${when} — ${describeSource(sourced.source)}; ${where}`;
}
