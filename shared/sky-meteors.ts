export const BOLIDE_CHANCE = .001;
export type MeteorSpec = { bolide: boolean; sweep: number; trail: number; duration: number; width: number; strength: number; inclination: number; curve: number; linger: number };
/** All angles are degrees. Rare accents, not a shower or a jump-scare. */
export function meteorSpec(random: () => number, force?: "meteor" | "bolide"): MeteorSpec {
  const bolide = force ? force === "bolide" : random() < BOLIDE_CHANCE;
  const inclination = 8 + random() * 67;
  const shallow = 1 - inclination / 75;
  return bolide
    ? { bolide, inclination, curve: .25 + shallow * .9, linger: 1.2 + random() * .4,
        sweep: 150 + random() * 20, trail: 14 + random() * 8, duration: 3 + shallow * 1.4,
        width: .09 + random() * .06, strength: 1.5 + random() * 1.1 }
    : { bolide, inclination, curve: .06 + shallow * .5, linger: .35 + random() * .5,
        sweep: 9 + random() * 18, trail: 2 + random() * 4, duration: .7 + shallow * 2,
        width: .06 + random() * .06, strength: .8 + random() * .7 };
}
/** Average two minutes, broad intervals; re-entry does not replay missed events. */
export function nextMeteorDelay(random: () => number): number { return 45 - Math.log(Math.max(.0001, 1 - random())) * 75; }
export function meteorOpacity(age: number, duration: number, linger = .8): number {
  if (age <= 0 || age >= duration + linger) return 0;
  const attack = Math.min(1, age / .14);
  const after = Math.max(0, Math.min(1, (age - duration) / linger));
  const decay = 1 - after * after * (3 - 2 * after);
  return attack * attack * (3 - 2 * attack) * decay;
}
