import { GO_PITCH, goPoint } from "../../shared/go-layout";

/**
 * Where a held stone will land: THE NEAREST FREE INTERSECTION, pulled to like a
 * magnet.
 *
 * Baiwei, in a headset: "it's quite unclear which spot precisely I'm pointing
 * to. So I would add some magnetic thing to pull my pointer to the precise
 * point and then create a small column of light from that spot so that I'm
 * sure that I'm putting stone where I want to."
 *
 * Before this, only the glowing dots took a press, each 0.88 of a pitch across:
 * a ray between two dots pressed nothing, and a shaky ray flickered between a
 * dot and no dot. Now the whole board takes the press and this decides where it
 * means.
 *
 * THE REACH IS ¾ OF A PITCH, and both sides of that number matter:
 *   - wide enough that there is no dead space: the farthest any point of the
 *     grid can be from its nearest intersection is √½ ≈ 0.71 of a pitch, the
 *     middle of a square;
 *   - short of a whole pitch, so pointing AT a stone never lands on the free
 *     point beside it. An occupied point snaps to nothing, and nothing lights.
 */
export const GO_SNAP_REACH = 0.75 * GO_PITCH;

export type GoMove = { x: number; y: number };

/** `at` is in the table's own frame, as the board is laid out: x across, z toward the near edge. */
export function goSnap(at: { x: number; z: number }, moves: readonly GoMove[], size: number): GoMove | null {
  let best: GoMove | null = null;
  let bestDistance = GO_SNAP_REACH;
  for (const move of moves) {
    const distance = Math.hypot(goPoint(move.x, size) - at.x, goPoint(move.y, size) - at.z);
    // Strictly nearer wins, so a tie keeps the first found — the same answer
    // for the same ray every frame, rather than flickering between two.
    if (distance < bestDistance || (best === null && distance === bestDistance)) {
      best = move;
      bestDistance = distance;
    }
  }
  return best;
}
