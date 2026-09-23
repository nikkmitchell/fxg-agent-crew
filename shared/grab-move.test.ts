import { describe, expect, it } from "vitest";
import {
  GRAZING,
  REACH,
  beginGrab,
  beginPlaneGrab,
  draggedOnPlane,
  grabbedTo,
  onLevelPlane,
  pushPull,
  unit,
  type Ray,
  type Vec3,
} from "./grab-move.js";

const EYE = { x: 0, y: 1.62, z: 0 };

/** A ray from the eye, pitched up by `pitch` and turned right by `yaw`, in degrees. */
const looking = (pitch: number, yaw: number = 0): Ray => {
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  return {
    origin: EYE,
    direction: {
      x: Math.sin(y) * Math.cos(p),
      y: Math.sin(p),
      z: -Math.cos(y) * Math.cos(p),
    },
  };
};

const apart = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const from = (origin: Vec3, at: Vec3) => apart(origin, at);

/** How far along the ray a point sits. */
const along = (ray: Ray, at: Vec3) => {
  const d = unit(ray.direction);
  return (at.x - ray.origin.x) * d.x + (at.y - ray.origin.y) * d.y + (at.z - ray.origin.z) * d.z;
};

describe("taking hold of something", () => {
  it("does not move it at all until the ray does", () => {
    const ray = looking(0);
    const panel = { x: 0.7, y: 1.65, z: -4 };
    const held = grabbedTo(ray, beginGrab(ray, panel));
    // An identity, not an approximation: grabbing is the inverse of carrying.
    expect(apart(held, panel)).toBeLessThan(1e-9);
  });

  it("keeps hold of the corner you grabbed, not the middle", () => {
    const ray = looking(0);
    const corner = { x: 1.9, y: 2.4, z: -4 };
    const grab = beginGrab(ray, corner);
    expect(grab.offset.x).not.toBeCloseTo(0);
    expect(grabbedTo(looking(0), grab)).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    expect(apart(grabbedTo(ray, grab), corner)).toBeLessThan(1e-9);
  });

  it("stays exactly as far away as it was, however you point", () => {
    const ray = looking(0);
    // Grabbed at a corner, which is the case a world-space offset got wrong.
    const panel = { x: 1.6, y: 2.5, z: -4 };
    const grab = beginGrab(ray, panel);
    const started = from(EYE, panel);
    for (const [pitch, yaw] of [[0, 0], [10, 0], [-14, 0], [0, 35], [22, -40], [-30, 60], [89, 170]] as const) {
      const pointing = looking(pitch, yaw);
      expect(from(EYE, grabbedTo(pointing, grab))).toBeCloseTo(started, 9);
    }
  });

  it("does not come apart when you point straight up", () => {
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 1.6, y: 2.5, z: -4 });
    for (const pitch of [89.9, 90, -90]) {
      const held = grabbedTo(looking(pitch), grab);
      expect(Number.isFinite(held.x) && Number.isFinite(held.y) && Number.isFinite(held.z)).toBe(true);
    }
  });
});

describe("the bug this replaces", () => {
  /**
   * The old drag intersected a level plane at the panel's own height while the
   * eye was 3cm below it. These two blocks are the same gesture — one degree of
   * looking up — measured both ways.
   */
  const oldWay = (pitch: number) => {
    const plane = 1.65;
    const d = unit(looking(pitch).direction);
    const travel = (plane - EYE.y) / d.y;
    return travel > 0 ? { x: EYE.x + d.x * travel, y: plane, z: EYE.z + d.z * travel } : null;
  };

  it("used to drag a panel most of a metre for one degree of pointing", () => {
    const a = oldWay(1)!;
    const b = oldWay(2)!;
    expect(a).not.toBeNull();
    expect(apart(a, b)).toBeGreaterThan(0.7);
  });

  it("used to lose the panel completely when you looked a hair downward", () => {
    // Below level the plane is behind you, so the drag simply stopped.
    expect(oldWay(-0.5)).toBeNull();
  });

  it("now moves it by an amount that matches how far away it is", () => {
    const ray = looking(0);
    const panel = { x: 0, y: 1.65, z: -4 };
    const grab = beginGrab(ray, panel);
    const travelled = apart(grabbedTo(looking(1), grab), grabbedTo(looking(2), grab));
    // One degree at four metres is about seven centimetres, not ninety.
    expect(travelled).toBeGreaterThan(0.05);
    expect(travelled).toBeLessThan(0.1);
  });

  it("NEVER PULLS IT TOWARD YOU, which is the thing Nikk actually saw", () => {
    const ray = looking(0);
    // Grabbed well off-centre, which is the case that lets the distance move
    // at all — and it may still only move by the size of that offset.
    const panel = { x: 1.6, y: 2.5, z: -4 };
    const grab = beginGrab(ray, panel);
    const started = from(EYE, panel);
    for (let pitch = -40; pitch <= 40; pitch += 1) {
      for (let yaw = -60; yaw <= 60; yaw += 5) {
        const pointing = looking(pitch, yaw);
        const moved = grabbedTo(pointing, grab);
        expect(along(pointing, moved)).toBeCloseTo(grab.distance + grab.offset.forward, 9);
        // The old drag put a panel at your feet from four metres for two
        // degrees of pitch. This one cannot change its distance at all.
        expect(from(EYE, moved)).toBeCloseTo(started, 9);
      }
    }
  });

  it("goes up when you point up and down when you point down", () => {
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 0, y: 1.65, z: -4 });
    expect(grabbedTo(looking(20), grab).y).toBeGreaterThan(grabbedTo(looking(0), grab).y);
    expect(grabbedTo(looking(-20), grab).y).toBeLessThan(grabbedTo(looking(0), grab).y);
  });

  it("goes left and right when you point left and right", () => {
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 0, y: 1.65, z: -4 });
    expect(grabbedTo(looking(0, 20), grab).x).toBeGreaterThan(grabbedTo(looking(0, 0), grab).x);
    expect(grabbedTo(looking(0, -20), grab).x).toBeLessThan(grabbedTo(looking(0, 0), grab).x);
  });
});

