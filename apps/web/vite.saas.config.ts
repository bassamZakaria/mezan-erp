import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

const apiTarget = process.env.MEZAN_API_URL ?? "http://127.0.0.1:3000";

export default mergeConfig(
  base,
  defineConfig({
    server: {
      proxy: {
        "/api": { xfwd: true },
        "/billing/test-checkout": { target: apiTarget, changeOrigin: true, xfwd: true },
      },
    },
  }),
);
