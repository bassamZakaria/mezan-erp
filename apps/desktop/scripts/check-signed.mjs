// Release gate. Run it with plain node, AFTER electron-builder has packaged:
//   node apps/desktop/scripts/check-signed.mjs
//   node apps/desktop/scripts/check-signed.mjs --release-dir apps/desktop/release
//
// WHAT IT CATCHES, AND WHY IT EXISTS SEPARATELY FROM electron-builder.
//
// electron-builder.yml sets `forceCodeSigning: true`, which makes the packager
// throw rather than emit an unsigned macOS or Windows artifact. That closes the
// obvious hole and none of the quiet ones:
//
//   - `mac.notarize: true` does NOT mean the app was notarized. It means the
//     integration was not switched off. With the Apple API-key environment
//     variables missing, app-builder-lib's MacTargetHelper.js:264 logs
//     "`notarize` options were unable to be generated" and RETURNS. The build
//     succeeds. The DMG is signed. Gatekeeper still blocks it on the customer's
//     Mac, and nobody finds out until the customer calls.
//   - `codesign --verify` passes on an AD-HOC signature (`identity: "-"`),
//     which carries no publisher at all. electron-updater has nothing to check
//     a downloaded package against, which is the entire attack this pass
//     exists to close.
//   - A Windows signature with no RFC-3161 timestamp verifies today and starts
//     failing SmartScreen on every installer we ever shipped the day the
//     certificate expires.
//   - `--config.publish.url` can be forgotten, in which case the packaged app
//     ships pointed at the reserved placeholder feed and its updater is inert.
//
// So this asks the OPERATING SYSTEM's own tools what it thinks of the finished
// files, which is the same question a customer's machine will ask.
//
// A CHECK THAT NO-OPS IS WORSE THAN NO CHECK. Every path below that cannot
// answer the question — a missing `codesign`, a missing `signtool` AND a
// missing PowerShell, a release directory with no artifacts in it, a platform
// with no signature format at all — exits NON-ZERO. "I could not tell" is
// never allowed to read as "it is fine": that is precisely how a release
// pipeline ends up green while shipping an unsigned binary.
//
// This product also binds a LAN socket (apps/desktop/src/main/lan-host.ts).
// An unsigned auto-update over a network an attacker already sits on is remote
// code execution on every install at once, which is why this gate blocks the
// release path rather than warning on it.
//
// ESM (.mjs), matching scripts/build.mjs: apps/desktop/package.json is
// `"type": "module"` and this runs under plain node. The sibling
// check-native-abi.cjs is CommonJS for the opposite reason — Electron's main
// process loads it directly.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RELEASE_DIR = path.resolve(scriptDir, "..", "release");

/**
 * Reserved / non-routable TLDs (RFC 2606 and RFC 6761). electron-builder.yml
 * ships `https://updates.mezan.example/desktop/` on purpose so a stray build
 * cannot find anything to install; a RELEASE that still carries it is a
 * release whose updater is pointed at nothing, and shipping one silently
 * teaches the field that "updates don't work here", which is how the whole
 * mechanism dies.
 */
const PLACEHOLDER_TLDS = new Set(["example", "invalid", "test", "localhost"]);

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
  console.error(`[signed] FAIL: ${message}`);
}

function ok(message) {
  console.log(`[signed] ok: ${message}`);
}

function note(message) {
  notes.push(message);
  console.log(`[signed] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    // ENOENT here means the tool is not installed. It is reported as a
    // failure by every caller, never skipped.
    missing: result.error?.code === "ENOENT",
    status: result.status,
    output,
  };
}

function toolExists(command, probeArgs) {
  return !run(command, probeArgs).missing;
}

function parseArgs(argv) {
  const parsed = { releaseDir: DEFAULT_RELEASE_DIR, platform: process.platform };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--release-dir") {
      parsed.releaseDir = path.resolve(argv[++i] ?? "");
    } else if (arg.startsWith("--release-dir=")) {
      parsed.releaseDir = path.resolve(arg.slice("--release-dir=".length));
    } else if (arg === "--platform") {
      parsed.platform = argv[++i] ?? "";
    } else if (arg.startsWith("--platform=")) {
      parsed.platform = arg.slice("--platform=".length);
    } else {
      console.error(`[signed] unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return parsed;
}

/** Depth-limited walk: the release tree is shallow and `.app` bundles are huge. */
function findEntries(root, predicate, maxDepth = 3, depth = 0) {
  if (depth > maxDepth) return [];
  let dirents;
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const dirent of dirents) {
    const full = path.join(root, dirent.name);
    if (predicate(dirent, full)) {
      found.push(full);
      // Do not descend into a matched .app bundle.
      continue;
    }
    if (dirent.isDirectory()) found.push(...findEntries(full, predicate, maxDepth, depth + 1));
  }
  return found;
}

