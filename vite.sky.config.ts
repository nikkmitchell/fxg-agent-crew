import { defineConfig } from "vite";

/** Independent review build; does not change the main app's entry or room. */
export default defineConfig({
  base: "./",
  publicDir: false,
  build: { outDir: "output/sky-preview", emptyOutDir: true, rollupOptions: { input: "sky-preview.html" } },
});
