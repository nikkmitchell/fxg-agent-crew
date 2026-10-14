import * as THREE from "three";

/**
 * THE ROOM'S three.js, FOR THE MODULES TEAMS LOAD INTO IT. The import map in
 * index.html sends their `import "three"` to /kit/three-bridge.js, which hands
 * out this very copy (server/spaces/three-bridge.ts).
 *
 * Set here, imported by both loaders (room-engine.ts and run-module.ts), so it
 * is in place before either imports a module. It was set in src/main.tsx, which
 * put all of three.js (86 KB gzipped) in the first download of every page, the
 * board and the sign-in included, for the room that loads it anyway (Kerf,
 * 2026-10-14).
 */
(globalThis as { __SAHA_THREE__?: typeof THREE }).__SAHA_THREE__ = THREE;

export {};
