import type { App } from "@mezan/api";
import { ACCOUNTS, call, step } from "./shared.js";

/**
 * الإقفال الموجَّه — the demo has to show a guided close that WORKS, and one
 * that refuses for a real reason.
 *
 *   - يناير–مايو ٢٠٢٦ are closed by OVERRIDE: their recurring entry is still a
 *     draft, no payroll run exists and no statement was ever reconciled. The
 *     override reason is stated, and each close carries it in its audit row.
 *   - يونيو ويوليو close CLEAN, with no override: every blocker is cleared
 *     first through the screen an accountant would use for it.
 *   - أغسطس is left open with its real blockers.
 *
 * Runs LAST: every step here posts into a month that must still be open, and
 * the closes shut those months to everything seeded before them.
 */

const BANK_TREASURY_ID = "TR-DEMO-BANK";
const RECURRING_TEMPLATE_ID = "RJT-DEMO-1";
const OVERRIDE_REASON = "إقفال بتجاوز: القيد المتكرر ما زال مسودة ولم تُسوَّ كشوف البنك ولا مسير رواتب للشهر — بموافقة المدير المالي.";
const OVERRIDDEN_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"] as const;
const CLEAN_MONTHS = ["2026-06", "2026-07"] as const;
const DRAFT_RUN = { period: "2026-09", branchId: "BR-MAIN" } as const;
const SCALE = 1_000_000n;

interface LedgerLineRow {
  readonly entryId: string;
  readonly date: string;
  readonly debit: string;
  readonly credit: string;
}

interface StatementLineRow {
  readonly id: string;
  readonly reference: string | null;
}

function scaled(decimal: string): bigint {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace("-", "").split(".");
  const value = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  return negative ? -value : value;
}

function decimal(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / SCALE}.${(abs % SCALE).toString().padStart(6, "0")}`;
}

function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
}

function periodIdOf(month: string): string {
  return `fp-${month}`;
}

async function postDepreciation(app: App, period: string): Promise<void> {
  const run = (await step(app, "POST", "/assets/depreciation/runs", { period })) as { id: string };
  await step(app, "POST", `/assets/depreciation/runs/${run.id}/post`, {});
}

async function postRecurringEntry(app: App, month: string): Promise<void> {
  const runs = (await step(app, "GET", "/gl/recurring/runs")) as readonly { templateId: string; period: string; journalEntryId: string | null }[];
  const run = runs.find((r) => r.templateId === RECURRING_TEMPLATE_ID && r.period === month);
  if (!run?.journalEntryId) throw new Error(`[demo-seed] no recurring entry was generated for ${RECURRING_TEMPLATE_ID} in ${month}`);
  await step(app, "POST", `/gl/journal-entries/${encodeURIComponent(run.journalEntryId)}/post`, {});
}

/**
 * The month's statement, DERIVED from the bank GL account's own posted
 * movements and matched line for line to the entry each came from — so it is
 * finalized the ordinary way, with nothing unmatched and no difference.
 */
async function reconcileBankStatement(app: App, month: string): Promise<void> {
  const periodStart = `${month}-01`;
  const periodEnd = lastDayOf(month);
  const ledger = (await step(app, "GET", `/gl/accounts/${ACCOUNTS.bank}/ledger?asOf=${periodEnd}`)) as { lines: LedgerLineRow[] };
  const net = (line: LedgerLineRow): bigint => scaled(line.debit) - scaled(line.credit);
  const opening = ledger.lines.filter((line) => line.date < periodStart).reduce((sum, line) => sum + net(line), 0n);

  const movements = new Map<string, { date: string; amount: bigint }>();
  for (const line of ledger.lines) {
    if (line.date < periodStart || line.date > periodEnd) continue;
    const seen = movements.get(line.entryId);
    movements.set(line.entryId, { date: line.date, amount: (seen?.amount ?? 0n) + net(line) });
  }
  const rows = [...movements.entries()]
    .filter(([, movement]) => movement.amount !== 0n)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date) || (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0))
    .map(([entryId, movement], index) => ({ entryId, ...movement, reference: `BS${month.replace("-", "")}${String(index + 1).padStart(4, "0")}` }));
  if (rows.length === 0) throw new Error(`[demo-seed] GL ${ACCOUNTS.bank} did not move in ${month}; there is no statement to reconcile.`);

  const closing = rows.reduce((sum, row) => sum + row.amount, opening);
  const header = "التاريخ,البيان,مدين,دائن,المرجع";
  const csv = rows.map((row) =>
    [row.date, row.amount > 0n ? "إيداع" : "تحويل صادر", row.amount < 0n ? decimal(-row.amount) : "", row.amount > 0n ? decimal(row.amount) : "", row.reference].join(","),
  );
  const statementId = `BSTMT-DEMO-${month}`;
  await step(app, "POST", "/bank-statements/import", {
    id: statementId,
    treasuryAccountId: BANK_TREASURY_ID,
    statementNumber: `BS-${month}`,
    rawCsv: [header, ...csv].join("\n"),
    mapping: { dateColumn: "التاريخ", descriptionColumn: "البيان", debitColumn: "مدين", creditColumn: "دائن", referenceColumn: "المرجع", dateFormat: "YYYY-MM-DD" },
    periodStart,
    periodEnd,
    openingBalance: decimal(opening),
    closingBalance: decimal(closing),
  });

  const statement = (await step(app, "GET", `/bank-statements/${statementId}`)) as { lines: StatementLineRow[] };
  const entryByReference = new Map(rows.map((row) => [row.reference, row.entryId]));
  for (const line of statement.lines) {
    const entryId = line.reference ? entryByReference.get(line.reference) : undefined;
    if (!entryId) throw new Error(`[demo-seed] statement ${statementId} line ${line.id} carries no reference the seed wrote.`);
    await step(app, "POST", `/bank-statements/${statementId}/lines/${encodeURIComponent(line.id)}/match`, { entryId });
  }
  const finalized = (await step(app, "POST", `/bank-statements/${statementId}/finalize`, {})) as { status: string; finalizeOverrideReason: string | null };
  if (finalized.finalizeOverrideReason !== null) throw new Error(`[demo-seed] statement ${statementId} was finalized by force.`);
}

async function close(app: App, month: string, body: { overrideReason?: string }): Promise<void> {
  const res = await call(app, "POST", `/fiscal-periods/${periodIdOf(month)}/close`, body);
  if (!res.ok) throw new Error(`[demo-seed] ${month} did not close${body.overrideReason ? "" : " clean"}: ${res.status} ${await res.text()}`);
}

export async function seedGuidedClose(app: App): Promise<void> {
  for (const month of CLEAN_MONTHS) await postDepreciation(app, month);
  // A draft the «ترحيل» action has something to act on (D54), in a month that is still open.
  await step(app, "POST", "/assets/depreciation/runs", DRAFT_RUN);

  for (const month of CLEAN_MONTHS) {
    await postRecurringEntry(app, month);
    await reconcileBankStatement(app, month);
  }

  for (const month of OVERRIDDEN_MONTHS) await close(app, month, { overrideReason: OVERRIDE_REASON });
  for (const month of CLEAN_MONTHS) await close(app, month, {});
}
