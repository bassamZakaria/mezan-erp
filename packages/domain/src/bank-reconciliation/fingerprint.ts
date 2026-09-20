import type { Money } from "../money/index.js";
import type { BankStatementSource } from "./bank-statement.js";

export interface FingerprintRow {
  readonly date: string;
  readonly description: string;
  readonly reference: string | null;
  readonly amount: Money;
}

export interface FingerprintInput {
  readonly treasuryAccountId: string;
  readonly source: BankStatementSource;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly statementNumber: string | null;
  readonly rows: readonly FingerprintRow[];
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash ^ BigInt(text.charCodeAt(i))) * FNV_PRIME & MASK64;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * A deterministic digest of one import. Built from the fields that identify
 * the statement (account, period, balances, its own number) plus every row, so
 * the same file imported twice produces the same value and a genuinely
 * different period never collides with it.
 */
export function statementFingerprint(input: FingerprintInput): string {
  const rows = input.rows
    .map((row) => [row.date, row.amount.toString(), normalize(row.reference ?? ""), normalize(row.description)].join(""))
    .join("");
  const head = [
    input.treasuryAccountId,
    input.source,
    input.periodStart,
    input.periodEnd,
    input.openingBalance.toString(),
    input.closingBalance.toString(),
    normalize(input.statementNumber ?? ""),
    String(input.rows.length),
  ].join("|");
  return `${head}|${fnv1a64(rows)}`;
}
