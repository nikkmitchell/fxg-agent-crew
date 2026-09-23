import { describe, expect, it } from "vitest";
import {
  defaultPlacement,
  facingArc,
  facingPoint,
  normaliseRotation,
  placementRefusal,
  standFor,
} from "./panel-place";
import { ARC_FOCUS } from "./space-layout";
import { ROOM, STATIONS } from "./space-layout";

const at = (x: number, y: number, z: number, rotationY = 0) => ({
  id: "taskBoard",
  position: { x, y, z },
  rotationY,
});

describe("where a panel may be put", () => {
  it("accepts every panel's own default, or the room starts out refusing itself", () => {
    for (const id of Object.keys(STATIONS)) {
      const place = defaultPlacement(id);
      expect(place).not.toBeNull();
      expect(placementRefusal(place!)).toBeNull();
    }
  });

  it("refuses a panel nobody has heard of", () => {
    expect(placementRefusal({ ...at(0, 1.6, 0), id: "whiteboard" })).toMatch(/no panel called/);
  });

  it("refuses a position outside the room", () => {
    expect(placementRefusal(at(ROOM.width, 1.6, 0))).toMatch(/outside the room/);
    expect(placementRefusal(at(0, 1.6, ROOM.depth))).toMatch(/outside the room/);
  });

  it("refuses heights nobody can read", () => {
    expect(placementRefusal(at(0, 0.2, 0))).toMatch(/too low/);
    expect(placementRefusal(at(0, 9, 0))).toMatch(/above where anybody can read/);
  });

  it("refuses numbers that are not numbers", () => {
    expect(placementRefusal(at(Number.NaN, 1.6, 0))).toMatch(/not a number/);
    expect(placementRefusal(at(0, 1.6, Number.POSITIVE_INFINITY))).toMatch(/not a number/);
    expect(placementRefusal(at(0, 1.6, 0, Number.NaN))).toMatch(/not a number/);
  });
});

describe("keeping a rotation readable", () => {
  it("leaves an ordinary angle alone", () => {
    expect(normaliseRotation(1.2)).toBeCloseTo(1.2, 10);
    expect(normaliseRotation(-1.2)).toBeCloseTo(-1.2, 10);
  });

  it("wraps a spin into the same direction", () => {
    expect(normaliseRotation(1.2 + Math.PI * 2 * 5)).toBeCloseTo(1.2, 10);
    expect(normaliseRotation(-1.2 - Math.PI * 2 * 3)).toBeCloseTo(-1.2, 10);
  });

  it("stays within one turn either way", () => {
    for (const angle of [0, 7, -7, 100, -100, Math.PI, -Math.PI]) {
      const wrapped = normaliseRotation(angle);
      expect(wrapped).toBeGreaterThanOrEqual(-Math.PI);
      expect(wrapped).toBeLessThanOrEqual(Math.PI);
    }
  });
});

describe("where you stand for a panel that has moved", () => {
  it("puts you in front of it, facing it", () => {
    for (const id of Object.keys(STATIONS)) {
      const place = defaultPlacement(id)!;
      const stand = standFor(place);
      // The same place the untouched arc computes, or moving a panel would
      // teleport every agent the first time anybody dragged anything.
      expect(stand.x).toBeCloseTo(STATIONS[id].stand.x, 6);
      expect(stand.z).toBeCloseTo(STATIONS[id].stand.z, 6);
    }
  });

  it("follows the panel when it moves", () => {
    const moved = { id: "taskBoard", position: { x: 3, y: 1.6, z: -2 }, rotationY: 0 };
    const stand = standFor(moved);
    expect(stand.x).toBeCloseTo(3, 6);
    expect(stand.z).toBeCloseTo(-0.2, 6);
    expect(stand.y).toBe(0);
  });

  it("follows the panel when it turns", () => {
    const turned = { id: "taskBoard", position: { x: 0, y: 1.6, z: 0 }, rotationY: Math.PI / 2 };
    const stand = standFor(turned);
    expect(stand.x).toBeCloseTo(1.8, 6);
    expect(stand.z).toBeCloseTo(0, 6);
  });
});

