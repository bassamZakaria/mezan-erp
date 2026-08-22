import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The web build reaches the shared Hono backend over HTTP at `/api`, proxied to
 * apps/server (run it with `pnpm server`; e2e starts it automatically). Electron
 * bypasses this entirely via `window.mezan.fetch` → `app.fetch`. Override the
 * target with MEZAN_API_URL.
 */
const apiTarget = process.env.MEZAN_API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
