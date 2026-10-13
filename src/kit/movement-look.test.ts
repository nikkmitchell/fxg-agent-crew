// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createMovement } from "./movement";

/** Enough of a renderer for drag-to-look on a computer. */
function setUp(look?: "any" | "right") {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const renderer = { domElement: canvas, xr: { isPresenting: false } } as unknown as THREE.WebGLRenderer;
  const player = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  player.add(camera);
  const movement = createMovement({ renderer, player, camera, look });
  const drag = (button: number) => {
    canvas.dispatchEvent(new MouseEvent("pointerdown", { button, clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  };
  const menu = () => canvas.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true, bubbles: true }));
  return { player, drag, menu, movement };
}

describe("which mouse button looks (Kerf, 2026-10-14)", () => {
  it("any button looks, by default", () => {
    const { player, drag, movement } = setUp();
    drag(0);
    expect(player.rotation.y).not.toBe(0);
    movement.dispose();
  });

  it('look: "right" leaves the left button to the space, and keeps the browser menu off the right', () => {
    const { player, drag, menu, movement } = setUp("right");
    drag(0);
    expect(player.rotation.y).toBe(0);
    drag(2);
    expect(player.rotation.y).not.toBe(0);
    expect(menu()).toBe(false); // the menu was prevented
    movement.dispose();
  });
});
