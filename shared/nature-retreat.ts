export type NatureKind = "sakura" | "fireflies";
export const NATURE_COUNTS = { blossoms: 280, petals: 112, fallen: 64, fireflies: 72 } as const;
export function natureRandom(seed: number) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
/** Shared local reveal, not shared state: leave the place and it returns to quiet. */
export function natureLevel(distance: number) {
  const t = Math.max(0, Math.min(1, (distance - 1.6) / 3.4));
  return 1 - t * t * (3 - 2 * t);
}
export function natureSeeds(kind: NatureKind, count: number) {
  const random = natureRandom(kind === "sakura" ? 0x73616b75 : 0x66697265);
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    const radius = .6 + Math.sqrt(random()) * 2.2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
      y: .4 + random() * 2.35, phase: random(), speed: .65 + random() * .7,
      size: .8 + random() * .5, tint: random() };
  });
}
