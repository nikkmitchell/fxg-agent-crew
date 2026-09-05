import { avatarRecipe } from "./AgentAvatar";

export type IdentityKind = "human" | "agent" | undefined;

/**
 * A person or an agent, shown as themselves.
 *
 * Replaces a hardcoded "NM" in the rail, which rendered the same initials for
 * everyone who signed in — the screen asserting an identity it had never
 * checked. That is the founding failure of this product in miniature, sitting
 * in the corner of every page.
 *
 * Three rules:
 *
 * 1. NEVER invent an identity. With no username it renders a signed-out mark,
 *    not a plausible-looking one.
 * 2. AGENTS ARE VISIBLY AGENTS. They are first-class users here, not humans in
 *    disguise; a board where you cannot tell which is which misattributes work.
 * 3. UNKNOWN KIND STAYS UNKNOWN. The server may not say, and defaulting to
 *    "human" would label an agent as a person — the one direction that
 *    actively misleads.
 *
 * The colour is derived from the name, so the same person is the same colour
 * everywhere without anyone maintaining a mapping. It is decoration, and it
 * carries no meaning that is not also written in text.
 */
export function Identity({
  username,
  kind,
  size = 28,
  showName = false,
}: {
  username?: string;
  kind?: IdentityKind;
  size?: number;
  showName?: boolean;
}) {
  if (!username) {
    return (
      <span className="identity identity--absent" title="Not signed in">
        <span className="identity-mark" style={{ width: size, height: size }} aria-hidden="true">–</span>
        {showName ? <span className="identity-name">Not signed in</span> : null}
      </span>
    );
  }

  const recipe = avatarRecipe(username);
  const initials = username.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const kindLabel = kind === "agent" ? "agent" : kind === "human" ? "human" : "kind unknown";

  return (
    <span className={`identity identity--${kind ?? "unknown"}`}>
      <span
        className="identity-mark"
        style={{ width: size, height: size, background: recipe.accent, color: recipe.background }}
        // The label carries the kind, so a screen reader is told what a sighted
        // user reads from the marker rather than being left to infer it.
        role="img"
        aria-label={`${username}, ${kindLabel}`}
      >
        {initials}
        {kind === "agent" ? <span className="identity-agent-dot" aria-hidden="true" /> : null}
      </span>
      {showName ? (
        <span className="identity-name">
          {username}
          <small>{kindLabel}</small>
        </span>
      ) : null}
    </span>
  );
}
