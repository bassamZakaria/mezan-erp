import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The web build reaches the shared Hono backend over HTTP at `/api`, proxied to
 * apps/server (run it with `pnpm server`; e2e starts it automatically). Electron
 * bypasses this entirely via `window.mezan.fetch` → `app.fetch`. Override the
 * target with MEZAN_API_URL.
 *
 * No path rewrite: apps/server mounts every route under `/api`, so stripping the
 * prefix sends each call to the SPA fallback and the client parses HTML as JSON.
 */
const apiTarget = process.env.MEZAN_API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  /*
   * Absolute asset paths, served from a real origin.
   *
   * The desktop edition used to load the built bundle over file://, where "/"
   * is the FILESYSTEM ROOT and every /assets/* request 404s. The fix is not a
   * relative base — a relative base breaks the moment a route has depth
   * (`/sell/quotes` would resolve `./assets/x.js` to `/sell/assets/x.js`) —
   * it is serving the renderer from an origin. main/renderer-protocol.ts
   * registers `app://` for exactly that, so "/" means the bundle root in both
   * editions and code-split chunks resolve the same way in each.
   */
  base: "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
