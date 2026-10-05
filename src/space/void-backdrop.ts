/** Clip-space backing: opaque behind every eye's scene, never a world-sized wall. */
export const VOID_VERTEX = `
void main() { gl_Position = vec4(position.xy, 0.999999, 1.0); }
`;
export const VOID_FRAGMENT = `
uniform vec3 colour;
void main() {
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;
export const VOID_DRAW = {
  frustumCulled: false,
  renderOrder: -10000,
  depthTest: false,
  depthWrite: false,
} as const;

/**
 * WHETHER THE BACKING IS DRAWN (Baiwei: passthrough would not turn off in a full environment).
 *
 *  - Passthrough on: never; the room you stand in shows.
 *  - In AR (`alpha-blend`) with passthrough off: always, environment or not. That was the bug: a full environment
 *    suppressed the backing, so the switch flipped and the kitchen stayed.
 *  - In opaque VR with a full environment: no. The environment owns everything behind it; the backing draws over
 *    `scene.background`, so it would turn every environment's sky flat black (Sill's review of PR 77).
 */
export function voidBacking({ passthrough, blendMode, surrounded }: {
  passthrough: boolean;
  blendMode: string | null;
  surrounded: boolean;
}): boolean {
  if (passthrough) return false;
  if (blendMode !== "alpha-blend" && surrounded) return false;
  return true;
}

/**
 * A picture sky is already opaque, in AR too: three draws a texture background as a mesh before the scene, so it
 * hides the real world by itself, and the backing would paint over it. A colour background clears to transparent
 * in AR, so that one still needs the backing.
 */
export function backgroundIsPicture(background: unknown): boolean {
  return !!background && (background as { isTexture?: boolean }).isTexture === true;
}
