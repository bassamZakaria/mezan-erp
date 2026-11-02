/**
 * Historical purchase-document import (docs/archive/catalog/02 §"فواتير المشتريات" /
 * §"مرتجعات المشتريات" — "استيراد فواتير سابقة" / "استيراد مرتجعات سابقة"):
 * bulk go-live migration of ALREADY-SETTLED historical purchase invoices and
 * returns from an Excel/CSV upload (one row per item line, header fields
 * repeated per row — matches the downloadable template).
 *
 * Explicitly NOT the live purchase-invoice pipeline: a fully-paid historical
 * document is archived with NO journal entry at all; a document with a
 * remaining balance posts ONLY that remaining amount as a payable (Dr an
 * opening-balance/equity account, Cr accounts payable — never inventory,
 * which is deliberately untouched, since the goods were already physically in
 * the warehouse before go-live). Pure domain — ports only (docs/archive/plan.md §3.2).
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { InvalidPurchaseDocumentError } from "./errors.js";

export type HistoricalPurchaseDocType = "PURCHASE_INVOICE" | "PURCHASE_RETURN";

// --- Row input (one Excel/CSV row = one item line; header fields repeat) ---

export interface HistoricalImportRowInput {
  /** 1-based row number in the source file, for error reporting. */
  readonly rowNumber: number;
  readonly docType: HistoricalPurchaseDocType;
  /** The supplier's original document number — groups rows into one archived document. */
  readonly documentNumber: string;
  readonly supplierId: string;
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

export interface HistoricalImportRowError {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
}

// --- Archive (the persisted historical record) ------------------------------

export interface HistoricalPurchaseArchiveLine {
  readonly itemId: string | null;
  readonly description: string | null;
  readonly qty: Qty;
  readonly unitCost: Money;
}