describe("pushing it away and pulling it in", () => {
  it("changes how far away it is and nothing else", () => {
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 0, y: 1.65, z: -4 });
    const pushed = pushPull(grab, 1.5);
    expect(pushed.distance).toBeCloseTo(grab.distance + 1.5, 9);
    expect(pushed.offset).toEqual(grab.offset);
    // Straight ahead, so pushing is purely further away.
    expect(grabbedTo(ray, pushed).z).toBeLessThan(grabbedTo(ray, grab).z);
  });

  it("will not push it through the far wall or into your face", () => {
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 0, y: 1.65, z: -4 });
    expect(pushPull(grab, 500).distance).toBe(REACH.furthest);
    expect(pushPull(grab, -500).distance).toBe(REACH.nearest);
  });

  it("can always be brought back from wherever it was sent", () => {
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 0, y: 1.65, z: -4 });
    const far = pushPull(grab, 500);
    expect(pushPull(far, -500).distance).toBe(REACH.nearest);
    expect(pushPull(pushPull(far, -500), 500).distance).toBe(REACH.furthest);
  });

  it("holds something grabbed from impossibly far at arm's length instead", () => {
    // A ray that strikes nothing sensible must not produce a grab that cannot
    // be steered; it is clamped into reach like any other.
    const ray = looking(0);
    const grab = beginGrab(ray, { x: 0, y: 1.62, z: -400 });
    expect(grab.distance).toBe(REACH.furthest);
  });
});

describe("things that stand on the floor", () => {
  it("meets the floor where you would expect", () => {
    const hit = onLevelPlane(looking(-45), 0)!;
    expect(hit).not.toBeNull();
    expect(hit.y).toBe(0);
    // 45 degrees down from 1.62 up is 1.62 along the ground.
    expect(Math.hypot(hit.x, hit.z)).toBeCloseTo(1.62, 6);
  });

  it("CALLS A GRAZING RAY A MISS rather than answering with a wild number", () => {
    expect(onLevelPlane(looking(-1), 0)).toBeNull();
    expect(onLevelPlane(looking(0), 0)).toBeNull();
    expect(onLevelPlane(looking(1), 0)).toBeNull();
    // Just past the threshold it answers again.
    const steep = (Math.asin(GRAZING) * 180) / Math.PI + 0.5;
    expect(onLevelPlane(looking(-steep), 0)).not.toBeNull();
  });

  it("does not put things behind you when you look up", () => {
    expect(onLevelPlane(looking(30), 0)).toBeNull();
  });

  it("keeps a table held where it was grabbed, and keeps it on the floor", () => {
    const ray = looking(-30);
    const table = { x: 0.4, y: 0, z: -2.2 };
    const offset = beginPlaneGrab(ray, table, 0)!;
    expect(offset).not.toBeNull();
    const back = draggedOnPlane(ray, offset, 0)!;
    expect(apart(back, table)).toBeLessThan(1e-9);

    const moved = draggedOnPlane(looking(-30, 25), offset, 0)!;
    expect(moved.y).toBe(0);
    expect(moved.x).toBeGreaterThan(table.x);
  });

  it("refuses to start a grab it could not steer", () => {
    expect(beginPlaneGrab(looking(-1), { x: 0, y: 0, z: -2 }, 0)).toBeNull();
    expect(draggedOnPlane(looking(-1), { x: 0, y: 0, z: 0 }, 0)).toBeNull();
  });
});

describe("unit", () => {
  it("survives a ray with no direction at all", () => {
    const d = unit({ x: 0, y: 0, z: 0 });
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    expect(Number.isNaN(d.x)).toBe(false);
  });
});
