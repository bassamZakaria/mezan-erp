/**
 * تسجيل الإقرارات الضريبية المقدَّمة — the record that a VAT period was filed.
 *
 * Nothing recorded that a return had gone to the authority, so a backdated
 * document silently restated a submitted one: July's output tax moved by 140.00
 * after the fact, with no amendment, no warning and no trace (D29). Fiscal-period
 * close is the only lock that existed, and nothing tied the two together —
 * reopening a period needs no reason and leaves no tax-side record.
 *
 * A filing is a claim about a window: "this is what we told the authority for
 * this period, and this is the figure we told them". Once filed, a posting
 * dated inside that window is refused unless the filing is explicitly amended,
 * which keeps the amendment a decision someone makes rather than a side effect
 * of entering a document.
 */

import { Money } from "../money/index.js";

export type VatFilingStatus = "filed" | "amended";

export interface VatFiling {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  /** The net payable/refundable actually submitted, kept so a later restatement is measurable. */
  readonly netAmount: Money;
  /** The authority's own acknowledgement reference, when there is one. */
  readonly referenceNo: string | null;
  readonly status: VatFilingStatus;
  readonly filedAt: string;
  readonly filedBy: string;
  readonly amendedAt: string | null;
  readonly amendmentReason: string | null;
}

export interface VatFilingRepository {
  findById(id: string): Promise<VatFiling | null>;
  list(): Promise<readonly VatFiling[]>;
  save(filing: VatFiling): Promise<void>;
  /** Every filing whose window contains `date` — normally one, never many. */
  findCovering(date: string): Promise<readonly VatFiling[]>;
}

export class VatPeriodAlreadyFiledError extends Error {
  readonly code = "VAT_PERIOD_ALREADY_FILED";
  constructor(readonly filingId: string, readonly date: string) {
    super(
      `لا يمكن الترحيل بتاريخ ${date}: إقرار ضريبة القيمة المضافة عن هذه الفترة (${filingId}) قد قُدّم بالفعل. ` +
        `عدّل الإقرار أولاً إن كان لا بد من التغيير.`,
    );
    this.name = "VatPeriodAlreadyFiledError";
  }
}

export class DuplicateVatFilingError extends Error {
  readonly code = "VAT_PERIOD_ALREADY_HAS_FILING";
  constructor(readonly filingId: string) {
    super(`هذه الفترة لديها إقرار مسجَّل بالفعل (${filingId}).`);
    this.name = "DuplicateVatFilingError";
  }
}

export class VatFilingNotFoundError extends Error {
  readonly code = "VAT_FILING_NOT_FOUND";
  constructor(readonly filingId: string) {
    super(`الإقرار الضريبي "${filingId}" غير موجود.`);
    this.name = "VatFilingNotFoundError";
  }
}

export interface RecordVatFilingCommand {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly netAmount: Money;
  readonly referenceNo?: string | null;
  readonly filedBy?: string;
  readonly filedAt?: string;
}

/** Record that a period's return has gone to the authority. */
export async function recordVatFiling(
  cmd: RecordVatFilingCommand,
  deps: { readonly filings: VatFilingRepository },
): Promise<VatFiling> {
  const overlapping = await deps.filings.findCovering(cmd.periodFrom);
  const live = overlapping.find((f) => f.status !== "amended");
  if (live) throw new DuplicateVatFilingError(live.id);

  const filing: VatFiling = {
    id: cmd.id,
    periodFrom: cmd.periodFrom,
    periodTo: cmd.periodTo,
    netAmount: cmd.netAmount,
    referenceNo: cmd.referenceNo ?? null,
    status: "filed",
    filedAt: cmd.filedAt ?? new Date().toISOString(),
    filedBy: cmd.filedBy ?? "system",
    amendedAt: null,
    amendmentReason: null,
  };
  await deps.filings.save(filing);
  return filing;
}

/**
 * Reopen a filed period for restatement. The reason is required: an amendment
 * that records no reason is exactly the silent restatement this exists to stop.
 */
export async function amendVatFiling(
  filingId: string,
  reason: string,
  deps: { readonly filings: VatFilingRepository; readonly now?: () => string },
): Promise<VatFiling> {
  const filing = await deps.filings.findById(filingId);
  if (!filing) throw new VatFilingNotFoundError(filingId);
  if (reason.trim() === "") {
    throw new Error("سبب تعديل الإقرار مطلوب.");
  }
  const amended: VatFiling = {
    ...filing,
    status: "amended",
    amendedAt: deps.now?.() ?? new Date().toISOString(),
    amendmentReason: reason,
  };
  await deps.filings.save(amended);
  return amended;
}
