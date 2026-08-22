import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // esbuild's automatic JSX runtime (rather than @vitejs/plugin-react) keeps
  // this config on vitest's own bundled vite — pulling in the plugin drags a
  // second, incompatible vite major version into the workspace.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}"],
    setupFiles: ["packages/ui/src/test/setup.ts"],
  },
});
