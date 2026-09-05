import { AvatarArt } from "./AgentAvatar";
import { avatarRecipe, initialsOf } from "./avatar";

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
 * 1. NEVER INVENT AN IDENTITY. With no username it renders a signed-out mark,
 *    not a plausible-looking one.
 * 2. AGENTS ARE VISIBLY AGENTS. They are first-class users here, not humans in
 *    disguise; a board where you cannot tell which is which misattributes work.
 * 3. UNKNOWN KIND STAYS UNKNOWN. The server may not say, and defaulting to
 *    "human" would label an agent as a person — the one direction that actively
 *    misleads.
 *
 * WHAT THE PICTURE IS ALLOWED TO SAY. Shape carries kind, because kind is a
 * fact the log records: a circle is a human, a rounded square is an agent, and
 * a dashed edge is an actor whose kind we were never told. Colour and motif
 * carry NOTHING — they are hashed from the name so the same actor looks the
 * same everywhere without anyone maintaining a mapping. Every one of these
 * distinctions is also written in the accessible label, so nothing here is
 * available only to someone who can see it and already knows the code.
 */
export function Identity({
  username,
  kind,
  size = 28,
  showName = false,
  displayName,
}: {
  username?: string;
  kind?: IdentityKind;
  size?: number;
  showName?: boolean;
  /** A profile's chosen name. The username is still the identity underneath. */
  displayName?: string;
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
  const shown = displayName?.trim() || username;
  const kindLabel = kind === "agent" ? "agent" : kind === "human" ? "human" : "kind unknown";
  const clipId = `id-clip-${username.replace(/[^a-zA-Z0-9]/g, "")}-${size}`;
  const radius = kind === "agent" ? 14 : 32;

  return (
    <span className={`identity identity--${kind ?? "unknown"}`}>
      <svg
        className="identity-art"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        // The label carries the kind, so a screen reader is told what a sighted
        // reader takes from the shape rather than being left to infer it.
        role="img"
        aria-label={`${shown}, ${kindLabel}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect width="64" height="64" rx={radius} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect width="64" height="64" fill={recipe.paper} />
          <AvatarArt recipe={recipe} size={size} />
        </g>
        {kind === undefined ? (
          // A dashed edge for an actor the log never gave a kind for. Drawn
          // rather than defaulted, because "human" is the guess that misleads.
          <rect x="1.5" y="1.5" width="61" height="61" rx={radius} fill="none" stroke={recipe.ink} strokeWidth="3" strokeDasharray="7 6" opacity=".65" />
        ) : null}
        <text x="32" y="41" textAnchor="middle" fill={recipe.ink} fontSize="26" fontWeight="800" fontFamily="Manrope, system-ui, sans-serif">
          {initialsOf(shown)}
        </text>
      </svg>
      {showName ? (
        <span className="identity-name">
          {shown}
          <small>
            {kindLabel}
            {displayName?.trim() && displayName.trim() !== username ? ` · ${username}` : ""}
          </small>
        </span>
      ) : null}
    </span>
  );
}
