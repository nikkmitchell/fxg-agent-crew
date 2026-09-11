import * as THREE from "three";

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
  options: { pixelsPerLine?: number; lines?: number } = {},
): THREE.CanvasTexture | null {
  // The scene is only ever mounted in a browser, but a test that imports this
  // file should not explode on a missing document.
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
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
  context.fillStyle = "#141517";

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
  if (maxLines === 1) rows.push(text);
  else {
    let row = "";
    for (const word of text.split(/\s+/)) {
      const candidate = row ? `${row} ${word}` : word;
      if (context.measureText(candidate).width <= inner || !row) row = candidate;
      else {
        rows.push(row);
        row = word;
        if (rows.length === maxLines) break;
      }
    }
    if (rows.length < maxLines && row) rows.push(row);
    // What did not fit is marked rather than dropped silently: a sentence that
    // stops mid-thought with no sign is worse than one that says it was cut.
    const used = rows.join(" ");
    if (used.length < text.trim().length) rows[rows.length - 1] += "…";
  }

  const top = canvas.height / 2 - ((rows.length - 1) * size * 0.62) / 2 + 4;
  rows.forEach((line, index) => {
    const y = top + index * size * 0.62;
    context.strokeText(line, canvas.width / 2, y, inner);
    context.fillText(line, canvas.width / 2, y, inner);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
