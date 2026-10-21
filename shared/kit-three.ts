/**
 * THE ROOM'S three.js, LENT TO SPACES at /kit/three/, so a space page imports
 * the very three the room runs (src/kit/index.ts):
 *
 *   { "imports": { "three": "/kit/three/three.module.js", "three/addons/": "/kit/three/addons/" } }
 *
 * Scripts, and the decoders' WebAssembly beside them (Draco, Basis: compressed
 * glTF); nothing else from the package. One rule for the two places that serve
 * it: the build copies these into dist/kit/three/ so they go out compressed
 * (tools/kit-three.mts), and server/spaces/routes.ts reads them from
 * node_modules where there is no such copy.
 */
export function kitThreeFile(rest: string): { dir: "build" | "examples/jsm"; file: string } | null {
  if (!(rest.endsWith(".js") || (rest.startsWith("addons/libs/") && rest.endsWith(".wasm")))) return null;
  return rest.startsWith("addons/") ? { dir: "examples/jsm", file: rest.slice("addons/".length) } : { dir: "build", file: rest };
}
