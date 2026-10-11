/**
 * Historical sales-document import (docs/archive/catalog/01 §"فواتير المبيعات" /
 * §"مرتجعات المبيعات" — "استيراد فواتير سابقة" / "استيراد مرتجعات سابقة"):
 * bulk go-live migration of ALREADY-SETTLED historical sales invoices and
 * returns from an Excel/CSV upload (one row per item line, header fields
 * repeated per row — matches the downloadable template).
 *
 * Explicitly NOT the live sales-invoice pipeline: a fully-paid historical
 * document is archived with NO journal entry at all; a document with a
 * remaining balance posts ONLY that remaining amount as a receivable (Dr
 * accounts receivable, Cr an opening-balance/equity account — never
 * inventory, which is deliberately untouched, since the goods already left
 * the warehouse before go-live). Pure domain — ports only (docs/archive/plan.md §3.2).
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { InvalidSalesInvoiceError } from "./errors.js";

export type HistoricalSalesDocType = "SALES_INVOICE" | "SALES_RETURN";

// --- Row input (one Excel/CSV row = one item line; header fields repeat) ---

export interface HistoricalSalesImportRowInput {
  /** 1-based row number in the source file, for error reporting. */
  readonly rowNumber: number;
  readonly docType: HistoricalSalesDocType;
  /** The customer's original document number — groups rows into one archived document. */
  readonly documentNumber: string;
  readonly customerId: string;
  readonly date: string;
  readonly dueDate?: string | null;
  readonly itemId?: string | null;
  readonly description?: string | null;
  readonly qty: Qty;
  readonly unitCost: Money;
  /**
   * Total already paid/settled against the WHOLE document (not per line) —
   * the same value repeats on every row belonging to one `documentNumber`;
   * the first row seen for a document is authoritative.
   */
  readonly amountPaid: Money;
}

export interface HistoricalSalesImportRowError {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
}

// --- Archive (the persisted historical record) ------------------------------

export interface HistoricalSalesArchiveLine {
  readonly itemId: string | null;
  readonly description: string | null;
  readonly qty: Qty;
  readonly unitCost: Money;
}

