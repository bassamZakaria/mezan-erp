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
// `better-sqlite3-multiple-ciphers` is the same native module with SQLCipher
// support — main/encrypted-database.ts opens the tenant database with it.
const external = ["electron", "better-sqlite3", "better-sqlite3-multiple-ciphers"];

// THE VENDOR CONFIGURATION IS BAKED IN HERE, and this is the only place it can
// come from.
//
// The licence public key, the fingerprint salt, the check-in address and the
// update-signing key used to be read from `process.env` at RUNTIME, with empty
// compile-time defaults and nothing anywhere that set them. A packaged app
// launched from the Dock or the Start menu has no environment, so every shipped
// build resolved to `NO_PUBLIC_KEY`: a paid licence file changed nothing, and
// the red banner blamed the shop for a build defect.
//
// esbuild substitutes these identifiers with string literals at bundle time, so
// they are part of the binary. Absent from the build environment they stay
// empty, and the app says plainly that it was built without a vendor key rather
// than pretending the customer has no licence. The release workflow's preflight
// is what refuses to publish a build with them empty.
const vendorDefine = {
  __MEZAN_LICENSE_PUBLIC_KEY__: JSON.stringify(process.env.MEZAN_LICENSE_PUBLIC_KEY ?? ""),
  __MEZAN_LICENSE_FINGERPRINT_SALT__: JSON.stringify(
    process.env.MEZAN_LICENSE_FINGERPRINT_SALT ?? "",
  ),
  __MEZAN_LICENSE_CHECKIN_URL__: JSON.stringify(process.env.MEZAN_LICENSE_CHECKIN_URL ?? ""),
  __MEZAN_UPDATE_PUBLIC_KEY__: JSON.stringify(process.env.MEZAN_UPDATE_PUBLIC_KEY ?? ""),
  // COMPILED OUT unless a build is deliberately made for a test machine. This
  // replaced `MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED=1`, which a packaged customer
  // install read from its own environment — i.e. whoever launched the app
  // decided whether it checked its own signature. `false` in everything the
  // release workflow produces.
  __MEZAN_ALLOW_UNSIGNED_UPDATES__: process.env.MEZAN_ALLOW_UNSIGNED_UPDATES === "1" ? "true" : "false",
};

for (const [name, value] of Object.entries(vendorDefine)) {
  if (name === "__MEZAN_ALLOW_UNSIGNED_UPDATES__") continue;
  if (value === '""') {
    console.warn(
      `[build] ${name.replace(/^__|__$/g, "")} is not set — this build cannot be used in production.`,
    );
  }
}

await build({
  entryPoints: [path.join(appDir, "src/main/index.ts")],
  outfile: path.join(appDir, "dist/main/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external,
  define: vendorDefine,
  sourcemap: true,
  logLevel: "info",
});

// The off-main-thread half of the daily backup (docs/artifacts/audit-2026-09-07.md
// Q-2): forked as its own process, so it needs its own entry point rather than
// riding along inside index.cjs — bundled beside it so backup-service.ts's
// `resolveWorkerEntry()` finds it at a fixed, predictable path.
await build({
  entryPoints: [path.join(appDir, "src/backup/backup-worker.ts")],
  outfile: path.join(appDir, "dist/main/backup-worker.cjs"),
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
