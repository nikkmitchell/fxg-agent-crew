/** Seconds-based local reveal, shared without loading the astronomy module. */
export function easeSky(current: number, target: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, Math.min(delta, 0.1)) / 0.75));
}
