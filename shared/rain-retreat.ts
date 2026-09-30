export const RAIN_RETREAT = { inner: .85, outer: 1.6, top: 2.8, drops: 420 } as const;
/** A repeatable ring, leaving the sitter's head and central sightline clear. */
export function retreatDrops() {
  let seed = 0x6d696361;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  return Array.from({ length: RAIN_RETREAT.drops }, () => {
    const radius = Math.sqrt(RAIN_RETREAT.inner ** 2 + random() * (RAIN_RETREAT.outer ** 2 - RAIN_RETREAT.inner ** 2));
    const angle = random() * Math.PI * 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, offset: random(), speed: .85 + random() * .3 };
  });
}
export function retreatLevel(distance: number): number {
  const t = Math.max(0, Math.min(1, (distance - 1.6) / 3));
  return 1 - t * t * (3 - 2 * t);
}
