// Bundles the Electron main process and preload script into plain CommonJS,
// with every workspace package (@mezan/api, @mezan/persistence, ...)
// inlined. This sidesteps a real problem: those packages ship raw
// TypeScript sources via their package.json `exports` (no build step of
// their own — the rest of the monorepo runs them through `tsx` instead),
// and Electron's own module loader cannot execute `.ts` files or resolve
// `tsx`-only workspace `exports` at runtime. Bundling once here means the
// packaged app needs nothing beyond plain Node + the native modules it
// declares `external` below.
//
// This script is NOT part of `pnpm build`/`pnpm typecheck`/`pnpm test` — the
// root CI gate never runs Electron (see pnpm-workspace.yaml `allowBuilds`
// and .github/workflows/ci.yml). It exists for `pnpm --filter desktop start`
// and `pnpm --filter desktop package` on a machine with Electron installed.
import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(root, "..");

// Native modules stay external — they ship prebuilt/rebuilt `.node`
// binaries per Electron ABI and must not be bundled as source.
const external = ["electron", "better-sqlite3"];

await build({
  entryPoints: [path.join(appDir, "src/main/index.ts")],
  outfile: path.join(appDir, "dist/main/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external,
  sourcemap: true,
  logLevel: "info",
});

await build({
  entryPoints: [path.join(appDir, "src/preload/index.ts")],
  outfile: path.join(appDir, "dist/preload/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external,
  sourcemap: true,
  logLevel: "info",
});

// electron-builder's `extraResources` (electron-builder.yml) copies the
// `web` bundle into the packaged app's resources/web at package time; for
// `pnpm --filter desktop start` in a semi-production check, copy it here too
// if it has already been built.
const webDist = path.join(appDir, "..", "web", "dist");
const resourcesWeb = path.join(appDir, "dist", "resources-web");
await mkdir(resourcesWeb, { recursive: true });
await cp(webDist, resourcesWeb, { recursive: true, force: true }).catch(() => {
  console.warn(`[build] apps/web/dist not found — run "pnpm --filter web build" first for a full package.`);
});