export interface HistoricalSalesArchive {
  readonly id: string;
  readonly docType: HistoricalSalesDocType;
  readonly originalNumber: string;
  readonly customerId: string;
  readonly date: string;
  readonly dueDate: string | null;
  readonly lines: readonly HistoricalSalesArchiveLine[];
  /** Σ (qty × unitCost) across lines — the document's face value. */
  readonly total: Money;
  readonly amountPaid: Money;
  /** total − amountPaid, floored at 0. */
  readonly remainingBalance: Money;
  /** True when `remainingBalance` is 0 — archived with NO journal entry. */
  readonly settled: boolean;
  /** Groups every archive created by one import run. */
  readonly importBatchId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface HistoricalSalesArchiveRepository {
  create(archive: HistoricalSalesArchive): Promise<void>;
  list(): Promise<HistoricalSalesArchive[]>;
  findById(id: string): Promise<HistoricalSalesArchive | null>;
  /** Idempotency check — one original document number is archived at most once per type. */
  findByOriginalNumber(
    docType: HistoricalSalesDocType,
    originalNumber: string,
  ): Promise<HistoricalSalesArchive | null>;
}

// --- GL posting hook (remaining-balance only; no import of the accounting module) ---

export interface HistoricalSalesImportGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface HistoricalSalesImportGlPosting {
  readonly sourceDocType: "HISTORICAL_SALES_IMPORT";
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly HistoricalSalesImportGlPostingLine[];
}

export interface HistoricalSalesImportGlPostingPort {
  post(posting: HistoricalSalesImportGlPosting): Promise<void>;
  assertPostable?(date: string): Promise<void>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Account mapping for a remaining-balance posting. `openingBalanceAccountId`
 * is the offsetting entry (an equity/opening-balance suspense account) —
 * never inventory. `receivableAccountId` is the customer's accounts-receivable
 * account.
 */
export interface HistoricalSalesImportGlAccounts {
  readonly openingBalanceAccountId: string;
  readonly receivableAccountId: string;
}

// --- Grouping + validation (pure — shared by dry-run and commit) ------------

/** One grouped, validated (or invalid) document derived from its rows. */
export interface HistoricalSalesImportGroup {
  readonly documentNumber: string;
  readonly docType: HistoricalSalesDocType;
  readonly customerId: string;
  readonly date: string;
  readonly dueDate: string | null;
  readonly lines: readonly HistoricalSalesArchiveLine[];
  readonly amountPaid: Money;
  readonly total: Money;
  readonly remainingBalance: Money;
  readonly settled: boolean;
  readonly firstRowNumber: number;
}

export interface HistoricalSalesImportPreview {
  readonly groups: readonly HistoricalSalesImportGroup[];
  readonly errors: readonly HistoricalSalesImportRowError[];
}

function moneyMax(a: Money, b: Money): Money {
  return a.scaled >= b.scaled ? a : b;
}

/**
 * Group raw rows by (docType, documentNumber, customerId), validate each row
 * and each resulting group, and compute totals. Pure — no I/O — used for BOTH
 * the dry-run preview and as phase 1 of a real commit. Row-level errors do not
 * abort the whole batch: a row with problems is excluded from its group (or
 * the whole group is dropped if the header fields disagree) and reported.
 */
export function previewHistoricalSalesImport(
  rows: readonly HistoricalSalesImportRowInput[],
): HistoricalSalesImportPreview {
  const errors: HistoricalSalesImportRowError[] = [];
  const byKey = new Map<string, HistoricalSalesImportRowInput[]>();

  for (const row of rows) {
    const reasons: string[] = [];
    if (row.documentNumber.trim() === "") reasons.push("a document number is required");
    if (row.customerId.trim() === "") reasons.push("a customer is required");
    if (row.date.trim() === "") reasons.push("a date is required");
    if (row.qty.isZero() || row.qty.isNegative()) reasons.push("qty must be positive");
    if (row.unitCost.scaled < 0n) reasons.push("unit cost must not be negative");
    if (row.amountPaid.scaled < 0n) reasons.push("amount paid must not be negative");
    if (reasons.length > 0) {
      errors.push({ rowNumber: row.rowNumber, reasons });
      continue;
    }
    const key = `${row.docType}|${row.documentNumber}|${row.customerId}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const groups: HistoricalSalesImportGroup[] = [];
  for (const bucket of byKey.values()) {
    const first = bucket[0] as HistoricalSalesImportRowInput;
    const inconsistent = bucket.some((r) => r.date !== first.date || (r.dueDate ?? null) !== (first.dueDate ?? null));
    if (inconsistent) {
      errors.push({
        rowNumber: first.rowNumber,
        reasons: [`document "${first.documentNumber}": rows disagree on date/due date`],
      });
      continue;
    }
    const lines: HistoricalSalesArchiveLine[] = bucket.map((r) => ({
      itemId: r.itemId ?? null,
      description: r.description ?? null,
      qty: r.qty,
      unitCost: r.unitCost,
    }));
    const total = Money.sum(lines.map((l) => extend(l.qty, l.unitCost)));
    const amountPaid = first.amountPaid;
    const remainingBalance = moneyMax(total.add(amountPaid.negate()), Money.zero());
    groups.push({
      documentNumber: first.documentNumber,
      docType: first.docType,
      customerId: first.customerId,
      date: first.date,
      dueDate: first.dueDate ?? null,
      lines,
      amountPaid,
      total,
      remainingBalance,
      settled: remainingBalance.scaled === 0n,
      firstRowNumber: first.rowNumber,
    });
  }

  groups.sort((a, b) => a.firstRowNumber - b.firstRowNumber);
  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  return { groups, errors };
}

// --- Commit -------------------------------------------------------------

export interface ImportHistoricalSalesDocumentsCommand {
  readonly importBatchId: string;
  readonly rows: readonly HistoricalSalesImportRowInput[];
  readonly createdBy?: string;
}

export interface ImportHistoricalSalesDocumentsDeps {
  readonly archives: HistoricalSalesArchiveRepository;
  /** Omit to skip GL posting entirely (e.g. a dry-run-only caller). */
  readonly gl?: HistoricalSalesImportGlPostingPort;
  readonly accounts?: HistoricalSalesImportGlAccounts;
  readonly now?: () => string;
}

export interface ImportHistoricalSalesDocumentsResult {
  readonly archived: readonly HistoricalSalesArchive[];
  readonly errors: readonly HistoricalSalesImportRowError[];
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

/**
 * Commit a historical-import batch: validates + groups the rows (identical to
 * {@link previewHistoricalSalesImport}), archives every valid document
 * (skipping ones already imported — idempotent re-runs), and posts a GL entry
 * for JUST the remaining balance of an unsettled document (Dr receivable / Cr
 * opening-balance for a SALES_INVOICE, mirrored for a SALES_RETURN) — a
 * fully-settled document gets NO journal entry, and stock is NEVER touched by
 * this path.
 */
export async function importHistoricalSalesDocuments(
  command: ImportHistoricalSalesDocumentsCommand,
  deps: ImportHistoricalSalesDocumentsDeps,
): Promise<ImportHistoricalSalesDocumentsResult> {
  const preview = previewHistoricalSalesImport(command.rows);
  const errors = [...preview.errors];
  const archived: HistoricalSalesArchive[] = [];

  const pending: (typeof preview.groups[number])[] = [];
  for (const group of preview.groups) {
    const existing = await deps.archives.findByOriginalNumber(group.docType, group.documentNumber);
    if (existing) {
      errors.push({
        rowNumber: group.firstRowNumber,
        reasons: [`document "${group.documentNumber}" (${group.docType}) was already imported`],
      });
      continue;
    }
    pending.push(group);
  }

  const posts = Boolean(deps.gl && deps.accounts);
  for (const group of pending) {
    if (posts && !group.settled) await deps.gl?.assertPostable?.(group.date);
  }

  const writeAll = async (): Promise<void> => {
    for (const group of pending) {
      const archive: HistoricalSalesArchive = {
        id: `${command.importBatchId}:${archived.length}`,
        docType: group.docType,
        originalNumber: group.documentNumber,
        customerId: group.customerId,
        date: group.date,
        dueDate: group.dueDate,
        lines: group.lines,
        total: group.total,
        amountPaid: group.amountPaid,
        remainingBalance: group.remainingBalance,
        settled: group.settled,
        importBatchId: command.importBatchId,
        createdBy: command.createdBy ?? "system",
        createdAt: nowIso(deps),
      };
      // The entry first: if the ledger refuses it — a closed month — nothing is
      // archived, or the sub-ledger would owe a balance no entry carries.
      if (!archive.settled && deps.gl && deps.accounts) {
        const isReturn = archive.docType === "SALES_RETURN";
        const lines: HistoricalSalesImportGlPostingLine[] = isReturn
          ? [
              { accountId: deps.accounts.openingBalanceAccountId, debit: archive.remainingBalance, credit: Money.zero() },
              { accountId: deps.accounts.receivableAccountId, debit: Money.zero(), credit: archive.remainingBalance },
            ]
          : [
              { accountId: deps.accounts.receivableAccountId, debit: archive.remainingBalance, credit: Money.zero() },
              { accountId: deps.accounts.openingBalanceAccountId, debit: Money.zero(), credit: archive.remainingBalance },
            ];
        await deps.gl.post({
          sourceDocType: "HISTORICAL_SALES_IMPORT",
          sourceDocId: archive.id,
          sourceDocNumber: archive.originalNumber,
          date: archive.date,
          memo: `استيراد ${isReturn ? "مرتجع" : "فاتورة"} مبيعات سابقة ${archive.originalNumber}`,
          lines,
        });
      }
      await deps.archives.create(archive);
      archived.push(archive);
    }
  };
  await (deps.gl?.transaction ? deps.gl.transaction(writeAll) : writeAll());

  return { archived, errors };
}

/** Row-shape guard used by API/CSV parsing layers before building {@link HistoricalSalesImportRowInput}. */
export function assertHistoricalSalesImportBatchNotEmpty(rows: readonly unknown[]): void {
  if (rows.length === 0) {
    throw new InvalidSalesInvoiceError(["ملف الاستيراد لا يحتوي على أي صفوف"]);
  }
}
