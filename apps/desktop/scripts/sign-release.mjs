#!/usr/bin/env node
// Signs each release artifact with the vendor Ed25519 key and writes the
// detached signatures the app refuses to update without.
//
// WHAT IS SIGNED, and it is not just the hash:
//
//     version || channel || arch || sha512
//
// Signing the SHA-512 alone binds a signature to bytes and to nothing else, so
// an old installer we genuinely signed, republished under a higher version on a
// feed somebody else controls, passes both electron-updater's semver check and
// ours — a downgrade to a build whose bugs are public. The tuple binds the
// release identity too, and main/update-verify.ts rebuilds every field of it on
// the client from feed metadata and the running app.
//
// SOURCE OF TRUTH: apps/desktop/src/main/update-verify.ts's
// `canonicalUpdateMessage` and `selectArtifactSha512`. If the separator, the
// field order or the artifact-selection rule changes in one, it must change in
// the other or every update stops verifying in the field.
//
// It fails closed at every step: a missing key, an unparseable feed file, a
// public key that does not belong to the signing key, or an architecture whose
// artifact cannot be identified all exit non-zero and sign nothing.
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getPublicKeyAsync, signAsync, verifyAsync } from "@noble/ed25519";

const FIELD_SEPARATOR = "||";

const ARCH_TOKENS = [
  ["arm64", /(arm64|aarch64)/i],
  ["armv7l", /armv7l/i],
  ["ia32", /(ia32|x86(?!_64))/i],
];

/** The artifact electron-updater actually downloads on each platform. */
const UPDATE_ARTIFACT_EXTENSION = {
  darwin: /\.zip$/i,
  win32: /\.exe$/i,
  linux: /\.(AppImage|deb)$/i,
};

const FEED_PLATFORM = [
  [/^latest-mac\.yml$/i, "darwin"],
  [/^latest-linux\.yml$/i, "linux"],
  [/^latest\.yml$/i, "win32"],
];

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function archOfUrl(url) {
  for (const [arch, pattern] of ARCH_TOKENS) {
    if (pattern.test(url)) return arch;
  }
  return "x64";
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/**
 * Reads the two fields this script needs out of an electron-builder feed file.
 * Deliberately not a general YAML parser: a release must not depend on a
 * dependency resolving on the runner, and anything this cannot read is a hard
 * failure rather than a silently empty file list.
 */
function parseFeed(text) {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!version) throw new Error("no `version:` in the feed file");

  const files = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const urlMatch = /^\s*-\s+url:\s*(.+)$/.exec(line);
    if (urlMatch) {
      current = { url: urlMatch[1].trim().replace(/^['"]|['"]$/g, ""), sha512: null };
      files.push(current);
      continue;
    }
    const shaMatch = /^\s+sha512:\s*(.+)$/.exec(line);
    if (shaMatch && current && current.sha512 === null) {
      current.sha512 = shaMatch[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  const usable = files.filter((f) => f.url && f.sha512);
  if (usable.length === 0) throw new Error("no `files:` entries with a sha512");
  return { version, files: usable };
}

/** One artifact per (platform, arch) — the one the client will download. */
function selectPerArch(files, platform) {
  const extension = UPDATE_ARTIFACT_EXTENSION[platform];
  const byArch = new Map();
  for (const file of files) {
    if (extension && !extension.test(file.url)) continue;
    const arch = archOfUrl(file.url);
    const existing = byArch.get(arch);
    if (existing && existing.sha512 !== file.sha512) {
      throw new Error(
        `two different ${platform}/${arch} artifacts (${existing.url}, ${file.url}). ` +
          "The client cannot tell which one it is meant to verify, so this is refused here.",
      );
    }
    byArch.set(arch, file);
  }
  if (byArch.size === 0) throw new Error(`no installable ${platform} artifact in the feed file`);
  return byArch;
}

const releaseDir = arg("release-dir", path.join("apps", "desktop", "release"));
const channel = arg("channel", "latest");

const secretHex = (process.env.MEZAN_UPDATE_SIGNING_KEY ?? "").trim();
const publicHex = (process.env.MEZAN_UPDATE_PUBLIC_KEY ?? "").trim().toLowerCase();
if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) {
  fail("MEZAN_UPDATE_SIGNING_KEY must be the 32-byte Ed25519 seed as 64 hex characters.");
}
if (!/^[0-9a-f]{64}$/.test(publicHex)) {
  fail("MEZAN_UPDATE_PUBLIC_KEY must be the 32-byte Ed25519 public key as 64 hex characters.");
}

const secretKey = Uint8Array.from(Buffer.from(secretHex, "hex"));
const derived = Buffer.from(await getPublicKeyAsync(secretKey)).toString("hex");
if (derived !== publicHex) {
  // The one mistake that produces a perfectly successful release nobody can
  // install: signatures made by a key the shipped app does not trust.
  fail(
    "MEZAN_UPDATE_PUBLIC_KEY is not the public key of MEZAN_UPDATE_SIGNING_KEY. " +
      "The build would be signed with a key the app refuses. Nothing was signed.",
  );
}

let entries;
try {
  entries = await readdir(releaseDir);
} catch {
  fail(`no release directory at ${releaseDir}`);
}

const feeds = entries.filter((name) => FEED_PLATFORM.some(([pattern]) => pattern.test(name)));
if (feeds.length === 0) {
  fail(`no latest*.yml in ${releaseDir} — electron-builder produced no update feed to sign.`);
}

let written = 0;
for (const feedName of feeds) {
  const platform = FEED_PLATFORM.find(([pattern]) => pattern.test(feedName))?.[1];
  let feed;
  try {
    feed = parseFeed(await readFile(path.join(releaseDir, feedName), "utf8"));
  } catch (err) {
    fail(`${feedName}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let selected;
  try {
    selected = selectPerArch(feed.files, platform);
  } catch (err) {
    fail(`${feedName}: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const [arch, file] of selected) {
    const message = [feed.version, channel, arch, file.sha512].join(FIELD_SEPARATOR);
    const bytes = new TextEncoder().encode(message);
    const signature = await signAsync(bytes, secretKey);
    // Verified here, with the PUBLIC key, exactly as the client will: a
    // signature that does not verify on the machine that made it will not start
    // verifying in the field.
    if (!(await verifyAsync(signature, bytes, Uint8Array.from(Buffer.from(publicHex, "hex"))))) {
      fail(`the signature produced for ${file.url} does not verify. Nothing further was written.`);
    }
    // Platform AND arch: one feed directory holds latest.yml and
    // latest-mac.yml, so a Windows x64 installer and a Mac x64 zip would
    // otherwise both claim `<version>-x64.sig`.
    const sigName = `${feed.version}-${platform}-${arch}.sig`;
    await writeFile(
      path.join(releaseDir, sigName),
      `${Buffer.from(signature).toString("base64")}\n`,
      "utf8",
    );
    console.log(`signed ${file.url} → ${sigName}`);
    written += 1;
  }
}

console.log(`${written} signature(s) written to ${releaseDir}.`);
