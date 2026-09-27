/**
 * A WALKING LABYRINTH on the floor: the classical seven-circuit pattern,
 * thousands of years old and nobody's property. One path, no choices: you
 * cannot get lost, which is the point. Walk it slowly (the WALKING guide fits
 * it) in the space behind where people arrive.
 *
 * THE CLASSICAL ORDER. The path enters on the third circuit (1 is outermost),
 * then goes 2, 1, 4, 7, 6, 5 and into the centre, walking each circuit almost
 * all the way round and turning back at the entrance axis before the next.
 * That order is what makes it the classical labyrinth rather than a spiral.
 */
export const CIRCUIT_ORDER = [3, 2, 1, 4, 7, 6, 5] as const;
export const LABYRINTH = {
  /** Centre, on the floor, behind where people arrive (spawn z 6.2). */
  x: 0,
  z: 8.6,
  /** Radius of the outermost circuit, and the gap between circuits, in metres. */
  outer: 1.45,
  step: 0.17,
} as const;

export type FloorPoint = { x: number; z: number };

export function circuitRadius(circuit: number): number {
  return LABYRINTH.outer - (circuit - 1) * LABYRINTH.step;
}

/**
 * The path as points on the floor, relative to the centre, from outside the
 * mouth to the middle. The mouth faces -z, toward where people arrive.
 * `perTurn` is how many points make one full circle.
 */
export function labyrinthPath(perTurn = 96): FloorPoint[] {
  const mouth = -Math.PI / 2;
  // How much of the circle each circuit leaves open at the axis, for the turns.
  const gap = 0.16;
  const at = (radius: number, angle: number): FloorPoint => ({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  const points: FloorPoint[] = [at(LABYRINTH.outer + LABYRINTH.step * 1.5, mouth)];
  let clockwise = true;
  let angle = mouth;
  CIRCUIT_ORDER.forEach((circuit, index) => {
    const radius = circuitRadius(circuit);
    const start = index === 0 ? mouth + gap : angle;
    const end = clockwise ? mouth + 2 * Math.PI - gap : mouth + gap;
    // Step across to this circuit at the axis, then walk round it.
    points.push(at(radius, start));
    const steps = Math.max(2, Math.round((Math.abs(end - start) / (2 * Math.PI)) * perTurn));
    for (let n = 1; n <= steps; n += 1) points.push(at(radius, start + ((end - start) * n) / steps));
    angle = end;
    clockwise = !clockwise;
  });
  points.push({ x: 0, z: 0 });
  return points;
}
