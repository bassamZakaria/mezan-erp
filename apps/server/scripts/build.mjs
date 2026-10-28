import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// REQUIRED: every entry the cloud image runs. backup-verify-worker is forked by
// path from backup-scheduler.ts and must sit beside cloud.js. No code splitting:
// that fork path and each CLI's "am I the started file" check read import.meta.url
// and process.argv[1], which move or stop matching once a module lands in a shared chunk.
const entries = ["cloud", "backup-verify-worker", "sqlite-to-postgres-cli", "audit-anchor-cli"];

await build({
  entryPoints: entries.map((name) => path.join(appDir, "src", `${name}.ts`)),
  outdir: path.join(appDir, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // better-sqlite3 loads its native prebuild from its own directory; pg-native is pg's optional binding, never installed.
  external: ["better-sqlite3", "pg-native"],
  banner: { js: 'import { createRequire as __mezanCreateRequire } from "node:module"; const require = __mezanCreateRequire(import.meta.url);' },
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
});
