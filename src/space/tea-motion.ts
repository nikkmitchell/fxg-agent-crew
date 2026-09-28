export const TEA_POUR_MS = 3500;

export type TeaPourFrame = {
  fill: number;
  pouring: boolean;
  complete: boolean;
};

/** Resolve the visible pour, snapping it to completion for reduced-motion users. */
export function teaPourFrame(
  pouredAt: number | null,
  now: number,
  reducedMotion: boolean,
  snappedAt: number | null = null,
): TeaPourFrame {
  if (pouredAt === null) return { fill: 0, pouring: false, complete: false };
  if (reducedMotion || snappedAt === pouredAt) return { fill: 1, pouring: false, complete: true };

  const elapsed = Math.max(0, now - pouredAt);
  return {
    fill: Math.min(1, elapsed / TEA_POUR_MS),
    pouring: elapsed < TEA_POUR_MS,
    complete: elapsed >= TEA_POUR_MS,
  };
}
