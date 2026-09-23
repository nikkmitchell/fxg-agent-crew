import { MeshBasicMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";

/**
 * The pointer that comes off a hand or controller: LIGHT WITH A DARK EDGE.
 *
 * Nikk, in a headset: "the pointer that comes off the hand is pure white so
 * when you're on a pure white background the menu pointer can't be seen at all
 * so we need to make the menu pointer to be white and black mixed in together
 * lightly".
 *
 * The library draws both parts pure white by default, and a pure white mark on
 * a pure white panel is invisible at any opacity. The usual answer is the one a
 * mouse cursor uses — a light fill inside a thin dark outline — which reads on
 * a white panel (the outline shows) and in the dark room (the fill shows).
 *
 * THE LIBRARY'S OWN SHAPES ARE KEPT: the cursor is still a soft round spot and
 * the ray still fades out along its length. Only the colour changes across
 * them. And the brightness setting (room-preferences, the pointer − / +) still
 * scales both; at 0% the pointer is still invisible and still works.
 *
 * INJECTED BY STRING REPLACEMENT, which is how the library's own materials do it
 * — and which fails silently if three.js renames the chunk being replaced: the
 * replace does nothing and the pointer goes back to white. The test checks
 * both anchors are still there.
 */

/** Where the colour is decided, in three's basic-material fragment shader. */
export const COLOR_ANCHOR = "#include <color_fragment>";
/** Where per-vertex values are set, in its vertex shader. */
export const VERTEX_ANCHOR = "#include <color_vertex>";

/** The dark edge. Near-black rather than black, so it reads as an outline, not a hole. */
const EDGE = "vec3(0.07, 0.07, 0.08)";

/**
 * The spot where the pointer lands: a light centre inside a thin dark ring.
 *
 * The ring is drawn a little MORE opaque than the centre: on a white panel it
 * is the only part that shows, and a ring as faint as the fill would vanish at
 * the dim settings people pick.
 */
export class TwoToneCursorMaterial extends MeshBasicMaterial {
  constructor() {
    super({ transparent: true, toneMapped: false, depthWrite: false });
  }
  onBeforeCompile(parameters: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
    super.onBeforeCompile(parameters, renderer);
    parameters.vertexShader = `varying vec2 vLocalPosition;\n${parameters.vertexShader.replace(
      VERTEX_ANCHOR,
      `${VERTEX_ANCHOR}\n  vLocalPosition = position.xy * 2.0;`,
    )}`;
    parameters.fragmentShader = `varying vec2 vLocalPosition;\n${parameters.fragmentShader.replace(
      COLOR_ANCHOR,
      `${COLOR_ANCHOR}
  float r = length(vLocalPosition);
  float ring = smoothstep(0.36, 0.44, r);          // 0 in the centre, 1 on the ring and beyond
  float outside = 1.0 - smoothstep(0.66, 0.78, r); // 1 inside the ring's outer edge
  diffuseColor.rgb = mix(diffuseColor.rgb, ${EDGE}, ring);
  diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a * 2.2), ring) * outside;`,
    )}`;
  }
}

/**
 * The ray itself: a light core with dark edges along its length, still fading
 * away from the hand the way the library's does.
 *
 * The ray is a unit box stretched along z, so across any side face one of x
 * and y is pinned to the face and the other runs edge to edge — the smaller of
 * the two is the distance from the ray's centre line on whichever face is seen.
 */
export class TwoToneRayMaterial extends MeshBasicMaterial {
  constructor() {
    super({ transparent: true, toneMapped: false });
  }
  onBeforeCompile(parameters: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
    super.onBeforeCompile(parameters, renderer);
    parameters.vertexShader = `varying float vFade;\nvarying float vAcross;\n${parameters.vertexShader.replace(
      VERTEX_ANCHOR,
      `${VERTEX_ANCHOR}\n  vFade = position.z + 0.5;\n  vAcross = min(abs(position.x), abs(position.y)) * 2.0;`,
    )}`;
    parameters.fragmentShader = `varying float vFade;\nvarying float vAcross;\n${parameters.fragmentShader.replace(
      COLOR_ANCHOR,
      `${COLOR_ANCHOR}
  float edge = smoothstep(0.35, 0.6, vAcross);
  diffuseColor.rgb = mix(diffuseColor.rgb, ${EDGE}, edge);
  diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a * 2.2), edge) * vFade;`,
    )}`;
  }
}
