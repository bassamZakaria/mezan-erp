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
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      all: true,
      include: [
        "packages/*/src/**/*.{ts,tsx}",
        "apps/web/src/**/*.{ts,tsx}",
        "apps/desktop/src/**/*.ts",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/test-support.{ts,tsx}",
        "**/src/test/**",
        "**/test-helpers/**",
        // Fixture data, not product logic: the demo seed is verified by
        // `pnpm check:seed` and `pnpm smoke`, which run it against the real
        // backend. Unit-testing a fixture only asserts the fixture.
        "packages/backend/src/demo-seed.ts",
        "packages/backend/src/demo-seed/**",
        // Electron main/preload: they need a real Electron runtime, and the
        // logic worth guarding (backup, entitlements, LAN host, paths) is
        // already extracted into modules that ARE covered.
        "apps/desktop/src/main/index.ts",
        "apps/desktop/src/main/window.ts",
        "apps/desktop/src/preload/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
