export const BOLIDE_CHANCE = .001;
export type MeteorSpec = { bolide: boolean; sweep: number; trail: number; duration: number; width: number; strength: number; inclination: number; curve: number; linger: number; peak: number };
/** All angles are degrees. Rare accents, not a shower or a jump-scare. */
export function meteorSpec(random: () => number, force?: "meteor" | "bolide"): MeteorSpec {
  const bolide = force ? force === "bolide" : random() < BOLIDE_CHANCE;
  const inclination = 8 + random() * 67;
  const shallow = 1 - inclination / 75;
  const sweep = bolide ? 150 + random() * 20 : 12 + shallow * 16 + random() * 4;
  // Shallow entries travel farther, rather than forcing a large speed change.
  const speed = (bolide ? 42 : 13) * (.9 + random() * .2);
  const peak = .3 + random() * .3;
  return bolide
    ? { bolide, inclination, peak, curve: .25 + shallow * .9, linger: 1.2 + random() * .4,
        sweep, trail: 14 + random() * 8, duration: sweep / speed,
        width: .09 + random() * .06, strength: 2 + random() * 1.6 }
    : { bolide, inclination, peak, curve: .06 + shallow * .5, linger: .35 + random() * .5,
        sweep, trail: 2 + random() * 4, duration: sweep / speed,
        width: .06 + random() * .06, strength: .65 + random() * .95 };
}
/** Average two minutes, broad intervals; re-entry does not replay missed events. */
export function nextMeteorDelay(random: () => number): number { return 45 - Math.log(Math.max(.0001, 1 - random())) * 75; }
export function meteorOpacity(age: number, duration: number, linger = .8, peak = .5): number {
  if (age <= 0 || age >= duration + linger) return 0;
  // Brightness follows the whole flight, not a flat trail followed by a fade.
  const phase = age / (duration + linger);
  const rise = Math.min(1, phase / peak);
  const fall = Math.max(0, (phase - peak) / (1 - peak));
  return rise * rise * (3 - 2 * rise) * (1 - fall * fall * (3 - 2 * fall));
}
/** Every event rises to its chosen peak, then burns out over its remaining flight. */
export function meteorHeadGlow(age: number, duration: number, linger = 0, peak = .5): number {
  const phase = Math.max(0, Math.min(1, age / (duration + linger)));
  const t = phase <= peak ? phase / peak : (1 - phase) / (1 - peak);
  return 1.8 * t * t * (3 - 2 * t);
}
/** Travel continues through the fading tail of the event; never clamp at one. */
export function meteorTravel(age: number, duration: number): number { return Math.max(0, age / duration); }
