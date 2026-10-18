// The vendor's register of every licence issued: who, which machines, what it
// carries, when it ends, and the sha256 of the exact file handed over. It is
// what renewals are chased from. It NEVER holds the signing key.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const LEDGER_COLUMNS = [
  "issuedAt",
  "licenseId",
  "licensee",
  "plan",
  "modules",
  "seats",
  "notBefore",
  "expiresAt",
  "graceDays",
  "fingerprints",
  "file",
  "fileSha256",
];

const LIST_SEPARATOR = ";";

function escapeCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

export function ledgerPathFrom(args, env) {
  const value = args.ledger ?? env.MEZAN_LICENCE_LEDGER;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function appendLedgerRow(ledgerPath, row) {
  const header = existsSync(ledgerPath) ? "" : `${LEDGER_COLUMNS.join(",")}\n`;
  const line = LEDGER_COLUMNS.map((column) => {
    const value = row[column];
    return escapeCell(Array.isArray(value) ? value.join(LIST_SEPARATOR) : value);
  }).join(",");
  appendFileSync(ledgerPath, `${header}${line}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readLedger(ledgerPath) {
  const lines = readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  const [head, ...body] = lines;
  if (!head) return [];
  const columns = parseLine(head);
  return body.map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? ""]));
  });
}

/**
 * The licences whose newest issue ends within `days` of `now` (or has already
 * ended): a licensee renewed for the same machines is judged by the renewal,
 * not by the file it replaced.
 */
export function licencesDue(rows, days, now) {
  const newest = new Map();
  for (const row of rows) {
    const key = `${row.licensee}\u0000${row.fingerprints}`;
    const held = newest.get(key);
    if (!held || Date.parse(row.expiresAt) > Date.parse(held.expiresAt)) newest.set(key, row);
  }
  const horizon = now.getTime() + days * 86_400_000;
  return [...newest.values()]
    .filter((row) => Date.parse(row.expiresAt) <= horizon)
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .map((row) => ({ ...row, daysLeft: Math.floor((Date.parse(row.expiresAt) - now.getTime()) / 86_400_000) }));
}
