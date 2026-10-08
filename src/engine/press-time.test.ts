import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { InputHub } from "./input";

/** ctx.rooms.go opens only from a press on the thing (Mica, open-source-library-b2425a2a): presses are timed. */
const pointer = (object: THREE.Object3D, type: string) =>
  object.dispatchEvent({ type, pointerId: 1, pointerType: "ray", point: new THREE.Vector3() } as never);

describe("a thing's last press", () => {
  it("is never until something of it is pressed, then the moment it was", () => {
    const hub = new InputHub({ camera: () => new THREE.PerspectiveCamera(), element: () => null, me: () => null });
    const root = new THREE.Group();
    const input = hub.forInstance(root, { model: false });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    root.add(door);
    const pressed = vi.fn(() => expect(input.lastPressAt).toBeGreaterThan(0));
    input.press(door, pressed);
    expect(input.lastPressAt).toBe(-Infinity);
    pointer(door, "pointerdown");
    pointer(door, "pointerup");
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(performance.now() - input.lastPressAt).toBeLessThan(1000);
  });
});
