import * as THREE from "three";

/**
 * ONE three.js FOR THE ROOM AND EVERY MODULE IT LOADS (Nikk, 2026-10-01: a
 * space's items, environments and spaces run straight inside saha.ing).
 *
 * A module from a space is written like any three.js page's code:
 * `import * as THREE from "three"`. On its own page the import map points
 * "three" at /kit/three/three.module.js. Inside the saha.ing room it must be
 * the ROOM'S three.js, the very same classes, or its meshes, materials and
 * loaders would belong to a second copy the room's renderer only half knows.
 *
 * So the room's import map points "three" here, and this module hands out the
 * copy the room put on globalThis.__SAHA_THREE__ (src/main.tsx), export by
 * export. three's addons (/kit/three/addons/...) import "three" too, and get
 * the same copy the same way.
 */
export function threeBridgeSource(): string {
  const names = Object.keys(THREE).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default").sort();
  return [
    "// saha.ing: the room's own three.js, for modules loaded into it (server/spaces/three-bridge.ts).",
    "const THREE = globalThis.__SAHA_THREE__;",
    'if (!THREE) throw new Error("saha.ing: this module expects the saha.ing room\'s three.js; on its own page, map \\"three\\" to /kit/three/three.module.js");',
    `export const { ${names.join(", ")} } = THREE;`,
    "export default THREE;",
    "",
  ].join("\n");
}
