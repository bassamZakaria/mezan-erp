import tseslint from "typescript-eslint";

/**
 * Layer-boundary specifiers that packages/domain must never import.
 *
 * Encodes the rule in docs/plan.md §3.2: the domain core is transport- and
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
  "packages/domain may not import api/persistence/web/electron/node:fs/node:http/drivers (layer-boundary rule, docs/plan.md §3.2).";

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
