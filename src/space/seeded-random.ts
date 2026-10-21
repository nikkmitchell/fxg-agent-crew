/**
 * Deterministic pseudo-random numbers from a seed, so a burst of light is the
 * same on every replay and a test can assert where its particles go. The
 * arrival sparkle and the speaking motes each carried this function word for
 * word until 2026-10-21.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}
