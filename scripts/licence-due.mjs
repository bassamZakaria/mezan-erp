#!/usr/bin/env node
// `pnpm licence:due` — the renewals to chase, read from the issue ledger that
// `pnpm licence:issue --ledger <file>` keeps.
//
// Usage:
//   pnpm licence:due --ledger licences.csv [--days 30]
//
// The ledger comes from `--ledger` or `MEZAN_LICENCE_LEDGER`.
import path from "node:path";
import { existsSync } from "node:fs";
import { ledgerPathFrom, licencesDue, readLedger } from "./licence-ledger.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[arg.slice(2)] = true;
    else {
      out[arg.slice(2)] = next;
      i++;
    }
  }
  return out;
}

function fail(message) {
  console.error(`licence:due — ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const ledger = ledgerPathFrom(args, process.env);
if (!ledger) fail("no ledger: pass --ledger <file> or set MEZAN_LICENCE_LEDGER.");
const ledgerPath = path.resolve(ledger);
if (!existsSync(ledgerPath)) fail(`${ledgerPath} does not exist — issue a licence with --ledger first.`);
const days = Number(args.days ?? 30);
if (!Number.isInteger(days) || days < 0) fail("--days must be zero or more.");
const now = args.now ? new Date(String(args.now)) : new Date();
if (Number.isNaN(now.getTime())) fail(`"${args.now}" is not a date.`);

const due = licencesDue(readLedger(ledgerPath), days, now);
if (due.length === 0) {
  console.log(`no licence ends within ${days} days.`);
  process.exit(0);
}
console.log(`${due.length} licence(s) to renew within ${days} days:`);
for (const row of due) {
  const when = row.daysLeft < 0 ? `ENDED ${-row.daysLeft}d ago` : `${row.daysLeft}d left`;
  console.log(`  ${row.expiresAt.slice(0, 10)}  ${when.padEnd(14)}  ${row.licensee}  (${row.plan}, ${row.seats} seat(s), ${row.licenseId})`);
}
