import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_INK } from "../../shared/ui-ink";
import { InputHub } from "./input";
import { PRESSED_MS, thingUi } from "./ui";
import type { Off } from "./types";

/**
 * ctx.ui (ui.ts): the parts' life in the engine — hover from a headset's ray,
 * the pressed flash, a disabled button, and nothing left behind when the thing
 * goes. What each part shows is shared/thing-ui.test.ts's business.
 */

/** A 2D context that remembers what was filled with what, and measures half an em a character. */
class FakeContext {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  textAlign = "left";
  textBaseline = "alphabetic";
  private size = 10;
  readonly fills: string[] = [];
  readonly words: string[] = [];
  set font(value: string) {
    this.size = Number(/(\d+(?:\.\d+)?)px/.exec(value)?.[1] ?? 10);
  }
  get font() {
    return `${this.size}px sans-serif`;
  }
  clearRect() {
    this.fills.length = 0;
    this.words.length = 0;
  }
  beginPath() {}
  moveTo() {}
  arcTo() {}
  closePath() {}
  stroke() {}
  strokeRect() {}
  fill() {
    this.fills.push(this.fillStyle);
  }
  fillRect() {
    this.fills.push(this.fillStyle);
  }
  fillText(text: string) {
    this.words.push(text);
  }
  measureText(text: string) {
    return { width: text.length * this.size * 0.5 };
  }
}

class FakeCanvas {
  readonly context = new FakeContext();
  constructor(readonly width: number, readonly height: number) {}
  getContext() {
    return this.context;
  }
}

function setUp() {
  const hub = new InputHub({ camera: () => new THREE.PerspectiveCamera(), element: () => null, me: () => null });
  const root = new THREE.Group();
  const input = hub.forInstance(root, { model: false });
  const offs: Off[] = [];
  let gone = false;
  const canvases: FakeCanvas[] = [];
  const ui = thingUi({
    input,
    canvas: (width, height) => {
      const canvas = new FakeCanvas(width, height);
      canvases.push(canvas);
      return canvas as unknown as OffscreenCanvas;
    },
    own: (off) => {
      offs.push(off);
      return off;
    },
    invalidate: () => undefined,
    gone: () => gone,
  });
  /** What the thing's going does: its registrations undone (instance.ts teardown). */
  const takeAway = () => {
    gone = true;
    for (const off of offs.splice(0)) off();
    input.dispose();
  };
  return { ui, root, canvases, takeAway };
}

/** A headset's pointer, as pmndrs delivers it to the object. */
const pointer = (object: THREE.Object3D, type: string, pointerId = 1) =>
  object.dispatchEvent({ type, pointerId, pointerType: "ray", point: new THREE.Vector3() } as never);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ctx.ui in the engine (Mica 7331)", () => {
  it("lights a button under a headset's ray and puts it out when the last ray leaves", () => {
    const { ui, root, canvases } = setUp();
    const read = ui.button("Read source", { width: 0.5 });
    root.add(read.object);
    const drawn = canvases[0].context;
    expect(drawn.words).toEqual(["Read source"]);
    expect(drawn.fills).toContain(UI_INK.control);
    pointer(read.object, "pointerenter", 1);
    expect(drawn.fills).toContain(UI_INK.controlHover);
    pointer(read.object, "pointerenter", 2);
    pointer(read.object, "pointerleave", 1);
    expect(drawn.fills).toContain(UI_INK.controlHover);
    pointer(read.object, "pointerleave", 2);
    expect(drawn.fills).toContain(UI_INK.control);
    expect(drawn.fills).not.toContain(UI_INK.controlHover);
  });

  it("flashes the accent when pressed, calls onPress once, then goes back", () => {
    const { ui, canvases } = setUp();
    const pressed = vi.fn();
    const place = ui.button("Place", { onPress: pressed });
    const drawn = canvases[0].context;
    pointer(place.object, "pointerdown");
    pointer(place.object, "pointerup");
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(drawn.fills).toContain(UI_INK.accent);
    vi.advanceTimersByTime(PRESSED_MS + 20);
    expect(drawn.fills).not.toContain(UI_INK.accent);
  });

  it("does nothing when disabled, and says so in its colour; set() changes it in place", () => {
    const { ui, canvases } = setUp();
    const pressed = vi.fn();
    const later = ui.button("Later", { disabled: true, onPress: pressed });
    pointer(later.object, "pointerdown");
    pointer(later.object, "pointerup");
    expect(pressed).not.toHaveBeenCalled();
    later.set({ disabled: false, label: "Later →", tone: "accent" });
    const drawn = canvases[0].context;
    expect(drawn.words).toEqual(["Later →"]);
    expect(drawn.fills).toContain(UI_INK.accent);
    pointer(later.object, "pointerdown");
    pointer(later.object, "pointerup");
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("sets a card, says whether it fitted, and pages long reading to fit the same card", () => {
    const { ui } = setUp();
    const detail = ui.card({ title: "Three.js BoxGeometry", text: "A small editable-geometry reference.", width: 1.15, height: 0.88 });
    expect(detail.fits).toBe(true);
    const book = "A sentence worth reading in a book. ".repeat(400);
    detail.set({ text: book });
    expect(detail.fits).toBe(false);
    const pages = ui.pages(book, { width: 1.15, height: 0.88 });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      detail.set({ text: page });
      expect(detail.fits).toBe(true);
    }
  });

  it("leaves nothing behind when the thing goes: meshes out, textures freed, no more hover or press", () => {
    const { ui, root, takeAway } = setUp();
    const pressed = vi.fn();
    const button = ui.button("Close", { onPress: pressed });
    const card = ui.card({ text: "Reading", width: 0.6, height: 0.4 });
    root.add(button.object, card.object);
    const freed = vi.spyOn((button.object.material as THREE.MeshBasicMaterial).map as THREE.Texture, "dispose");
    takeAway();
    expect(root.children).toHaveLength(0);
    expect(freed).toHaveBeenCalled();
    pointer(button.object, "pointerdown");
    pointer(button.object, "pointerup");
    expect(pressed).not.toHaveBeenCalled();
    expect(() => ui.button("Again")).toThrow(/taken away/);
    // Disposing again by hand is harmless.
    expect(() => button.dispose()).not.toThrow();
  });
});
