export const BOLIDE_CHANCE = .001;
export type MeteorSpec = { bolide: boolean; sweep: number; trail: number; duration: number; width: number; strength: number };
/** All angles are degrees. Rare accents, not a shower or a jump-scare. */
export function meteorSpec(random: () => number, force?: "meteor" | "bolide"): MeteorSpec {
  const bolide = force ? force === "bolide" : random() < BOLIDE_CHANCE;
  return bolide
    ? { bolide, sweep: 150 + random() * 20, trail: 14 + random() * 8, duration: 3.2 + random() * 1.2, width: .07 + random() * .03, strength: .65 }
    : { bolide, sweep: 5 + random() * 12, trail: 1 + random() * 4, duration: .9 + random() * .8, width: .012 + random() * .02, strength: .25 + random() * .25 };
}
/** Average two minutes, broad intervals; re-entry does not replay missed events. */
export function nextMeteorDelay(random: () => number): number { return 45 - Math.log(Math.max(.0001, 1 - random())) * 75; }
export function meteorOpacity(age: number, duration: number): number {
  const t = Math.max(0, Math.min(1, age / duration));
  return Math.sin(Math.PI * t) ** 1.5;
}
