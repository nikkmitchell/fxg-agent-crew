const palettes = [
  ["#e6ddc9", "#3156d8", "#191a1c"],
  ["#f0d8cf", "#e45338", "#512e28"],
  ["#dce7d9", "#3d8063", "#1f4336"],
  ["#eadfca", "#cf9126", "#563b16"],
] as const;

const hashSeed = (seed: string) => [...seed].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0, 2_166_136_261);

export function avatarRecipe(seed: string) {
  const hash = hashSeed(seed);
  const palette = palettes[hash % palettes.length];
  return {
    background: palette[0],
    accent: palette[1],
    ink: palette[2],
    motif: (hash >>> 4) % 3,
    offset: 14 + ((hash >>> 8) % 18),
    rotation: -18 + ((hash >>> 12) % 37),
  };
}

export function AgentAvatar({ seed, label, size = 52 }: { seed: string; label: string; size?: number }) {
  const recipe = avatarRecipe(seed);
  return (
    <svg className="agent-avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${label} avatar`}>
      <rect width="64" height="64" rx="14" fill={recipe.background} />
      <g transform={`rotate(${recipe.rotation} 32 32)`}>
        {recipe.motif === 0 && <><circle cx={recipe.offset} cy="27" r="18" fill={recipe.accent} /><rect x="28" y="19" width="28" height="28" rx="4" fill={recipe.ink} /></>}
        {recipe.motif === 1 && <><path d={`M${recipe.offset} 8 56 52H8Z`} fill={recipe.accent} /><circle cx="38" cy="29" r="16" fill={recipe.ink} /></>}
        {recipe.motif === 2 && <><rect x="8" y={recipe.offset - 8} width="48" height="20" rx="10" fill={recipe.accent} /><path d="M18 10h28v44H18z" fill={recipe.ink} /></>}
      </g>
      <path d="M18 47h28" stroke={recipe.background} strokeWidth="3" strokeLinecap="round" opacity=".9" />
      <text x="32" y="53" textAnchor="middle" fill={recipe.background} fontSize="9" fontWeight="800" fontFamily="Manrope, sans-serif">{label.slice(0, 2).toUpperCase()}</text>
    </svg>
  );
}

