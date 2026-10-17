import { expect, type Page } from "@playwright/test";

/**
 * The books beside the screen. A status pill reading «مؤكد», «مدفوع» or
 * «معتمد» says what the document claims; these helpers read what the general
 * ledger actually recorded, through the same API and the same session the
 * screen under test is using.
 */

export enum JournalEntryStatus {
  Draft = "draft",
  Posted = "posted",
}

export interface LedgerLine {
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly partyId: string | null;
}

export interface LedgerEntry {
  readonly id: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly status: string;
  readonly sourceDocType: string | null;
  readonly sourceDocId: string | null;
  readonly sourceDocNumber: string | null;
  readonly reversesEntryId: string | null;
  readonly reversedByEntryId: string | null;
  readonly lines: readonly LedgerLine[];
}

const MONEY_SCALE_DIGITS = 6;

/** Money stays an integer of micro-units end to end; the wire string is never parsed as a float. */
export function microUnits(amount: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim().replace(/,/g, ""));
  if (!match) throw new Error(`not a money amount: "${amount}"`);
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > MONEY_SCALE_DIGITS) throw new Error(`more than ${MONEY_SCALE_DIGITS} decimals: "${amount}"`);
  const scaled = BigInt(`${whole}${fraction.padEnd(MONEY_SCALE_DIGITS, "0")}`);
  return sign === "-" ? -scaled : scaled;
}

async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  const stored = await page.evaluate(() => ({
    session: window.localStorage.getItem("mezan.session"),
    tenantCode: window.localStorage.getItem("mezan.tenantCode"),
  }));
  if (!stored.session) throw new Error("no signed-in session on this page — log in before reading the ledger");
  const { token } = JSON.parse(stored.session) as { token: string };
  return {
    authorization: `Bearer ${token}`,
    "x-branch-scope": "*",
    "x-warehouse-scope": "*",
    ...(stored.tenantCode ? { "x-mezan-tenant": stored.tenantCode } : {}),
  };
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api${path}`, { headers: await sessionHeaders(page) });
  expect(response.status(), `GET /api${path}`).toBe(200);
  return (await response.json()) as T;
}

export async function journalEntry(page: Page, id: string): Promise<LedgerEntry> {
  return apiGet<LedgerEntry>(page, `/gl/journal-entries/${encodeURIComponent(id)}`);
}

/** Every entry the ledger holds for one document number, oldest first. */
export async function journalEntriesForDocument(page: Page, docNo: string): Promise<LedgerEntry[]> {
  const found = await apiGet<LedgerEntry[]>(page, `/gl/journal-entries?pageSize=100&search=${encodeURIComponent(docNo)}`);
  return found
    .filter((entry) => entry.sourceDocNumber === docNo)
    .sort((a, b) => (a.entryNo ?? "").localeCompare(b.entryNo ?? ""));
}

export function debitOn(entry: LedgerEntry, accountId: string): bigint {
  return entry.lines.filter((l) => l.accountId === accountId).reduce((sum, l) => sum + microUnits(l.debit), 0n);
}

export function creditOn(entry: LedgerEntry, accountId: string): bigint {
  return entry.lines.filter((l) => l.accountId === accountId).reduce((sum, l) => sum + microUnits(l.credit), 0n);
}

export function totalDebit(entry: LedgerEntry): bigint {
  return entry.lines.reduce((sum, l) => sum + microUnits(l.debit), 0n);
}

export function totalCredit(entry: LedgerEntry): bigint {
  return entry.lines.reduce((sum, l) => sum + microUnits(l.credit), 0n);
}

/** Posted and balanced to the micro-unit; returns what each side adds up to. */
export function expectPostedAndBalanced(entry: LedgerEntry): bigint {
  const label = entry.entryNo ?? entry.id;
  expect(entry.status, `${label} status`).toBe(JournalEntryStatus.Posted);
  expect(totalDebit(entry), `${label} must move money`).toBeGreaterThan(0n);
  expect(totalCredit(entry), `${label} credit side against its debit side`).toBe(totalDebit(entry));
  return totalDebit(entry);
}

/** Posted, balanced to the micro-unit, and worth exactly `amount`. */
export function expectPostedEntryOf(entry: LedgerEntry, amount: string): void {
  const label = entry.entryNo ?? entry.id;
  expect(entry.status, `${label} status`).toBe(JournalEntryStatus.Posted);
  expect(totalDebit(entry), `${label} debit side`).toBe(microUnits(amount));
  expect(totalCredit(entry), `${label} credit side`).toBe(microUnits(amount));
}
