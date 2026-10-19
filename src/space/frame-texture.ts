import * as THREE from "three";

/**
 * A picture from the server (a shared screen's frame) as a texture the right
 * way up, for every screen in the room.
 *
 * DECODED THROUGH AN <img>, NOT createImageBitmap: WebGL's flip flag is not
 * specified to apply to an ImageBitmap, browsers disagree about it, and a Quest
 * drew photographs upside down. The object URL is revoked once decoded, so a
 * screen refreshing every second does not leak one a second. MyScreen and
 * ScreenWall each carried this, word for word.
 */
export async function frameTexture(blob: Blob): Promise<{ texture: THREE.Texture; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  let image: HTMLImageElement;
  try {
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("the frame could not be decoded"));
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;
  return { texture, width: image.naturalWidth, height: image.naturalHeight };
}
