import { describe, expect, it } from "vitest";
import { arcPlacement, DEFAULT_OPEN_PANELS, deskFor } from "./space-layout";
import { ROOM_GUIDE } from "./room-guide";

/**
 * NO WORK PANEL OR AGENT STANDS INSIDE A PIECE. baiwei2 (5816): "big flat
 * rectangles floating within" the Nebula and the Rain Curtain. The room's
 * default work panels (4 m wide, on an arc) and the agents' standing spots
 * (deskFor) are in every room; the chat panel cut through the rain and an
 * agent's spot sat inside the nebula. Isolated previews showed nothing,
 * because they have neither.
 *
 * Checked for these pieces now; others that already overlap are listed in
 * KNOWN so the test says so plainly rather than hiding them.
 */
const CHECKED = ["Nebula", "Rain curtain"];
const KNOWN_PANEL = ["Shore", "Tide pool", "Conch"];

const panels = DEFAULT_OPEN_PANELS.map((_, i) => {
  const s = arcPlacement(i, DEFAULT_OPEN_PANELS.length).surface;
  const dx = (Math.cos(s.rotationY) * s.width) / 2;
  const dz = (-Math.sin(s.rotationY) * s.width) / 2;
  return [s.position.x - dx, s.position.z - dz, s.position.x + dx, s.position.z + dz] as const;
});
function toPanel(x: number, z: number): number {
  return Math.min(...panels.map(([ax, az, bx, bz]) => {
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(x - (ax + t * vx), z - (az + t * vz));
  }));
}
const spots: { x: number; z: number }[] = [];
for (const x of [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5]) for (const z of [7.0, 8.2]) spots.push({ x, z });

describe("pieces stand clear of the work panels and the agents' spots", () => {
  it("keeps the checked pieces a metre from any default panel and any desk spot", () => {
    for (const name of CHECKED) {
      const piece = ROOM_GUIDE.find((entry) => entry.name === name)!;
      expect(toPanel(piece.x, piece.z), `${name} to a panel`).toBeGreaterThan(1.0);
      expect(Math.min(...spots.map((s) => Math.hypot(piece.x - s.x, piece.z - s.z))), `${name} to a desk spot`).toBeGreaterThan(1.0);
    }
  });
  it("uses the real desk grid", () => {
    // If deskFor's grid changes, this test's copy must change with it.
    const desk = deskFor("Nightjar");
    expect(spots.some((s) => s.x === desk.x && s.z === desk.z)).toBe(true);
  });
  it("still lists the corner that overlaps a panel, until it is moved", () => {
    const overlapping = ROOM_GUIDE.filter((entry) => toPanel(entry.x, entry.z) < 1.0).map((entry) => entry.name);
    expect(overlapping.sort()).toEqual([...KNOWN_PANEL].sort());
  });
});
