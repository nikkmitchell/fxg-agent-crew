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
/* ------------------------------------------------------------ constructors -- */
/** No constructor accepts a bare value: every one demands its justification. */
export function known(value, source, environment, times, freshness = { kind: "live" }) {
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
export function demo(value, note) {
    return { state: "demo", value, source: { kind: "fixture", note }, note };
}
/**
 * Takes NO value, by construction. This is the whole point: an unknown cannot
 * carry a guess.
 */
export function unknown(reason, environment) {
    return { state: "unknown", reason, environment };
}
/* ------------------------------------------------------------- transitions -- */
/** Demote a known value, preserving when it was last actually observed. */
export function toStale(sourced, reason) {
    if (sourced.state !== "known")
        return sourced;
    const lastObservedAt = sourced.freshness.kind === "stale" ? sourced.freshness.lastObservedAt : sourced.observedAt;
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
export function isVerifiedFact(sourced) {
    if (sourced.state !== "known" || sourced.freshness.kind !== "live")
        return false;
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
function isVerifiableSource(source) {
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
export function hasValue(sourced) {
    return sourced.state === "known" || sourced.state === "demo";
}
/** Map a value, keeping its provenance. A derivation is never fresher than its input. */
export function mapSourced(sourced, fn) {
    if (sourced.state === "unknown")
        return sourced;
    if (sourced.state === "demo")
        return { ...sourced, value: fn(sourced.value) };
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
export function combine(a, b, fn) {
    if (a.state === "unknown")
        return unknown(`derived from unknown: ${a.reason}`, a.environment);
    if (b.state === "unknown")
        return unknown(`derived from unknown: ${b.reason}`, b.environment);
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
function flattenSource(source) {
    return source.kind === "derived" ? source.from.flatMap(flattenSource) : [source];
}
function dedupeEnvironments(environments) {
    const seen = new Map();
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
function weakerFreshness(a, b) {
    const rank = { stale: 0, historical: 1, live: 2 };
    return rank[a.kind] <= rank[b.kind] ? a : b;
}
/** True when a value came from more than one environment. */
export function isMixedEnvironment(sourced) {
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
 * Shape: SOURCE [(SCOPE)] · FRESHNESS — both axes, always, in that order.
 *
 * Freshness is never omitted, and the source half never borrows a freshness
 * word. An earlier version used LIVE for server-owned data, which is a category
 * error: LIVE says WHEN, not WHO. It produced the self-contradictory
 * "LIVE · HISTORICAL" — a label asserting a value is both current and
 * superseded.
 *
 *   VERIFIED · LIVE            server-owned or repository-owned, current
 *   VERIFIED · STALE           same source, refresh failed
 *   VERIFIED (LOCAL) · LIVE    observed on a local instance, not a deployment
 *   CLAIMED · LIVE             an authenticated participant said so, just now
 *   SELF-REPORTED · HISTORICAL an agent's claim about itself, superseded
 */
export function provenanceLabel(sourced) {
    if (sourced.state === "unknown")
        return "UNKNOWN";
    if (sourced.state === "demo")
        return "DEMO";
    const source = sourceLabel(sourced.source, sourced);
    const local = sourced.environments.length > 0 && sourced.environments.every((e) => e.target === "local");
    const mixed = sourced.environments.length > 1;
    const scope = mixed ? " (MIXED)" : local ? " (LOCAL)" : "";
    const freshness = sourced.freshness.kind === "stale" ? "STALE"
        : sourced.freshness.kind === "historical" ? "HISTORICAL"
            : "LIVE";
    return `${source}${scope} · ${freshness}`;
}
/** The source half of a label. Says WHO vouches, independent of currency. */
function sourceLabel(source, sourced) {
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
            // VERIFIED, not LIVE: this names who vouches for the value, not how
            // current it is. Freshness is the other half of the label.
            return "VERIFIED";
        case "fixture":
            return "DEMO";
        case "derived":
            // A derivation is only as strong as its weakest contributor.
            return isVerifiedFact(sourced) ? "VERIFIED" : "DERIVED";
    }
}
/** One-line summary of a source, used when describing a derivation. */
function describeSource(source) {
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
export function describeProvenance(sourced) {
    if (sourced.state === "unknown")
        return `not known: ${sourced.reason}`;
    if (sourced.state === "demo")
        return `demo data: ${sourced.note}`;
    const when = sourced.freshness.kind === "stale"
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
//# sourceMappingURL=provenance.js.map