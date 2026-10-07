/**
 * The painter for drawing instructions (shared/card-paint.ts) lives with the engine now, because things paint
 * with it too (ctx.ui, src/engine/ui.ts): one painter for the room's panels and things' controls.
 */
export { drawInk, makeInkCanvas, measureWith, type Context2D } from "../engine/ink-canvas";
