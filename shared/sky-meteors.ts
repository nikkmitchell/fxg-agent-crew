export const BOLIDE_CHANCE = .001;
export type MeteorSpec = { bolide: boolean; sweep: number; trail: number; duration: number; width: number; strength: number; inclination: number; curve: number; linger: number };
/** All angles are degrees. Rare accents, not a shower or a jump-scare. */
export function meteorSpec(random: () => number, force?: "meteor" | "bolide"): MeteorSpec {
  const bolide = force ? force === "bolide" : random() < BOLIDE_CHANCE;
  const inclination = 8 + random() * 67;
  const shallow = 1 - inclination / 75;
  const sweep = bolide ? 150 + random() * 20 : 12 + shallow * 16 + random() * 4;
  // Shallow entries travel farther, rather than forcing a large speed change.
  const speed = (bolide ? 42 : 13) * (.9 + random() * .2);
  return bolide
    ? { bolide, inclination, curve: .25 + shallow * .9, linger: 1.2 + random() * .4,
        sweep, trail: 14 + random() * 8, duration: sweep / speed,
        width: .09 + random() * .06, strength: 2 + random() * 1.6 }
    : { bolide, inclination, curve: .06 + shallow * .5, linger: .35 + random() * .5,
        sweep, trail: 2 + random() * 4, duration: sweep / speed,
        width: .06 + random() * .06, strength: .65 + random() * .95 };
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
/** The moving head flares mid-flight and burns out before it stops. */
export function meteorHeadGlow(age: number, duration: number): number {
  const phase = Math.max(0, Math.min(1, age / duration));
  const t = Math.max(0, Math.min(1, (phase - .65) / .35));
  return (1 - t * t * (3 - 2 * t)) * (1 + .6 * Math.sin(Math.PI * phase) ** 2);
}
