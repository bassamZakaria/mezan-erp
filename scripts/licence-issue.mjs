#!/usr/bin/env node
// `pnpm licence:issue` — the vendor half of the licence, which did not exist.
//
// Nothing in this repository could generate a keypair, sign a payload, keep a
// revocation list or answer a check-in: `@noble/ed25519` was imported for
// `verifyAsync` alone. So there was no sales-to-activation path at all — a shop
// could not be licensed, renewed, moved to a new PC, or have seats added.
//
// Usage:
//   pnpm licence:issue \
//     --licensee "النور للتجارة والتوزيع" \
//     --plan CORE \
//     --modules sales,purchases,inventory,accounting,treasury \
//     --seats 3 \
//     --expires 2027-01-01 \
//     --bind <fingerprint from `Mezan --print-machine-fingerprint`> \
//     --out license.mezan \
//     --ledger licences.csv
//
// `--ledger <file>` (or `MEZAN_LICENCE_LEDGER`) appends the issue to a CSV
// register — customer, fingerprints, modules, seats, expiry, issued-at and the
// file's sha256, never the key — that `pnpm licence:due` reads renewals from.
//
// The private key comes from `--key <file>` or `MEZAN_LICENSE_PRIVATE_KEY`.
// The finished file goes in the install's userData directory as
// `license.mezan` — see docs/INSTALL.md §7A.3.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { publicHexFor, signLicensePayload } from "./licence-crypto.mjs";
import { appendLedgerRow, ledgerPathFrom } from "./licence-ledger.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      // Repeatable: `--bind a --bind b` binds two machines (a replacement PC
      // during a handover, so the shop is never between two working machines).
      out[key] = out[key] === undefined ? next : [].concat(out[key], next);
      i++;
    }
  }
  return out;
}

function list(value) {
  if (value === undefined) return [];
  return []
    .concat(value)
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(`licence:issue — ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

const privateKeyHex = (
  args.key ? readFileSync(path.resolve(String(args.key)), "utf8") : process.env.MEZAN_LICENSE_PRIVATE_KEY ?? ""
).trim();
if (!privateKeyHex) fail("no signing key: pass --key <file> or set MEZAN_LICENSE_PRIVATE_KEY.");

if (!args.licensee) fail("--licensee is required (the shop's registered name, in Arabic).");
if (!args.plan) fail("--plan is required (e.g. CORE, STANDARD, ENTERPRISE).");
if (!args.expires) fail("--expires is required (YYYY-MM-DD, or an ISO timestamp).");

// Sub-modules (packages/domain/src/entitlements/sub-modules.ts): a part whose
// parent is also listed is redundant, and a free part is held by every licence,
// so neither is written. Keep FREE_PARTS in step with FREE_SUB_MODULES there.
const FREE_PARTS = new Set(["hr.people"]);
const requested = [...new Set(list(args.modules))];
const modules = requested.filter((id) => !FREE_PARTS.has(id) && !(id.includes(".") && requested.includes(id.split(".")[0])));
if (modules.length === 0) fail("--modules is required: a licence that activates nothing sells nothing.");

const features = {};
for (const flag of list(args.features)) features[flag] = true;

function isoDay(value, endOfDay = false) {
  const raw = String(value);
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}Z` : raw);
  if (Number.isNaN(parsed)) fail(`"${raw}" is not a date.`);
  return new Date(parsed).toISOString();
}

const now = new Date().toISOString();
const payload = {
  v: 1,
  licenseId: args["license-id"] ? String(args["license-id"]) : `lic-${randomUUID()}`,
  licensee: String(args.licensee),
  edition: args.edition ? String(args.edition) : "desktop",
  plan: String(args.plan),
  activeModules: modules,
  features,
  seats: Number(args.seats ?? 1),
  issuedAt: now,
  // The check-in clock's origin, and it is SIGNED on purpose: an install that
  // has never been online still gets its first week from this date, and
  // deleting the local guard file cannot move it.
  notBefore: args["not-before"] ? isoDay(args["not-before"]) : now,
  expiresAt: isoDay(args.expires, true),
  graceDays: Number(args["grace-days"] ?? 14),
  // Empty = unbound: the licence runs on any machine. Bind it unless the
  // customer has a real reason not to — an unbound file is a file that works
  // on every PC it is copied to.
  machineBinding: list(args.bind),
};

if (!Number.isInteger(payload.seats) || payload.seats < 1) fail("--seats must be a positive whole number.");
if (!Number.isInteger(payload.graceDays) || payload.graceDays < 0) fail("--grace-days must be zero or more.");

const licence = signLicensePayload(payload, privateKeyHex);
const outPath = path.resolve(String(args.out ?? "license.mezan"));
const fileText = `${licence}\n`;
writeFileSync(outPath, fileText, { encoding: "utf8", mode: 0o600 });

const ledger = ledgerPathFrom(args, process.env);
if (ledger) {
  const ledgerPath = path.resolve(ledger);
  appendLedgerRow(ledgerPath, {
    issuedAt: payload.issuedAt,
    licenseId: payload.licenseId,
    licensee: payload.licensee,
    plan: payload.plan,
    modules: payload.activeModules,
    seats: payload.seats,
    notBefore: payload.notBefore,
    expiresAt: payload.expiresAt,
    graceDays: payload.graceDays,
    fingerprints: payload.machineBinding,
    file: path.basename(outPath),
    fileSha256: createHash("sha256").update(fileText, "utf8").digest("hex"),
  });
  console.log(`recorded in ${ledgerPath}`);
}

console.log(`licence written to ${outPath}`);
console.log(`  id        ${payload.licenseId}`);
console.log(`  licensee  ${payload.licensee}`);
console.log(`  plan      ${payload.plan} (${payload.activeModules.join(", ")})`);
console.log(`  seats     ${payload.seats}`);
console.log(`  valid     ${payload.notBefore} → ${payload.expiresAt} (+${payload.graceDays}d grace)`);
console.log(
  `  machines  ${payload.machineBinding.length === 0 ? "UNBOUND — runs on any machine" : payload.machineBinding.join(", ")}`,
);
console.log(`  verifies against MEZAN_LICENSE_PUBLIC_KEY=${publicHexFor(privateKeyHex)}`);
