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
  options: { pixelsPerLine?: number } = {},
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
  context.font = `600 ${options.pixelsPerLine ?? 64}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 10;
  context.strokeStyle = "#f7f5f0";
  // The max-width argument squeezes rather than clips, so a long actor id gets
  // narrow instead of losing its ending — which is where the distinguishing
  // part of a name like "Nikk2Macbook-Codex-001" lives.
  context.strokeText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 32);
  context.fillStyle = "#141517";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
