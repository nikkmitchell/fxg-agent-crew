import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist-things",
    emptyOutDir: true,
    lib: {
      entry: "src/things/table-games.ts",
      formats: ["es"],
      fileName: () => "tabletop.js",
    },
    rollupOptions: { external: ["three"] },
    minify: false,
  },
});
