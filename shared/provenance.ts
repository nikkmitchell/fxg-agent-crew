/**
 * Provenance: where a displayed value came from, carried with the value.
 *
 * The product principle is that every visible state says what it really is —
 * LIVE, STALE, DEMO or UNKNOWN. This makes that a type rather than a
 * convention, because conventions have failed us repeatedly in one day:
 *
 *   - a progress bar reported "running" while permanently stuck at 92%
 *   - a completed run re-emitted its terminal event on every reload
 *   - an event validator accepted payloads it had never checked
 *   - a local security finding was described as a fact about production
 *
 * Every one of those was a component asserting more than it knew, and every one
 * passed review and tests. Intent did not catch them. A type can: there is no
 * way to construct a Sourced<T> without stating where the value came from, so
 * "we forgot to mark this stale" becomes a compile error rather than something
 * a human notices on a screenshot three days later.
 */

/**
 * Which system was actually observed.
 *
 * `revision` and `attestedBy` are optional because we usually do NOT know them,
 * and that ignorance is the point. A finding reproduced against a local clone
 * says nothing about a deployed service unless somebody asserts the two match —
 * the assumption that they do is exactly the mistake this field exists to stop.
 */
export type Environment = {
  target: "production" | "local" | "unspecified";
  /** Origin actually talked to, e.g. "http://127.0.0.1:8765". */
  origin?: string;
  /** Commit of the code observed, when genuinely known. */
  revision?: string;
  /** Who asserted that a deployment matches `revision`. Never inferred. */
  attestedBy?: string;
};

/** Why a value is no longer known to be current. */
export type StaleReason = "offline" | "poll_failed" | "superseded";

/**
 * Note that `demo` and `unknown` carry no `observedAt`. They were never
 * observed, and stamping a time on an unobserved value is itself a small lie —
 * it makes fabricated data look sourced.
 */
export type Provenance =
  | { kind: "live"; observedAt: string; environment: Environment }
  | { kind: "stale"; observedAt: string; environment: Environment; reason: StaleReason }
  | { kind: "demo"; note: string }
  | { kind: "unknown"; reason: string };

export type Sourced<T> = {
  readonly value: T;
  readonly provenance: Provenance;
};

/* ------------------------------------------------------------ constructors -- */

/**
 * There is deliberately no `of(value)` or `wrap(value)`. Every constructor
 * demands the context that justifies the claim, which is what stops provenance
 * from decaying into a field everyone sets to "live" by default.
 */

export function live<T>(value: T, environment: Environment, observedAt = new Date().toISOString()): Sourced<T> {
  return { value, provenance: { kind: "live", observedAt, environment } };
}

export function stale<T>(value: T, environment: Environment, reason: StaleReason, observedAt: string): Sourced<T> {
  return { value, provenance: { kind: "stale", observedAt, environment, reason } };
}

export function demo<T>(value: T, note: string): Sourced<T> {
  return { value, provenance: { kind: "demo", note } };
}

export function unknown<T>(value: T, reason: string): Sourced<T> {
  return { value, provenance: { kind: "unknown", reason } };
}

/**
 * Demote a previously-live value that we can no longer confirm, preserving when
 * it was last actually seen. Connection loss must not silently keep rendering
 * as LIVE, and the age of the last good observation is what a human needs in
 * order to judge whether to trust it.
 */
export function toStale<T>(sourced: Sourced<T>, reason: StaleReason): Sourced<T> {
  const { provenance } = sourced;
  if (provenance.kind === "live" || provenance.kind === "stale") {
    return stale(sourced.value, provenance.environment, reason, provenance.observedAt);
  }
  // Demo and unknown values were never live; there is nothing to go stale.
  return sourced;
}

/**
 * Map the value, keeping the provenance. Deriving from a stale input yields a
 * stale output — a computation cannot be fresher than what it was computed
 * from, and losing that on the way to the screen is how confident-looking
 * numbers get built out of old data.
 */
export function mapSourced<T, U>(sourced: Sourced<T>, fn: (value: T) => U): Sourced<U> {
  return { value: fn(sourced.value), provenance: sourced.provenance };
}

/**
 * Combine two sourced values, taking the WEAKER provenance.
 *
 * Ordering: unknown < demo < stale < live. A figure derived from one live and
 * one unknown input is not live, and presenting it as such is the failure mode
 * this whole module exists to prevent.
 */
export function combine<A, B, C>(a: Sourced<A>, b: Sourced<B>, fn: (a: A, b: B) => C): Sourced<C> {
  const rank = { unknown: 0, demo: 1, stale: 2, live: 3 } as const;
  const weaker = rank[a.provenance.kind] <= rank[b.provenance.kind] ? a.provenance : b.provenance;
  return { value: fn(a.value, b.value), provenance: weaker };
}

/* -------------------------------------------------------------- rendering -- */

/** True when the value may be presented as current fact. */
export function isTrustworthy(sourced: Sourced<unknown>): boolean {
  return sourced.provenance.kind === "live";
}

/** Short label for a badge. Never empty: an unlabelled value looks authoritative. */
export function provenanceLabel(provenance: Provenance): string {
  switch (provenance.kind) {
    case "live":
      return provenance.environment.target === "local" ? "LIVE (LOCAL)" : "LIVE";
    case "stale":
      return "STALE";
    case "demo":
      return "DEMO";
    case "unknown":
      return "UNKNOWN";
  }
}

/**
 * Human-readable explanation for a tooltip or evidence panel. Includes the
 * environment, so a claim proven against a local clone can never be read as a
 * statement about production without the reader seeing the difference.
 */
export function describeProvenance(provenance: Provenance): string {
  switch (provenance.kind) {
    case "live":
    case "stale": {
      const { target, origin, revision, attestedBy } = provenance.environment;
      const where = origin ? `${target} (${origin})` : target;
      const rev = revision ? ` at ${revision}` : "";
      const attest = attestedBy ? `, attested by ${attestedBy}` : revision ? ", unattested" : "";
      const prefix = provenance.kind === "stale" ? `last seen ${provenance.observedAt}` : `observed ${provenance.observedAt}`;
      return `${prefix} on ${where}${rev}${attest}`;
    }
    case "demo":
      return `demo data: ${provenance.note}`;
    case "unknown":
      return `not known: ${provenance.reason}`;
  }
}