describe("turning a dragged panel to face the room", () => {
  it("reproduces the arc's own angles, or dropping a panel where it already is would spin it", () => {
    for (const id of Object.keys(STATIONS)) {
      const { position, rotationY } = STATIONS[id].surface;
      expect(facingArc(position.x, position.z)).toBeCloseTo(rotationY, 6);
    }
  });

  it("points the panel's face AT the focus, not away from it", () => {
    // The bug this test exists for: an extra half turn, which looks plausible
    // in the code and turns every dragged panel's back on the room.
    for (const [x, z] of [
      [-4.5, -5.3],
      [4.5, -5.3],
      [0, -8],
      [7, 4],
      [-7, 4],
    ] as const) {
      const ry = facingArc(x, z);
      const normal = { x: Math.sin(ry), z: Math.cos(ry) };
      const toFocus = { x: ARC_FOCUS.x - x, z: ARC_FOCUS.z - z };
      const length = Math.hypot(toFocus.x, toFocus.z);
      expect((normal.x * toFocus.x + normal.z * toFocus.z) / length).toBeCloseTo(1, 6);
    }
  });

  it("puts the standing place between a dragged panel and the focus", () => {
    const x = -4.5;
    const z = -5.3;
    const place = { id: "taskBoard", position: { x, y: 1.65, z }, rotationY: facingArc(x, z) };
    const stand = standFor(place);
    const panelToFocus = Math.hypot(ARC_FOCUS.x - x, ARC_FOCUS.z - z);
    const standToFocus = Math.hypot(ARC_FOCUS.x - stand.x, ARC_FOCUS.z - stand.z);
    expect(standToFocus).toBeLessThan(panelToFocus);
  });
});

/**
 * A panel somebody picks up turns to face THEM, not the middle of the arc.
 * Nikk: "they're always facing towards some center point in the scene, but we
 * don't actually have a center point in the scene".
 */
describe("a panel faces whoever moves it", () => {
  /** A plane with no rotation faces +z, so its normal is (sin ry, cos ry). */
  const normal = (ry: number) => ({ x: Math.sin(ry), z: Math.cos(ry) });

  it("turns its face toward the person dragging it", () => {
    for (const [x, z, toward] of [
      [3, 1, { x: -2, z: 4 }],
      [-4, -3, { x: 0, z: 0 }],
      [0, 5, { x: 6, z: 5 }],
    ] as const) {
      const ry = facingPoint(x, z, toward)!;
      const to = { x: toward.x - x, z: toward.z - z };
      const length = Math.hypot(to.x, to.z);
      // The face points straight at the person: the normal IS the direction to them.
      expect(normal(ry).x).toBeCloseTo(to.x / length, 6);
      expect(normal(ry).z).toBeCloseTo(to.z / length, 6);
    }
  });

  /**
   * THE BUG ITSELF. Dragged to the side, a panel used to swing toward
   * ARC_FOCUS whoever was holding it. Standing somewhere other than that
   * point, the person now gets the face, and the old answer is measurably wrong.
   */
  it("no longer faces the arc's centre when the person is somewhere else", () => {
    const [x, z] = [4, 2];
    const person = { x: ARC_FOCUS.x + 5, z: ARC_FOCUS.z - 3 };
    const toPerson = facingPoint(x, z, person)!;
    expect(Math.abs(toPerson - facingArc(x, z))).toBeGreaterThan(0.3);
  });

  it("keeps its rotation rather than snapping when the person is right on top of it", () => {
    expect(facingPoint(2, 3, { x: 2.01, z: 3.01 })).toBeNull();
  });

  it("agrees with facingArc when the person happens to stand at the arc's centre", () => {
    expect(facingPoint(3, -1, ARC_FOCUS)).toBeCloseTo(facingArc(3, -1), 9);
  });
});