// ---------------------------------------------------------------------------
// The update feed the packaged app actually carries.
//
// electron-builder writes the resolved `publish` config into `app-update.yml`
// inside the packaged app. That file — not electron-builder.yml — is what
// electron-updater reads at runtime, so it is the only honest place to check
// which feed a release will talk to.
// ---------------------------------------------------------------------------
function checkUpdateFeed(appUpdateYmlPath, label) {
  if (!fs.existsSync(appUpdateYmlPath)) {
    fail(`${label}: no app-update.yml in the packaged app. electron-updater has no feed at all.`);
    return;
  }
  const text = fs.readFileSync(appUpdateYmlPath, "utf8");
  // Deliberately a line-oriented read rather than a YAML parse: this script has
  // no dependencies and must run on a bare CI runner with nothing installed.
  const urlLine = text.split(/\r?\n/).find((line) => /^\s*url:\s*/.test(line));
  if (!urlLine) {
    fail(`${label}: app-update.yml carries no \`url:\`. The updater cannot reach any feed.`);
    return;
  }
  const rawUrl = urlLine.replace(/^\s*url:\s*/, "").trim().replace(/^["']|["']$/g, "");
  let host;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    fail(`${label}: app-update.yml \`url:\` is not a URL: ${rawUrl}`);
    return;
  }
  const tld = host.split(".").pop() ?? "";
  if (PLACEHOLDER_TLDS.has(tld.toLowerCase())) {
    fail(
      `${label}: the packaged app still points at the placeholder feed (${rawUrl}). ` +
        "Pass --config.publish.url=\"$MEZAN_UPDATE_FEED_URL\" to electron-builder on the " +
        "release path; see .github/workflows/release.yml.",
    );
    return;
  }
  if (!rawUrl.toLowerCase().startsWith("https://")) {
    fail(
      `${label}: the update feed is not HTTPS (${rawUrl}). A plain-HTTP feed hands the ` +
        "update channel to anyone on the path, which is the same wire this product's LAN " +
        "socket already exposes.",
    );
    return;
  }
  ok(`${label}: update feed is ${rawUrl}`);
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------
function checkMac(releaseDir) {
  for (const [tool, probe] of [
    ["codesign", ["--version"]],
    ["spctl", ["--status"]],
    ["xcrun", ["--find", "stapler"]],
  ]) {
    if (!toolExists(tool, probe)) {
      fail(
        `\`${tool}\` is not on PATH. This gate cannot verify a macOS signature without it, ` +
          "and a check that cannot answer must not pass. Run this on a macOS runner with " +
          "the Xcode command line tools installed.",
      );
    }
  }
  if (failures.length > 0) return;

  const apps = findEntries(releaseDir, (dirent, full) => dirent.isDirectory() && full.endsWith(".app"));
  const dmgs = findEntries(releaseDir, (dirent) => dirent.isFile() && dirent.name.endsWith(".dmg"));

  if (apps.length === 0) fail(`no .app bundle found under ${releaseDir}`);
  if (dmgs.length === 0) fail(`no .dmg found under ${releaseDir}`);

  for (const app of apps) {
    const label = path.relative(releaseDir, app);

    const verify = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    if (verify.status !== 0) {
      fail(`${label}: codesign --verify --deep --strict failed\n${verify.output.trim()}`);
    } else {
      ok(`${label}: codesign --verify --deep --strict`);
    }

    const display = run("codesign", ["--display", "--verbose=4", app]);
    if (display.status !== 0) {
      fail(`${label}: codesign --display failed\n${display.output.trim()}`);
    } else {
      // An ad-hoc signature passes --verify and carries NO publisher. It is the
      // one signature electron-updater can do nothing with, so it has to be
      // named and rejected rather than assumed absent.
      if (/^Signature=adhoc$/m.test(display.output)) {
        fail(
          `${label}: signed AD-HOC. An ad-hoc signature has no publisher, so electron-updater ` +
            "has nothing to verify a downloaded package against — exactly the state this gate exists to stop.",
        );
      }
      if (!/^Authority=Developer ID Application:/m.test(display.output)) {
        fail(
          `${label}: not signed by a "Developer ID Application" certificate. ` +
            "A Mac Developer / development identity runs only on the machine that built it and " +
            "Apple will not notarize it.",
        );
      }
      const team = /^TeamIdentifier=(.+)$/m.exec(display.output)?.[1]?.trim();
      if (!team || team === "not set") {
        fail(`${label}: no TeamIdentifier on the signature.`);
      } else {
        ok(`${label}: Developer ID Application, TeamIdentifier=${team}`);
      }
    }

    // THE NOTARIZATION CHECK. `spctl --assess` is Gatekeeper's own verdict.
    // `source=Notarized Developer ID` is the only source string that means the
    // ticket exists; a merely signed app reports `source=Developer ID` and is
    // still blocked on a customer's Mac.
    const assess = run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
    if (assess.status !== 0) {
      fail(`${label}: spctl --assess rejected it (Gatekeeper would block it)\n${assess.output.trim()}`);
    } else if (!/source=Notarized Developer ID/.test(assess.output)) {
      fail(
        `${label}: accepted by spctl but NOT notarized (${assess.output.trim().replace(/\n/g, " ")}). ` +
          "`mac.notarize: true` skips silently when APPLE_API_KEY / APPLE_API_KEY_ID / " +
          "APPLE_API_ISSUER are missing — check the release workflow's secrets.",
      );
    } else {
      ok(`${label}: spctl --assess accepted, source=Notarized Developer ID`);
    }

    checkUpdateFeed(path.join(app, "Contents", "Resources", "app-update.yml"), label);
  }

  for (const dmg of dmgs) {
    const label = path.relative(releaseDir, dmg);

    const verify = run("codesign", ["--verify", "--strict", "--verbose=2", dmg]);
    if (verify.status !== 0) {
      fail(`${label}: the disk image itself is not validly signed\n${verify.output.trim()}`);
    } else {
      ok(`${label}: codesign --verify --strict`);
    }

    // The stapled ticket is what lets Gatekeeper approve the download on a Mac
    // that is offline, or one whose owner opens it before Apple's servers are
    // reachable. Without it a notarized build still shows the "cannot be
    // opened" dialog for a shop with a bad line, which is most of them.
    const stapled = run("xcrun", ["stapler", "validate", dmg]);
    if (stapled.status !== 0) {
      fail(
        `${label}: no stapled notarization ticket (\`xcrun stapler validate\` failed)\n` +
          stapled.output.trim(),
      );
    } else {
      ok(`${label}: notarization ticket is stapled`);
    }
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function findSigntool() {
  if (toolExists("signtool", ["/?"])) return "signtool";
  // The Windows SDK does not put signtool on PATH. `where` will not find it
  // either, so look where the SDK actually installs it, newest first.
  const roots = [
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin"),
    path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Windows Kits", "10", "bin"),
  ];
  const candidates = [];
  for (const root of roots) {
    let versions;
    try {
      versions = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      for (const arch of ["x64", "x86", "arm64"]) {
        const candidate = path.join(root, version.name, arch, "signtool.exe");
        if (fs.existsSync(candidate)) candidates.push(candidate);
      }
    }
  }
  candidates.sort().reverse();
  return candidates[0] ?? null;
}

function findPowerShell() {
  for (const shell of ["pwsh", "powershell"]) {
    if (toolExists(shell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"])) return shell;
  }
  return null;
}

function checkWindowsFileWithSigntool(signtool, file, label) {
  // `/pa` uses the Authenticode policy (the one Windows itself applies to an
  // executable) rather than the driver policy. `/tw` turns "not timestamped"
  // from a warning into an error: an untimestamped signature stops verifying
  // the day the certificate expires, retroactively, on every installer already
  // in the field.
  const result = run(signtool, ["verify", "/pa", "/tw", "/v", file]);
  if (result.status !== 0) {
    fail(`${label}: signtool verify /pa /tw failed\n${result.output.trim()}`);
    return;
  }
  ok(`${label}: signtool verify /pa /tw (Authenticode, timestamped)`);
}

function checkWindowsFileWithPowerShell(shell, file, label) {
  // Get-AuthenticodeSignature is the same API Explorer's "Digital Signatures"
  // tab uses. Status must be Valid — NotSigned, HashMismatch and
  // UnknownError all mean a customer's SmartScreen will refuse it — and the
  // timestamp certificate must exist, for the expiry reason above.
  const script =
    `$ErrorActionPreference='Stop';` +
    `$s = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)};` +
    `Write-Output ("STATUS=" + $s.Status);` +
    `Write-Output ("SUBJECT=" + $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }));` +
    `Write-Output ("TIMESTAMPED=" + $(if ($s.TimeStamperCertificate) { 'yes' } else { 'no' }))`;
  const result = run(shell, ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (result.status !== 0) {
    fail(`${label}: Get-AuthenticodeSignature failed\n${result.output.trim()}`);
    return;
  }
  const status = /^STATUS=(.*)$/m.exec(result.output)?.[1]?.trim();
  const subject = /^SUBJECT=(.*)$/m.exec(result.output)?.[1]?.trim();
  const timestamped = /^TIMESTAMPED=(.*)$/m.exec(result.output)?.[1]?.trim();
  if (status !== "Valid") {
    fail(`${label}: Authenticode status is "${status}", not "Valid". Windows would refuse it.`);
    return;
  }
  if (timestamped !== "yes") {
    fail(
      `${label}: the Authenticode signature is not timestamped. It stops verifying the day the ` +
        "certificate expires — on every installer already in the field, retroactively.",
    );
    return;
  }
  ok(`${label}: Authenticode Valid + timestamped (${subject || "subject unavailable"})`);
}

function checkWindows(releaseDir) {
  const signtool = findSigntool();
  const shell = findPowerShell();
  if (!signtool && !shell) {
    fail(
      "neither signtool.exe (Windows SDK) nor PowerShell is available. This gate cannot verify " +
        "an Authenticode signature without one of them, and a check that cannot answer must not pass.",
    );
    return;
  }
  if (!signtool) {
    note(`signtool.exe not found; verifying with ${shell} Get-AuthenticodeSignature instead.`);
  }

  const installers = findEntries(
    releaseDir,
    (dirent) => dirent.isFile() && dirent.name.toLowerCase().endsWith(".exe"),
    2,
  );
  if (installers.length === 0) {
    fail(`no .exe found under ${releaseDir}`);
    return;
  }

  for (const file of installers) {
    const label = path.relative(releaseDir, file);
    if (signtool) checkWindowsFileWithSigntool(signtool, file, label);
    else checkWindowsFileWithPowerShell(shell, file, label);
  }

  const unpackedFeeds = findEntries(
    releaseDir,
    (dirent, full) => dirent.isFile() && path.basename(full) === "app-update.yml",
    3,
  );
  if (unpackedFeeds.length === 0) {
    fail(`no app-update.yml found under ${releaseDir}. electron-updater has no feed at all.`);
  } else {
    for (const feed of unpackedFeeds) checkUpdateFeed(feed, path.relative(releaseDir, feed));
  }
}

// ---------------------------------------------------------------------------

function main() {
  const { releaseDir, platform } = parseArgs(process.argv.slice(2));
  console.log(`[signed] release dir: ${releaseDir}`);
  console.log(`[signed] platform:    ${platform}`);

  if (!fs.existsSync(releaseDir)) {
    fail(`release directory does not exist: ${releaseDir}. Nothing was packaged.`);
  } else if (platform === "darwin") {
    checkMac(releaseDir);
  } else if (platform === "win32") {
    checkWindows(releaseDir);
  } else {
    // NOT a pass. Linux AppImage and .deb carry no per-application signature
    // that electron-updater or this script could verify, which is exactly why
    // electron-builder.yml keeps Linux off the signed release path. Reaching
    // here means a release job ran on the wrong runner.
    fail(
      `platform "${platform}" has no artifact signature this gate can verify. ` +
        "The signed release path is macOS (codesign + notarization) and Windows (Authenticode) only; " +
        "see apps/desktop/electron-builder.yml.",
    );
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`[signed] ${failures.length} problem(s) — this build is NOT shippable:`);
    for (const message of failures) console.error(`  - ${message.split("\n")[0]}`);
    console.error(
      "\n[signed] Do not publish it, and do not work around this by disabling the gate. " +
        "An unsigned update on a product that also binds a LAN socket is remote code execution " +
        "on every install at once — see apps/desktop/src/main/updater.ts.",
    );
    process.exit(1);
  }

  for (const message of notes) console.log(`[signed] note: ${message}`);
  console.log("[signed] OK — every artifact is signed, and the OS agrees.");
  process.exit(0);
}

main();
