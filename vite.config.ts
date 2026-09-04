import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Build assets and browser BFF calls beneath the same path Wilson mounts.
  // `/` preserves standalone behavior; `/space` produces `/space/...` URLs.
  base: `${(process.env.APP_BASE_PATH || "/").replace(/\/$/, "")}/`,
  plugins: [react()],
});
