import * as THREE from "three";

/**
 * Break a label into at most `maxLines` lines that each `fit`.
 *
 * A LINE BREAK THE CALLER WROTE IS KEPT: a status like "● Recording" over
 * "◼ sends ✕ cancels" is two lines on purpose, not one sentence to reflow.
 *
 * WHAT DID NOT FIT IS MARKED rather than dropped silently: a sentence that stops
 * mid-thought with no sign is worse than one that says it was cut. A single word
 * too wide for a line is kept whole on its own line; the canvas squeezes it.
 */
export function wrapLabel(text: string, maxLines: number, fits: (line: string) => boolean): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let row = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = row ? `${row} ${word}` : word;
      if (fits(candidate) || !row) row = candidate;
      else {
        lines.push(row);
        row = word;
      }
    }
    if (row) lines.push(row);
  }
  const limit = Math.max(1, maxLines);
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  kept[limit - 1] += "…";
  return kept;
}

/**
 * Text, drawn once into a texture.
 *
 * Labels have to be readable from across the room, and the cheapest honest way
 * to do that without pulling in a font loader and a typeface file is a canvas.
 * Shared by the avatars and the station frames so there is one way text gets
 * into the scene rather than two that drift.
 *
 * Callers must cache the result. Making one of these every frame is how a
 * scene ends up allocating a megabyte a second.
 */
export function makeLabelTexture(
  text: string,
  options: {
    pixelsPerLine?: number;
    lines?: number;
    aspect?: number;
    color?: string;
    /**
     * The light outline that makes dark text readable floating in the room.
     * Off for text on a solid button: there it drew a pale smear around every
     * letter, and two wrapped lines of it ran into each other — the "garbled"
     * and "overlaps itself" Nikk read under the record button.
     */
    halo?: boolean;
    /** Distance between wrapped lines, as a multiple of the text size. */
    lineSpacing?: number;
  } = {},
): THREE.CanvasTexture | null {
  // The scene is only ever mounted in a browser, but a test that imports this
  // file should not explode on a missing document.
  if (typeof document === "undefined") return null;
  /**
   * THE CANVAS TAKES THE SHAPE OF THE PLANE IT WILL BE MAPPED ONTO.
   *
   * It was always 512x128 — 4:1 — and `label-aspect.test.ts` already spelled
   * out the consequence: "Mapping that onto a plane of a different aspect does
   * not crop or letterbox it, it STRETCHES it, and the failure looks like
   * blurring rather than like a mistake." That test then checked exactly one
   * file. The settings gear is a 0.14 x 0.14 SQUARE, so it was taking a 4:1
   * texture into a 1:1 plane and squeezing the glyph to a quarter of its width.
   * Nikk, from a headset: "settings icon is weirdly shaped, like its stretched".
   *
   * Callers that know their plane pass its aspect. The default stays 4:1 so
   * every existing caller draws exactly what it drew before.
   */
  const aspect = options.aspect && options.aspect > 0 ? options.aspect : 512 / 128;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  // Rounded to a whole pixel, and never zero: a canvas of height 0 throws.
  canvas.height = Math.max(1, Math.round(512 / aspect));
  /**
   * TALL ENOUGH FOR THE TEXT, for a very wide plane.
   *
   * A 512-wide canvas at 14:1 — a screen's "Inkstone's screen · shared by
   * nikk" label — is 37 pixels tall, and the text was being drawn at 56 into
   * it: squashed, and plainly so in the room. When the text would not fit, the
   * canvas grows WIDER at the same aspect instead of the text being crushed.
   * Every plane that already fitted — the default 4:1, the square gear, the
   * talk button — gets exactly the canvas it had before.
   */
  const spacing = options.lineSpacing ?? 0.62;
  const needed = Math.ceil((options.pixelsPerLine ?? 64) * Math.max(1, options.lines ?? 1) * Math.max(1.3, spacing + 0.4));
  if (canvas.height < needed) {
    canvas.height = needed;
    canvas.width = Math.min(2048, Math.round(needed * aspect));
  }
  const context = canvas.getContext("2d");
  if (!context) return null;

  // TRANSPARENT, with a halo. The first version filled the whole canvas with
  // the avatar's paper colour, which put a solid slab above every head and hid
  // most of the room behind floating signs. It also let the label carry the
  // identity colour, and colour is supposed to carry nothing.
  //
  // A light stroke under dark text is legible against a pale wall, a dark
  // figure, or the sky through a doorway, without a background of its own.
  const size = options.pixelsPerLine ?? 64;
  context.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 10;
  context.strokeStyle = "#f7f5f0";
  // Dark by default; a caller may colour a sign whose colour means something.
  context.fillStyle = options.color ?? "#141517";

  /**
   * WRAPPED, when asked for.
   *
   * A single line is squeezed to fit by the max-width argument, which is right
   * for a name — a long actor id gets narrow rather than losing its ending,
   * where the distinguishing part lives. It is wrong for a sentence: 240
   * characters condensed into one 512px line is a grey smear, which is exactly
   * how the headset captions failed.
   */
  const maxLines = Math.max(1, options.lines ?? 1);
  const inner = canvas.width - 32;
  const rows: string[] = [];
  if (maxLines === 1) rows.push(text.replace(/\s*\n\s*/g, " "));
  else rows.push(...wrapLabel(text, maxLines, (line) => context.measureText(line).width <= inner));

  const top = canvas.height / 2 - ((rows.length - 1) * size * spacing) / 2 + 4;
  rows.forEach((line, index) => {
    const y = top + index * size * spacing;
    if (options.halo !== false) context.strokeText(line, canvas.width / 2, y, inner);
    context.fillText(line, canvas.width / 2, y, inner);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
