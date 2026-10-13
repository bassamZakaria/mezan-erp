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
    // apps/mobile is React Native on React 19; this project pins React 18 for the web
    // client, and loading both into one vitest run breaks react-dom. It has its own config.
    exclude: ["**/node_modules/**", "**/dist/**", "apps/mobile/**"],
    setupFiles: ["packages/ui/src/test/setup.ts", "packages/api/src/test/turn-yield-guard.ts"],
    /*
     * Vitest's 5s default is the per-test budget, and testing-library's
     * `waitFor` deadline has to fit INSIDE it — at 5s each a slow wait ate the
     * whole test and the run failed a different handful of screen tests every
     * time while every one of them passed on its own. A hanging test still
     * fails here, just not on a stopwatch that a loaded machine can trip.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
        // window.ts is NOT excluded: its navigation guard and child-window
        // handler are pure functions of a URL, they had a production-only hole
        // in them (D128), and window.test.ts now drives both with electron
        // mocked. Excluding it is what let that hole go unmeasured.
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
