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