export interface HistoricalPurchaseArchive {
  readonly id: string;
  readonly docType: HistoricalPurchaseDocType;
  readonly originalNumber: string;
  readonly supplierId: string;
  readonly date: string;
  readonly dueDate: string | null;
  readonly lines: readonly HistoricalPurchaseArchiveLine[];
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

export interface HistoricalPurchaseArchiveRepository {
  create(archive: HistoricalPurchaseArchive): Promise<void>;
  list(): Promise<HistoricalPurchaseArchive[]>;
  findById(id: string): Promise<HistoricalPurchaseArchive | null>;
  /** Idempotency check — one original document number is archived at most once per type. */
  findByOriginalNumber(
    docType: HistoricalPurchaseDocType,
    originalNumber: string,
  ): Promise<HistoricalPurchaseArchive | null>;
}

// --- GL posting hook (remaining-balance only; no import of the accounting module) ---

export interface HistoricalImportGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface HistoricalImportGlPosting {
  readonly sourceDocType: "HISTORICAL_PURCHASE_IMPORT";
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly HistoricalImportGlPostingLine[];
}

export interface HistoricalImportGlPostingPort {
  post(posting: HistoricalImportGlPosting): Promise<void>;
  assertPostable?(date: string): Promise<void>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Account mapping for a remaining-balance posting. `openingBalanceAccountId`
 * is the offsetting debit (an equity/opening-balance suspense account) — never
 * inventory. `payableAccountId` is the supplier's accounts-payable account.
 */
export interface HistoricalImportGlAccounts {
  readonly openingBalanceAccountId: string;
  readonly payableAccountId: string;
}

// --- Grouping + validation (pure — shared by dry-run and commit) ------------

/** One grouped, validated (or invalid) document derived from its rows. */
export interface HistoricalImportGroup {
  readonly documentNumber: string;
  readonly docType: HistoricalPurchaseDocType;
  readonly supplierId: string;
  readonly date: string;
  readonly dueDate: string | null;
  readonly lines: readonly HistoricalPurchaseArchiveLine[];
  readonly amountPaid: Money;
  readonly total: Money;
  readonly remainingBalance: Money;
  readonly settled: boolean;
  readonly firstRowNumber: number;
}

export interface HistoricalImportPreview {
  readonly groups: readonly HistoricalImportGroup[];
  readonly errors: readonly HistoricalImportRowError[];
}

function moneyMax(a: Money, b: Money): Money {
  return a.scaled >= b.scaled ? a : b;
}

/**
 * Group raw rows by (docType, documentNumber, supplierId), validate each row
 * and each resulting group, and compute totals. Pure — no I/O — used for BOTH
 * the dry-run preview and as phase 1 of a real commit. Row-level errors do not
 * abort the whole batch: a row with problems is excluded from its group (or
 * the whole group is dropped if the header fields disagree) and reported.
 */
export function previewHistoricalImport(
  rows: readonly HistoricalImportRowInput[],
): HistoricalImportPreview {
  const errors: HistoricalImportRowError[] = [];
  const byKey = new Map<string, HistoricalImportRowInput[]>();

  for (const row of rows) {
    const reasons: string[] = [];
    if (row.documentNumber.trim() === "") reasons.push("a document number is required");
    if (row.supplierId.trim() === "") reasons.push("a supplier is required");
    if (row.date.trim() === "") reasons.push("a date is required");
    if (row.qty.isZero() || row.qty.isNegative()) reasons.push("qty must be positive");
    if (row.unitCost.scaled < 0n) reasons.push("unit cost must not be negative");
    if (row.amountPaid.scaled < 0n) reasons.push("amount paid must not be negative");
    if (reasons.length > 0) {
      errors.push({ rowNumber: row.rowNumber, reasons });
      continue;
    }
    const key = `${row.docType}|${row.documentNumber}|${row.supplierId}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const firstRowsByNumber = new Map<string, number[]>();
  for (const bucket of byKey.values()) {
    const first = bucket[0]!;
    const numberKey = `${first.docType}|${first.documentNumber}`;
    firstRowsByNumber.set(numberKey, [...(firstRowsByNumber.get(numberKey) ?? []), first.rowNumber]);
  }
  for (const [key, bucket] of [...byKey]) {
    const first = bucket[0]!;
    const sharing = firstRowsByNumber.get(`${first.docType}|${first.documentNumber}`) ?? [];
    if (sharing.length < 2) continue;
    errors.push({
      rowNumber: first.rowNumber,
      reasons: [`رقم المستند "${first.documentNumber}" مكرر في الملف لأكثر من مورد (الصفوف ${sharing.join("، ")}). رقم المستند لا يتكرر داخل النوع الواحد.`],
    });
    byKey.delete(key);
  }

  const groups: HistoricalImportGroup[] = [];
  for (const bucket of byKey.values()) {
    const first = bucket[0] as HistoricalImportRowInput;
    const inconsistent = bucket.some((r) => r.date !== first.date || (r.dueDate ?? null) !== (first.dueDate ?? null));
    if (inconsistent) {
      errors.push({
        rowNumber: first.rowNumber,
        reasons: [`document "${first.documentNumber}": rows disagree on date/due date`],
      });
      continue;
    }
    const lines: HistoricalPurchaseArchiveLine[] = bucket.map((r) => ({
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
      supplierId: first.supplierId,
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

export interface ImportHistoricalPurchaseDocumentsCommand {
  readonly importBatchId: string;
  readonly rows: readonly HistoricalImportRowInput[];
  readonly createdBy?: string;
}

export interface ImportHistoricalPurchaseDocumentsDeps {
  readonly archives: HistoricalPurchaseArchiveRepository;
  /** Omit to skip GL posting entirely (e.g. a dry-run-only caller). */
  readonly gl?: HistoricalImportGlPostingPort;
  readonly accounts?: HistoricalImportGlAccounts;
  readonly now?: () => string;
}

export interface ImportHistoricalPurchaseDocumentsResult {
  readonly archived: readonly HistoricalPurchaseArchive[];
  readonly errors: readonly HistoricalImportRowError[];
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

/**
 * Commit a historical-import batch: validates + groups the rows (identical to
 * {@link previewHistoricalImport}), archives every valid document (skipping
 * ones already imported — idempotent re-runs), and posts a GL entry for JUST
 * the remaining balance of an unsettled document (Dr opening-balance / Cr
 * payable) — a fully-settled document gets NO journal entry, and stock is
 * NEVER touched by this path.
 */
export async function importHistoricalPurchaseDocuments(
  command: ImportHistoricalPurchaseDocumentsCommand,
  deps: ImportHistoricalPurchaseDocumentsDeps,
): Promise<ImportHistoricalPurchaseDocumentsResult> {
  const preview = previewHistoricalImport(command.rows);
  const errors = [...preview.errors];
  const archived: HistoricalPurchaseArchive[] = [];

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
      const archive: HistoricalPurchaseArchive = {
        id: `${command.importBatchId}:${archived.length}`,
        docType: group.docType,
        originalNumber: group.documentNumber,
        supplierId: group.supplierId,
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
      if (!archive.settled && deps.gl && deps.accounts) {
        const isReturn = archive.docType === "PURCHASE_RETURN";
        const lines: HistoricalImportGlPostingLine[] = isReturn
          ? [
              { accountId: deps.accounts.payableAccountId, debit: archive.remainingBalance, credit: Money.zero() },
              { accountId: deps.accounts.openingBalanceAccountId, debit: Money.zero(), credit: archive.remainingBalance },
            ]
          : [
              { accountId: deps.accounts.openingBalanceAccountId, debit: archive.remainingBalance, credit: Money.zero() },
              { accountId: deps.accounts.payableAccountId, debit: Money.zero(), credit: archive.remainingBalance },
            ];
        await deps.gl.post({
          sourceDocType: "HISTORICAL_PURCHASE_IMPORT",
          sourceDocId: archive.id,
          sourceDocNumber: archive.originalNumber,
          date: archive.date,
          memo: `استيراد ${isReturn ? "مرتجع" : "فاتورة"} مشتريات سابقة ${archive.originalNumber}`,
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

/** Row-shape guard used by API/CSV parsing layers before building {@link HistoricalImportRowInput}. */
export function assertHistoricalImportBatchNotEmpty(rows: readonly unknown[]): void {
  if (rows.length === 0) {
    throw new InvalidPurchaseDocumentError([{ ar: "ملف الاستيراد لا يحتوي على أي صفوف", en: "The import file contains no rows" }]);
  }
}
