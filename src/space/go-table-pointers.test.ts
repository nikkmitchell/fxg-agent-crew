import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CombinedPointer, createGrabPointer, createRayPointer, createTouchPointer, type Pointer } from "@pmndrs/pointer-events";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { GO_TABLE_POINTERS } from "./go-controls";
import { scanJsx } from "./jsx-scan";

/**
 * THE LASER STAYS ON NEAR THE GO TABLE.
 *
 * Baiwei, in a headset: "When I walk over the board or stand close to the bowls
 * with stones, my pointer doesn't work. I have to go away and then it starts
 * working."
 *
 * Reproduced here with the REAL pointer library the headset runs — the same
 * three pointers @pmndrs/xr gives each hand, combined the same way — against a
 * room built like RoomItems: the wrapper that claims every press, a table with
 * a desk that takes no rays, a bowl you can press, and a panel across the room
 * that Baiwei is pointing at.
 */

const noRaycast = () => {};

function room({ laserOnly }: { laserOnly: boolean }) {
  const scene = new Scene();
  // RoomItems' wrapper: its onPointerDown claims every press, which makes
  // everything inside it a target.
  const items = new Group();
  items.addEventListener("pointerdown", () => {});
  scene.add(items);

  const table = new Group();
  if (laserOnly) table.pointerEventsType = GO_TABLE_POINTERS;
  items.add(table);

  const desk = new Mesh(new BoxGeometry(1.2, 0.075, 1.2), new MeshBasicMaterial());
  desk.position.set(0, 0.705, 0);
  desk.raycast = noRaycast; // exactly as RoomItems has it — and not enough
  table.add(desk);

  const bowl = new Group();
  bowl.addEventListener("pointerdown", () => {}); // a bowl is pressable
  bowl.position.set(0.5, 0.78, 0.5);
  const bowlMesh = new Mesh(new BoxGeometry(0.16, 0.06, 0.16), new MeshBasicMaterial());
  bowl.add(bowlMesh);
  table.add(bowl);

  // What Baiwei is actually pointing at: a panel three metres away, ahead.
  const panel = new Mesh(new PlaneGeometry(1.5, 1.5), new MeshBasicMaterial());
  panel.name = "panel";
  panel.position.set(0, 1.2, -3);
  panel.addEventListener("pointerdown", () => {});
  scene.add(panel);

  scene.updateMatrixWorld(true);
  return scene;
}

/** One hand, as @pmndrs/xr builds it: ray (the default), grab sphere, touch sphere. */
function hand(scene: Scene, at: Vector3) {
  const space = new Object3D();
  space.position.copy(at); // facing -Z: at the panel
  scene.add(space);
  space.updateMatrixWorld(true);
  const camera = new PerspectiveCamera();
  const getCamera = () => camera;
  const ref = { current: space };
  const ray = createRayPointer(getCamera, ref, {});
  const grab = createGrabPointer(getCamera, ref, {});
  const touch = createTouchPointer(getCamera, ref, {});
  const combined = new CombinedPointer(false);
  combined.register(ray, true);
  combined.register(grab);
  combined.register(touch);
  combined.move(scene, { timeStamp: 0 });
  return { ray, grab, touch };
}

const live = (pointers: Record<string, Pointer>) =>
  Object.entries(pointers).filter(([, pointer]) => pointer.getEnabled()).map(([name]) => name);

describe("the laser, near the Go table", () => {
  const overTheDesk = new Vector3(0, 0.78, 0.2); // hand just above the desk
  const byTheBowl = new Vector3(0.5, 0.84, 0.5); // hand over a bowl of stones
  const acrossTheRoom = new Vector3(0, 1.2, 2.5); // nowhere near the table

  it("WITHOUT the rule, a hand near the table loses its laser — what Baiwei saw", () => {
    expect(live(hand(room({ laserOnly: false }), overTheDesk))).not.toContain("ray");
    expect(live(hand(room({ laserOnly: false }), byTheBowl))).not.toContain("ray");
  });

  it("and walking away brings it back — also what Baiwei saw", () => {
    expect(live(hand(room({ laserOnly: false }), acrossTheRoom))).toEqual(["ray"]);
  });

  it("WITH the rule, the laser stays on over the desk and by the bowls, and still reaches the panel", () => {
    for (const at of [overTheDesk, byTheBowl]) {
      const pointers = hand(room({ laserOnly: true }), at);
      expect(live(pointers)).toEqual(["ray"]);
      expect(pointers.ray.getIntersection()?.object.name).toBe("panel");
    }
  });

  it("the rule does not take the laser from the table: it can still press a bowl", () => {
    // Pointing straight down at the bowl from above it.
    const scene = room({ laserOnly: true });
    const space = new Object3D();
    space.position.set(0.5, 1.3, 0.5);
    space.lookAt(0.5, 0, 0.5); // Object3D.lookAt aims +Z; the ray fires along -Z
    space.rotateY(Math.PI);
    scene.add(space);
    space.updateMatrixWorld(true);
    const camera = new PerspectiveCamera();
    const ray = createRayPointer(() => camera, { current: space }, {});
    const combined = new CombinedPointer(false);
    combined.register(ray, true);
    combined.move(scene, { timeStamp: 0 });
    expect(ray.getIntersection()?.object.parent?.position.x).toBeCloseTo(0.5);
  });
});

describe("the rule is on the table in RoomItems", () => {
  it("the Go table's own group carries it, so every mesh on the table inherits it", () => {
    const source = readFileSync(fileURLToPath(new URL("./RoomItems.tsx", import.meta.url)), "utf8");
    const roots = scanJsx(source).filter((tag) => tag.name === "group" && /\bref=\{body\}/.test(tag.attrs));
    expect(roots).toHaveLength(1);
    expect(roots[0].attrs).toMatch(/pointerEventsType=\{GO_TABLE_POINTERS\}/);
  });

  it("denies exactly the two sphere pointers, never the laser", () => {
    expect([...GO_TABLE_POINTERS.deny].sort()).toEqual(["grab", "touch"]);
  });
});
