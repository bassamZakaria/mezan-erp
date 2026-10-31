#!/usr/bin/env node
// Refuses a commit that stages a secrets file or a credential-shaped string.
// Default: staged files. `--all`: every tracked file. `--self-test`: asserts only.
// A line that must keep a match (a documented fake) can carry `secret-scan-allow`.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ALLOWED_FILES = [
  /\.env\.example$/,
  /^test-fixtures\/upgrade-matrix\/[^/]+\.audit-chain\.key$/,
];
const SECRET_FILE = /(^|\/)([^/]*\.env([.~][^/]*)?|[^/]+\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|ed25519)[^/]*)$/;

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1"]);
const PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/],
  ["env secret assignment", /^\s*(export\s+)?[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|_KEY)[A-Z0-9_]*=["']?[A-Za-z0-9+/=_-]{16,}["']?\s*$/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["live payment key", /(sk|rk)_live_[A-Za-z0-9]{10,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  [
    "database URL with password",
    /postgres(?:ql)?:\/\/[^\s:@/]+:([^\s@/]{6,})@([^\s/:'"]+)/,
    (m) => !LOCAL_DB_HOSTS.has(m[2]) && !/[$({\\<]/.test(m[1]),
  ],
];

export function findSecrets(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes("secret-scan-allow")) return;
    for (const [label, re, keep = () => true] of PATTERNS) {
      const m = line.match(re);
      if (m && keep(m)) hits.push({ line: i + 1, label });
    }
  });
  return hits;
}

export function isSecretFile(path) {
  return SECRET_FILE.test(path) && !ALLOWED_FILES.some((re) => re.test(path));
}

function selfTest() {
  assert.equal(isSecretFile("deploy/contabo/.env"), true);
  assert.equal(isSecretFile("deploy/contabo/app.env"), true);
  assert.equal(isSecretFile("certs/server.pem"), true);
  assert.equal(isSecretFile("deploy/contabo/app.env.old"), true);
  assert.equal(isSecretFile("deploy/contabo/app.env~"), true);
  assert.equal(isSecretFile("deploy/contabo/restic.env.example"), false);
  assert.equal(isSecretFile("deploy/contabo/.env.example"), false);
  assert.equal(isSecretFile("test-fixtures/upgrade-matrix/x.audit-chain.key"), false);
  assert.equal(isSecretFile("packages/persistence/src/secret-box.ts"), false);
  const fakeAws = "AKIA" + "ABCDEFGHIJKLMNOP";
  assert.equal(findSecrets(`id=${fakeAws}`).length, 1);
  assert.equal(findSecrets("url=postgres://app:s3cretpass@db.example.com:5432/x").length, 1); // secret-scan-allow
  assert.equal(findSecrets("url=postgres://mezan:mezan_app@127.0.0.1:5432/x").length, 0);
  assert.equal(findSecrets("U=postgres://mezan_app:" + "ab12".repeat(16) + "@postgres:5432/mezan").length, 1);
  assert.equal(findSecrets("MEZAN_SECRETS_KEY=" + "cd34".repeat(16)).length, 1);
  assert.equal(findSecrets("MEZAN_AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY=" + "Ab1/".repeat(10)).length, 1);
  assert.equal(findSecrets('MEZAN_SMTP_PASSWORD="' + "pw9x".repeat(5) + '"').length, 1);
  assert.equal(findSecrets("MEZAN_SECRETS_KEY=${MEZAN_SECRETS_KEY}").length, 0);
  assert.equal(findSecrets("-----BEGIN PGP PRIVATE KEY" + " BLOCK-----").length, 1);
  assert.equal(findSecrets("p=\"$(sed 's|postgres://mezan_app:\\([0-9a-f]*\\)@.*$|\\1|')\"").length, 0);
  assert.equal(findSecrets(`id=${fakeAws} secret-scan-allow`).length, 0);
  console.log("check-secrets: self-test ok");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
}

// shortcut: --all reads the checked-out files (HEAD in CI) only, so a secret added then deleted inside one PR passes CI; scan `git log -p` if that matters.
function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const all = process.argv.includes("--all");
  const files = (all ? git(["ls-files", "-z"]) : git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]))
    .split("\0")
    .filter(Boolean);
  const problems = [];
  for (const file of files) {
    if (isSecretFile(file)) problems.push(`${file}: secrets file — keep it out of git`);
    let text;
    try {
      text = all ? readFileSync(file, "utf8") : git(["show", `:${file}`]);
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    for (const hit of findSecrets(text)) problems.push(`${file}:${hit.line}: looks like a ${hit.label}`);
  }
  if (problems.length === 0) return console.log(`check-secrets: ${files.length} file(s) clean`);
  console.error("check-secrets: possible secrets found:\n  " + problems.join("\n  "));
  console.error("Remove them, or mark a known fake line with `secret-scan-allow`.");
  process.exit(1);
}

main();
