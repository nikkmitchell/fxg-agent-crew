import { defineConfig } from "vite";

/**
 * THE SPACE KIT (src/kit/), built on its own into dist/kit/saha.js, after the
 * app's build (which empties dist/). three.js is NOT bundled: a space page
 * maps "three" to /kit/three/ with an import map, so the kit and the page
 * share one three.js, as they must (two copies disagree about what a Mesh is).
 */
export default defineConfig({
  // Not public/ again: the app build already copied it into dist/.
  publicDir: false,
  build: {
    outDir: "dist/kit",
    emptyOutDir: false,
    lib: { entry: "src/kit/index.ts", formats: ["es"], fileName: () => "saha.js" },
    rollupOptions: { external: ["three", /^three\//] },
    minify: false,
  },
});
