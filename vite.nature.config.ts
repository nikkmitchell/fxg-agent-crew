import { defineConfig } from "vite";
export default defineConfig({
  base: "./", publicDir: false,
  build: {
    outDir: "output/nature-preview", emptyOutDir: true,
    rollupOptions: {
      input: ["sakura-preview.html", "fireflies-preview.html"],
      external: (id) => id === "three" || id.startsWith("three/addons/"),
    },
  },
});
