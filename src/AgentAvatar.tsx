import { type AvatarRecipe, avatarRecipe, initialsOf } from "./avatar";

/**
 * The generated tile behind an actor's initials.
 *
 * This component used to exist and be imported by nobody — only its colour
 * helper was live, so every avatar on the product was a flat square while the
 * art sat here unrendered. It is now the one renderer.
 *
 * The motif is decoration and is marked aria-hidden. The initials are the part
 * that carries information, they sit above everything, and their colour is
 * measured against the tile rather than paired with it by eye (see avatar.ts).
 *
 * Deliberately NOT a face. A generated face invites a reader to believe there
 * is a photograph of a real person behind it, which for half the actors here —
 * the agents — would be a small lie told on every screen.
 */
export function AvatarArt({ recipe, size }: { recipe: AvatarRecipe; size: number }) {
  const { accent, offset, rotation, scale } = recipe;
  return (
    <g transform={`rotate(${rotation} 32 32) scale(${scale}) translate(${(1 - scale) * 32} ${(1 - scale) * 32})`} opacity=".85">
      {recipe.motif === 0 && (
        <>
          <circle cx={offset + 6} cy="24" r="20" fill={accent} />
          <circle cx={offset + 30} cy="44" r="12" fill={accent} opacity=".55" />
        </>
      )}
      {recipe.motif === 1 && (
        <>
          <path d={`M${offset} 4 L60 56 L4 56 Z`} fill={accent} />
          <path d={`M${offset + 18} 30 L64 64 L20 64 Z`} fill={accent} opacity=".45" />
        </>
      )}
      {recipe.motif === 2 && (
        <>
          <rect x="2" y={offset} width="60" height="16" rx="8" fill={accent} />
          <rect x="2" y={offset + 22} width="38" height="16" rx="8" fill={accent} opacity=".5" />
        </>
      )}
      {recipe.motif === 3 && (
        <>
          <circle cx="32" cy="32" r={offset + 4} fill="none" stroke={accent} strokeWidth="7" />
          <circle cx="32" cy="32" r={offset / 2} fill={accent} opacity=".6" />
        </>
      )}
      {recipe.motif === 4 && (
        <>
          <path d={`M4 ${offset + 18} Q32 ${offset - 16} 60 ${offset + 18}`} fill="none" stroke={accent} strokeWidth="9" strokeLinecap="round" />
          <path d={`M4 ${offset + 36} Q32 ${offset + 2} 60 ${offset + 36}`} fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round" opacity=".5" />
        </>
      )}
      {recipe.motif === 5 && (
        <>
          <rect x={offset - 4} y="2" width="22" height="60" rx="11" fill={accent} />
          <rect x={offset + 22} y="14" width="22" height="44" rx="11" fill={accent} opacity=".45" />
        </>
      )}
    </g>
  );
}

export function AgentAvatar({
  seed,
  label,
  size = 52,
  agent = false,
}: {
  seed: string;
  label: string;
  size?: number;
  agent?: boolean;
}) {
  const recipe = avatarRecipe(seed);
  return (
    <svg className="agent-avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${label} avatar`}>
      <defs>
        <clipPath id={`avatar-clip-${seed.replace(/[^a-zA-Z0-9]/g, "")}`}>
          <rect width="64" height="64" rx={agent ? 12 : 32} />
        </clipPath>
      </defs>
      <g clipPath={`url(#avatar-clip-${seed.replace(/[^a-zA-Z0-9]/g, "")})`}>
        <rect width="64" height="64" fill={recipe.paper} />
        <AvatarArt recipe={recipe} size={size} />
      </g>
      <text x="32" y="40" textAnchor="middle" fill={recipe.ink} fontSize="24" fontWeight="800" fontFamily="Manrope, system-ui, sans-serif">
        {initialsOf(label)}
      </text>
    </svg>
  );
}

export { avatarRecipe } from "./avatar";
