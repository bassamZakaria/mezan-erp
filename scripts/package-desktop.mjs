// Builds the installable Mezan desktop application, end to end, from a clean
// checkout. `pnpm desktop:package`.
//
// This exists because the pieces were all here and the sequence was not. The
// packaging chain has SIX steps, three of them non-obvious, and getting them
// out of order produces an installer that looks fine and cannot open its own
// database:
//
//   1. Fetch the Electron BINARY. pnpm-workspace.yaml sets
//      `allowBuilds.electron: false`, so `pnpm install` never downloads it —
//      correct for every other job in this repo (~150MB nobody else needs),
//      fatal here. Without this step electron-builder packages an app around a
//      runtime that is not on disk.
//   2. Rebuild the native modules against ELECTRON's ABI, not Node's.
//      better-sqlite3 and better-sqlite3-multiple-ciphers ship `.node` binaries
//      compiled for one NODE_MODULE_VERSION. `pnpm install` builds them for the
//      Node that runs the tests (22 → ABI 131); Electron 39 is ABI 140 and
//      refuses to load them. electron-builder's own `npmRebuild: true` does this
//      too, but only at package time — doing it here means step 3 can verify it
//      BEFORE we spend two minutes producing an artifact.
//   3. VERIFY that, by launching the real Electron binary and opening a real
//      encrypted database (apps/desktop/scripts/check-native-abi.cjs). An ABI
//      mismatch otherwise surfaces on a customer's machine at first launch,
//      before the pre-migration backup runs — the app does not start and takes
//      no backup on the way down.
//   4. Build the WEB bundle. electron-builder copies apps/web/dist in as
//      `extraResources` (electron-builder.yml) and the packaged app serves it
//      over the `app://` scheme. If it is missing or stale, the installer is
//      built around whatever was in that folder last — a silently old UI.
//   5. Bundle main + preload to CommonJS (apps/desktop/scripts/build.mjs).
//   6. electron-builder.
//
// SIGNING. electron-builder.yml sets `forceCodeSigning: true`, so a mac or
// Windows build with no certificate FAILS rather than emitting an unsigned
// installer someone might ship. That is right for a release and wrong for the
// build you are about to test on your own machine, so this script passes
// `--config.forceCodeSigning=false` unless you ask for `--signed`. An unsigned
// build is for testing only: macOS Gatekeeper blocks it on any machine but the
// one that built it, and the auto-updater refuses to run on a build whose own
// signature it cannot confirm (main/updater.ts). The real signed path is
// .github/workflows/release.yml on a `v*` tag — see docs/INSTALL.md §8.
import { spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = path.join(repoRoot, "apps", "desktop");

const args = new Set(process.argv.slice(2));

function usage() {
  console.log(`
pnpm desktop:package [targets] [options]

Targets (default: this machine's platform)
  --mac            macOS .dmg (x64 + arm64)
  --win            Windows NSIS .exe installer (x64)
  --linux          Linux AppImage + .deb (x64)

Options
  --signed         Keep electron-builder's forceCodeSigning gate on. Requires the
                   certificates in docs/INSTALL.md §8 to be present in the
                   environment. Without this flag the build is UNSIGNED and for
                   local testing only.
  --skip-abi       Skip the Electron native-module check (step 3). Only when you
                   have just run it and nothing reinstalled since.
  --skip-web       Reuse the existing apps/web/dist instead of rebuilding it.
  --clean          Delete apps/desktop/release first.
  --keep-electron-abi
                   Leave the native modules compiled for Electron when the build
                   finishes. \`pnpm test\` will not run until you rebuild them for
                   Node — see the note on the final step.
  --help
`);
}

if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

const hostPlatform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
const requested = ["mac", "win", "linux"].filter((t) => args.has(`--${t}`));
const targets = requested.length > 0 ? requested : [hostPlatform];

// electron-builder can only produce a macOS .dmg on macOS — the signing and
// hdiutil steps are Apple tooling with no cross-platform equivalent. Windows
// from a non-Windows host is possible in principle via wine, but this project
// carries TWO native modules that would each need a Windows binary for
// Electron's ABI, and prebuild-install cannot cross-fetch those reliably. Both
// cases are caught here rather than 90 seconds into a build.
for (const target of targets) {
  if (target === "mac" && hostPlatform !== "mac") {
    console.error(
      `\nCannot build the macOS .dmg on ${process.platform}. Apple's signing and disk-image tools ` +
        `only run on macOS. Use a Mac, or the macOS job in .github/workflows/release.yml.\n`,
    );
    process.exit(1);
  }
  if (target === "win" && hostPlatform !== "win") {
    console.error(
      `\nCannot build the Windows installer on ${process.platform}.\n\n` +
        `This is not an electron-builder limitation — it is better-sqlite3 and\n` +
        `better-sqlite3-multiple-ciphers. Both are native modules that must be compiled\n` +
        `for Windows AND for Electron ${await electronVersion()}'s ABI, and neither can be\n` +
        `cross-compiled from here. A Windows .exe built this way opens no database.\n\n` +
        `Build it on a Windows machine (\`pnpm desktop:package --win\`), or push a \`v*\`\n` +
        `tag and let the windows-latest runner in .github/workflows/release.yml do it —\n` +
        `that path also signs it, which this one cannot.\n`,
    );
    process.exit(1);
  }
}

async function electronVersion() {
  const pkg = path.join(desktopDir, "node_modules", "electron", "package.json");
  return JSON.parse(await readFile(pkg, "utf8")).version;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...options.env };
    // Deleting, not setting to "0" — see the call site in step 1. This is the
    // difference between fetching the Electron binary and silently not.
    for (const name of options.unsetEnv ?? []) delete env[name];
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      stdio: "inherit",
      shell: false,
      env,
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(" ")} exited ${code}`)),
    );
  });
}

async function exists(target) {
  return access(target).then(
    () => true,
    () => false,
  );
}

let step = 0;
function announce(what) {
  step += 1;
  console.log(`\n[${step}] ${what}`);
}

if (args.has("--clean")) {
  await rm(path.join(desktopDir, "release"), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
announce("Electron binary");
// `electron/dist` is what the install script produces and what electron-builder
// packages; its absence is the normal state of a fresh checkout here, not an
// error. Re-running install.js when it is present costs a version check.
if (await exists(path.join(desktopDir, "node_modules", "electron", "dist"))) {
  console.log(`already present (electron ${await electronVersion()})`);
} else {
  console.log(`downloading electron ${await electronVersion()} (~150MB, once per install)`);
  await run("node", ["./node_modules/electron/install.js"], {
    cwd: desktopDir,
    // UNSET, not set to "0". electron/install.js guards on
    // `if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD)` — a plain truthiness
    // check, and the STRING "0" is truthy in JavaScript. Setting it to "0" is
    // therefore identical to setting it to "1": the script returns immediately,
    // exits 0, and leaves no binary behind. The failure surfaces two steps later
    // as "Electron failed to install correctly, please delete node_modules and
    // try again", which sends you looking at the install rather than at the
    // variable that suppressed it.
    //
    // .github/workflows/ci.yml and release.yml set the same variable to "0" for
    // exactly this purpose, and have the same bug.
    unsetEnv: ["ELECTRON_SKIP_BINARY_DOWNLOAD"],
  });
}

// ---------------------------------------------------------------------------
announce("Native modules rebuilt for Electron's ABI");
const version = await electronVersion();
await run("npx", ["--yes", "--package", "@electron/rebuild", "--", "electron-rebuild", "-v", version, "-m", "apps/desktop", "-f"]);

// ---------------------------------------------------------------------------
if (args.has("--skip-abi")) {
  announce("Native ABI check — SKIPPED (--skip-abi)");
} else {
  announce("Native ABI check (Electron opens an encrypted database)");
  await run("pnpm", ["--filter", "desktop", "run", "check:abi"]);
}

// ---------------------------------------------------------------------------
if (args.has("--skip-web")) {
  announce("Web bundle — SKIPPED (--skip-web)");
  if (!(await exists(path.join(repoRoot, "apps", "web", "dist", "index.html")))) {
    console.error("apps/web/dist/index.html does not exist — there is nothing to reuse. Drop --skip-web.");
    process.exit(1);
  }
} else {
  announce("Web bundle");
  await run("pnpm", ["--filter", "web", "build"]);
}

// ---------------------------------------------------------------------------
announce("Main + preload bundles");
await run("pnpm", ["--filter", "desktop", "run", "build:main"]);

// ---------------------------------------------------------------------------
const signed = args.has("--signed");
announce(`electron-builder → ${targets.join(", ")} (${signed ? "SIGNED" : "unsigned, local testing only"})`);
const builderArgs = targets.map((t) => `--${t}`);
builderArgs.push("--publish", "never");
if (!signed) builderArgs.push("--config.forceCodeSigning=false");
await run("pnpm", ["--filter", "desktop", "exec", "electron-builder", ...builderArgs], {
  env: signed
    ? {}
    : {
        // Without this, electron-builder searches the login keychain, finds a
        // developer certificate that is not a Developer ID, and signs the app
        // with an identity that Gatekeeper trusts less than no signature at all.
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      },
});

// ---------------------------------------------------------------------------
// Step 2 rebuilt better-sqlite3 IN THE SHARED pnpm STORE, for Electron's ABI.
// That is what the packaged app needs and it is not what `pnpm test` needs:
// vitest runs under Node 22 (ABI 131) and cannot load an Electron 39 (ABI 140)
// binary at all, so every persistence test starts failing with a
// NODE_MODULE_VERSION error that has nothing to do with the code under test.
// Leaving that behind would mean this command quietly breaks the test suite of
// whoever runs it — so it is put back, and `--keep-electron-abi` is there for
// the case where the next thing you do is package again.
if (args.has("--keep-electron-abi")) {
  announce("Native modules LEFT on Electron's ABI (--keep-electron-abi)");
  console.log("`pnpm test` will fail until you run: pnpm rebuild better-sqlite3 better-sqlite3-multiple-ciphers");
} else {
  announce("Native modules rebuilt for Node (so `pnpm test` still runs)");
  await run("pnpm", ["rebuild", "better-sqlite3", "better-sqlite3-multiple-ciphers"]);
}

console.log(`\nDone. Installers are in apps/desktop/release/`);
if (!signed) {
  console.log(
    `\nThis build is UNSIGNED. On macOS, Gatekeeper will refuse it on any machine but this one\n` +
      `(right-click → Open, once, to run it here). The auto-updater will not run on it at all.\n` +
      `Producing a build a client can install means the certificates in docs/INSTALL.md §8.\n`,
  );
}
