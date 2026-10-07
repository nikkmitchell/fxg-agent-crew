import * as THREE from "three";
import type { Ink } from "../../shared/card-paint";
import { UI_FONT } from "../../shared/ui-ink";

/**
 * Draw painting instructions onto a canvas.
 *
 * DELIBERATELY DULL. Everything that could be wrong about a card — what it
 * says, where the words go, whether they fit — was decided in `card-paint.ts`
 * and tested there without a canvas. What is left is a loop over shapes, and
 * the only thing it can get wrong is a typo that shows up the first time
 * anybody looks at it.
 *
 * That split is the point: this suite has no renderer, so anything reachable
 * only through here is untested, and the less that is, the better.
 */

/** Any 2D canvas: the page's, or an OffscreenCanvas where there is no page. */
export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Canvas2D = { readonly width: number; readonly height: number; getContext(kind: "2d"): Context2D | null } | HTMLCanvasElement | OffscreenCanvas;

/** A measurer backed by a real canvas, for the painter that has no canvas of its own. Bold is measured bold. */
export function measureWith(context: Context2D, weight: "normal" | "bold" = "normal"): (text: string, size: number) => number {
  return (text, size) => {
    context.font = `${weight === "bold" ? "600 " : ""}${size}px ${UI_FONT}`;
    return context.measureText(text).width;
  };
}

export function drawInk(canvas: Canvas2D, ink: readonly Ink[]): void {
  const context = (canvas as { getContext(kind: "2d"): Context2D | null }).getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const item of ink) {
    context.fillStyle = item.fill;
    if (item.kind === "text") {
      context.font = `${item.weight === "bold" ? "600 " : ""}${item.size}px ${UI_FONT}`;
      context.textBaseline = "alphabetic";
      // SET EVERY TIME, not only when aligned right: canvas state is sticky, so
      // one right-aligned label would silently re-anchor every label after it.
      context.textAlign = item.align ?? "left";
      context.fillText(item.text, item.x, item.y);
    } else if (item.kind === "rect" && item.radius) {
      roundedRect(context, item.x, item.y, item.width, item.height, item.radius);
      context.fill();
      if (item.stroke) {
        context.strokeStyle = item.stroke;
        context.lineWidth = item.lineWidth ?? 2;
        context.stroke();
      }
    } else {
      context.fillRect(item.x, item.y, item.width, item.height);
      if (item.kind === "rect" && item.stroke) {
        context.strokeStyle = item.stroke;
        context.lineWidth = item.lineWidth ?? 2;
        context.strokeRect(item.x, item.y, item.width, item.height);
      }
    }
  }
}

function roundedRect(
  context: Context2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * A canvas and its texture, sized once.
 *
 * `needsUpdate` is the caller's job after redrawing — setting it here on every
 * draw would upload a texture even when nothing changed, and a board of thirty
 * cards repainting every frame is how a headset drops to half rate.
 */
export function makeInkCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Cards are read at an angle in a room; without this the text shimmers.
  texture.anisotropy = 4;
  return { canvas, texture };
}
