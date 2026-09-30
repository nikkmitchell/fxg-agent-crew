import { defineConfig } from "vite";

/** Share saha.ing's cached Three instance with its kit; no second renderer library. */
export default defineConfig({
  base: "./", publicDir: false,
  build: {
    outDir: "output/retreat-preview", emptyOutDir: true,
    rollupOptions: {
      input: "rain-preview.html",
      external: (id) => id === "three" || id.startsWith("three/addons/"),
    },
  },
});
