import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
});
