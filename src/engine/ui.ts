import * as THREE from "three";
import { buttonInk, cardInk, cardPages, uiPixels, type UiState } from "../../shared/thing-ui";
import { UI_FONT, UI_INK } from "../../shared/ui-ink";
import { drawInk, measureWith, type Context2D } from "./ink-canvas";
import type { InstanceInput } from "./input";
import type { Ctx, Off, UiButton, UiButtonOptions, UiCard, UiCardOptions } from "./types";

/**
 * CTX.UI: A THING'S CONTROLS AND TEXT IN THE PLATFORM'S LOOK (Mica 7331,
 * Baiwei 7333). What each part shows is decided in shared/thing-ui.ts and
 * tested there; this makes the meshes, owns their textures, and gives them the
 * room's hover and pressed feedback, which a thing cannot draw for itself
 * because it is never told where a pointer is.
 *
 * Each part is the thing's to place: its `object` goes wherever the thing adds
 * it, at the size it asked for in metres. Nothing here is shared with other
 * viewers, and everything goes when the thing does.
 */

type Canvas = HTMLCanvasElement | OffscreenCanvas;

export type UiDeps = {
  input: Pick<InstanceInput, "press" | "hover">;
  canvas: (width: number, height: number) => Canvas;
  own: <T extends Off>(off: T) => T;
  invalidate: () => void;
  gone: () => boolean;
};

/** How long a press shows, as in the settings menu (SettingsMenu3D). */
export const PRESSED_MS = 160;

/** A button's size when a thing does not say, in metres (Mica 7335: so rows can be spaced by it). */
export const UI_SIZES = Object.freeze({ button: Object.freeze({ width: 0.25, height: 0.09 }) });

const MIN_SIDE = 0.02;
const MAX_SIDE = 4;
const metres = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_SIDE, Math.max(MIN_SIDE, value)) : fallback;

export function thingUi(deps: UiDeps): Ctx["ui"] {
  let measuring: Context2D | null = null;
  const context = () => (measuring ??= deps.canvas(8, 8).getContext("2d") as Context2D | null);

  /** A plane of these metres, its canvas and texture: drawn front only, the corners see-through as the menu's are. */
  function surface(width: number, height: number, name: string) {
    const px = uiPixels(width, height);
    const canvas = deps.canvas(px.width, px.height);
    const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.02, toneMapped: false });
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    const paint = (ink: Parameters<typeof drawInk>[1]) => {
      drawInk(canvas, ink);
      texture.needsUpdate = true;
      deps.invalidate();
    };
    const free = () => {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    };
    return { px, canvas, mesh, paint, free };
  }

  const measures = (canvas: Canvas) => {
    const drawing = canvas.getContext("2d") as Context2D | null;
    return { normal: drawing ? measureWith(drawing) : fallbackMeasure, bold: drawing ? measureWith(drawing, "bold") : fallbackMeasure };
  };

  function button(label: string, options: UiButtonOptions = {}): UiButton {
    const width = metres(options.width, UI_SIZES.button.width);
    const height = metres(options.height, UI_SIZES.button.height);
    const made = surface(width, height, `ui-button ${label}`.slice(0, 60));
    const measure = measures(made.canvas).bold;
    let current = { label: String(label), tone: options.tone ?? "normal", disabled: Boolean(options.disabled), onPress: options.onPress };
    let hovered = false;
    let pressedUntil = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let freed = false;
    const state = (): UiState => (current.disabled ? "disabled" : performance.now() < pressedUntil ? "pressed" : hovered ? "hover" : "rest");
    const draw = () => {
      if (freed) return;
      made.paint(buttonInk({ label: current.label, tone: current.tone, state: state(), width: made.px.width, height: made.px.height }, measure));
    };
    const offPress = deps.input.press(made.mesh, (event) => {
      if (current.disabled || freed) return;
      pressedUntil = performance.now() + PRESSED_MS;
      draw();
      if (timer) clearTimeout(timer);
      timer = setTimeout(draw, PRESSED_MS + 10);
      current.onPress?.(event);
    }, { poke: true });
    const offHover = deps.input.hover(made.mesh, (on) => {
      hovered = on;
      draw();
    });
    const dispose = () => {
      if (freed) return;
      freed = true;
      if (timer) clearTimeout(timer);
      offPress();
      offHover();
      made.free();
    };
    deps.own(dispose);
    draw();
    return {
      object: made.mesh,
      set(next) {
        current = {
          label: next.label !== undefined ? String(next.label) : current.label,
          tone: next.tone ?? current.tone,
          disabled: next.disabled !== undefined ? Boolean(next.disabled) : current.disabled,
          onPress: next.onPress !== undefined ? next.onPress : current.onPress,
        };
        draw();
      },
      dispose,
    };
  }

  function card(options: UiCardOptions): UiCard {
    const width = metres(options.width, 0.6);
    const height = metres(options.height, 0.4);
    const made = surface(width, height, `ui-card ${options.title ?? ""}`.slice(0, 60));
    const { normal, bold } = measures(made.canvas);
    let current = { title: options.title, text: String(options.text ?? "") };
    let fits = true;
    let freed = false;
    const draw = () => {
      if (freed) return;
      const laid = cardInk({ title: current.title, text: current.text, width: made.px.width, height: made.px.height, scale: made.px.scale }, normal, bold);
      fits = laid.fits;
      made.paint(laid.ink);
    };
    const dispose = () => {
      if (freed) return;
      freed = true;
      made.free();
    };
    deps.own(dispose);
    draw();
    return {
      object: made.mesh,
      get fits() {
        return fits;
      },
      set(next) {
        current = { title: next.title !== undefined ? next.title : current.title, text: next.text !== undefined ? String(next.text) : current.text };
        draw();
      },
      dispose,
    };
  }

  return {
    ink: UI_INK,
    font: UI_FONT,
    sizes: UI_SIZES,
    button: (label, options) => {
      if (deps.gone()) throw new Error("This thing has been taken away; it can make no more controls.");
      return button(label, options);
    },
    card: (options) => {
      if (deps.gone()) throw new Error("This thing has been taken away; it can make no more cards.");
      return card(options);
    },
    pages: (text, options) => {
      const width = metres(options?.width, 0.6);
      const height = metres(options?.height, 0.4);
      const px = uiPixels(width, height);
      const drawing = context();
      return cardPages(drawing ? measureWith(drawing) : fallbackMeasure, String(text ?? ""), { width: px.width, height: px.height, title: options?.title !== false, scale: px.scale });
    },
  };
}

/** Where no canvas can measure (a test without one): about half an em a character. */
const fallbackMeasure = (text: string, size: number) => text.length * size * 0.5;
