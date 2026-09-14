/**
 * A burst of light where an agent reaches a board.
 *
 * Nikk: "maybe add some kind of particle animation when it happens" — "it"
 * being a task board change landing. A change an agent makes lands the moment
 * the agent arrives at the board (see shared/board-freshness.ts), so the burst
 * goes off at that same moment, in front of the agent, where its hands would be.
 *
 * The rules are here and tested; ArrivalSparkles draws them.
 */

export const SPARKLE_COUNT = 56;
export const SPARKLE_LIFE_S = 1.4;
const GRAVITY = -2.2;

type Mover = { actorId: string; kind: string | null; moving: boolean; because: string | null };

/**
 * Who just arrived at a board this frame: an agent that was walking, has
 * stopped, and is somewhere for a reason. A conversation is a reason too, but
 * walking up to a person is not a board change and gets no fireworks.
 */
export function arrivals(previous: Map<string, boolean>, people: readonly Mover[]): string[] {
  const arrived: string[] = [];
  for (const person of people) {
    const wasMoving = previous.get(person.actorId) ?? false;
    previous.set(person.actorId, person.moving);
    if (person.kind !== "agent" || person.moving || !wasMoving) continue;
    if (person.because === null || person.because.startsWith("talking with")) continue;
    arrived.push(person.actorId);
  }
  return arrived;
}

/** Deterministic pseudo-random numbers, so a burst is testable. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

/** Starting velocities for one burst: outward and upward, in a loose fountain. */
export function burstVelocities(seed: number, count = SPARKLE_COUNT): Float32Array {
  const next = random(seed);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = next() * Math.PI * 2;
    const outward = 0.4 + next() * 0.9;
    velocities[i * 3] = Math.cos(angle) * outward;
    velocities[i * 3 + 1] = 0.8 + next() * 1.6;
    velocities[i * 3 + 2] = Math.sin(angle) * outward;
  }
  return velocities;
}

/** Advance a burst by `dt` seconds: move, and let gravity pull the sparks down. */
export function stepSparkles(positions: Float32Array, velocities: Float32Array, dt: number): void {
  for (let i = 0; i < positions.length; i += 3) {
    velocities[i + 1] += GRAVITY * dt;
    positions[i] += velocities[i] * dt;
    positions[i + 1] += velocities[i + 1] * dt;
    positions[i + 2] += velocities[i + 2] * dt;
  }
}

/** How visible a burst is, `age` seconds in: bright at once, gone by the end. */
export function sparkleOpacity(age: number): number {
  if (age <= 0) return 1;
  return Math.max(0, 1 - (age / SPARKLE_LIFE_S) ** 1.5);
}
