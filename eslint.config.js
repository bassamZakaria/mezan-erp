import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Layer-boundary specifiers that packages/domain must never import.
 *
 * Encodes the rule in docs/archive/plan.md §3.2: the domain core is transport- and
 * database-agnostic — it may depend on PORTS only, never on api, persistence,
 * web, electron, node:fs/node:http, or any driver. Enforced here on the raw
 * import specifier (no module resolver involved) so it is deterministic and
 * cannot silently no-op.
 */
const domainForbiddenPaths = [
  "@mezan/api",
  "@mezan/persistence",
  "@mezan/server",
  "web",
  "desktop",
  "electron",
  "hono",
  "drizzle-orm",
  "better-sqlite3",
  "pg",
  "node:fs",
  "fs",
  "node:http",
  "http",
];

const domainForbiddenPatterns = [
  "@mezan/api/*",
  "@mezan/persistence/*",
  "**/persistence/**",
  "**/api/**",
  "**/apps/**",
  "drizzle-orm/*",
];

const boundaryMessage =
  "packages/domain may not import api/persistence/web/electron/node:fs/node:http/drivers (layer-boundary rule, docs/archive/plan.md §3.2).";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.config.js",
      "**/*.config.ts",
      "**/*.config.mjs",
      "scripts/**",
      ".worktrees/**",
      "coverage/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {},
  },
  {
    /**
     * The rules of hooks, enforced.
     *
     * This ran unchecked across ~120 screens for the whole build. Neither rule
     * is stylistic: `rules-of-hooks` catches a hook behind a condition or an
     * early return, which corrupts React's hook ordering and misreads one
     * screen's state as another's; `exhaustive-deps` catches the stale closure
     * that makes a list keep showing the previous branch's rows after the
     * scope selector changes — a class of bug this codebase has already been
     * bitten by (see ApiContext's scope-invalidation effect).
     */
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // The layer-boundary rule, scoped to the domain core only.
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: domainForbiddenPaths.map((name) => ({
            name,
            message: boundaryMessage,
          })),
          patterns: [{ group: domainForbiddenPatterns, message: boundaryMessage }],
        },
      ],
    },
  },
);
