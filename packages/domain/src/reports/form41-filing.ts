/**
 * نموذج 41 — إقرار الخصم والتحصيل. The quarterly withholding-tax return, and
 * the record that a quarter of it has gone to the authority.
 *
 * The mechanics of withholding already existed and were correct: GL 2210,
 * the voucher's `withholdingAmount` / `withholdingRatePercent` /
 * `withholdingGlAccountId`, and the `tax.withholding` report that lists every
 * payment that withheld. What was missing was the filing — the object that
 * says "this quarter has been declared, and this is the figure we declared".
 *
 * Without it a voucher dated into a already-declared quarter silently
 * restates a submitted return, which is defect D29 on the VAT side, filed
 * again. The shape below is deliberately `tax/vat-filing.ts`'s: a period, a
 * filing record, the remitted figure, the authority's reference, and a
 * refusal to post into a filed quarter unless the filing is explicitly
 * amended.
 */

import { Money } from "../money/index.js";

export type Form41FilingStatus = "filed" | "amended";

/** أرباع السنة الضريبية — the four statutory quarters, 1-based. */
export type WithholdingQuarter = 1 | 2 | 3 | 4;

export interface Form41Quarter {
  readonly year: number;
  readonly quarter: WithholdingQuarter;
  /** Inclusive, YYYY-MM-DD. */
  readonly periodFrom: string;
  readonly periodTo: string;
  /**
   * آخر موعد للتوريد — the last day of the month following the quarter's end.
   * Q1 ends 31 March and is due 30 April, and so on.
   */
  readonly dueDate: string;
}

const QUARTER_BOUNDS: Record<WithholdingQuarter, { from: string; to: string; due: string }> = {
  1: { from: "01-01", to: "03-31", due: "04-30" },
  2: { from: "04-01", to: "06-30", due: "07-31" },
  3: { from: "07-01", to: "09-30", due: "10-31" },
  4: { from: "10-01", to: "12-31", due: "01-31" },
};

export function withholdingQuarter(year: number, quarter: WithholdingQuarter): Form41Quarter {
  const bounds = QUARTER_BOUNDS[quarter];
  // Q4 is declared in JANUARY of the following year — the one boundary a
  // year-agnostic due date would get wrong.
  const dueYear = quarter === 4 ? year + 1 : year;
  return {
    year,
    quarter,
    periodFrom: `${year}-${bounds.from}`,
    periodTo: `${year}-${bounds.to}`,
    dueDate: `${dueYear}-${bounds.due}`,
  };
}

/** Which statutory quarter a date falls in. */
export function withholdingQuarterOf(date: string): Form41Quarter {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const quarter = (Math.floor((month - 1) / 3) + 1) as WithholdingQuarter;
  return withholdingQuarter(year, quarter);
}

export interface Form41Filing {
  readonly id: string;
  readonly year: number;
  readonly quarter: WithholdingQuarter;
  readonly periodFrom: string;
  readonly periodTo: string;
  /** المبلغ المورَّد — what was actually declared and remitted, kept so a later restatement is measurable. */
  readonly remittedAmount: Money;
  /** The authority's acknowledgement reference, when there is one. */
  readonly referenceNo: string | null;
  readonly status: Form41FilingStatus;
  readonly filedAt: string;
  readonly filedBy: string;
  readonly amendedAt: string | null;
  readonly amendmentReason: string | null;
}

export interface Form41FilingRepository {
  findById(id: string): Promise<Form41Filing | null>;
  list(): Promise<readonly Form41Filing[]>;
  save(filing: Form41Filing): Promise<void>;
  /** Every filing whose quarter contains `date` — normally one, never many. */
  findCovering(date: string): Promise<readonly Form41Filing[]>;
}

export class Form41PeriodAlreadyFiledError extends Error {
  readonly code = "WITHHOLDING_PERIOD_ALREADY_FILED";
  constructor(readonly filingId: string, readonly date: string) {
    super(
      `لا يمكن الترحيل بتاريخ ${date}: إقرار الخصم والتحصيل (نموذج 41) عن هذا الربع (${filingId}) قد قُدّم بالفعل. ` +
        `عدّل الإقرار أولاً إن كان لا بد من التغيير.`,
    );
    this.name = "Form41PeriodAlreadyFiledError";
  }
}

export class DuplicateForm41FilingError extends Error {
  readonly code = "WITHHOLDING_PERIOD_ALREADY_HAS_FILING";
  constructor(readonly filingId: string) {
    super(`هذا الربع لديه إقرار خصم وتحصيل مسجَّل بالفعل (${filingId}).`);
    this.name = "DuplicateForm41FilingError";
  }
}

export class Form41FilingNotFoundError extends Error {
  readonly code = "WITHHOLDING_FILING_NOT_FOUND";
  constructor(readonly filingId: string) {
    super(`إقرار الخصم والتحصيل "${filingId}" غير موجود.`);
    this.name = "Form41FilingNotFoundError";
  }
}

export interface RecordForm41FilingCommand {
  readonly id: string;
  readonly year: number;
  readonly quarter: WithholdingQuarter;
  readonly remittedAmount: Money;
  readonly referenceNo?: string | null;
  readonly filedBy?: string;
  readonly filedAt?: string;
}

/** Record that a quarter's Form 41 has gone to the authority. */
export async function recordForm41Filing(
  cmd: RecordForm41FilingCommand,
  deps: { readonly filings: Form41FilingRepository },
): Promise<Form41Filing> {
  const period = withholdingQuarter(cmd.year, cmd.quarter);
  const overlapping = await deps.filings.findCovering(period.periodFrom);
  const live = overlapping.find((f) => f.status !== "amended");
  if (live) throw new DuplicateForm41FilingError(live.id);

  const filing: Form41Filing = {
    id: cmd.id,
    year: cmd.year,
    quarter: cmd.quarter,
    periodFrom: period.periodFrom,
    periodTo: period.periodTo,
    remittedAmount: cmd.remittedAmount,
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
 * Reopen a filed quarter for restatement. The reason is required: an
 * amendment that records no reason is exactly the silent restatement this
 * exists to stop.
 */
export async function amendForm41Filing(
  filingId: string,
  reason: string,
  deps: { readonly filings: Form41FilingRepository; readonly now?: () => string },
): Promise<Form41Filing> {
  const filing = await deps.filings.findById(filingId);
  if (!filing) throw new Form41FilingNotFoundError(filingId);
  if (reason.trim() === "") {
    throw new Error("سبب تعديل إقرار الخصم والتحصيل مطلوب.");
  }
  const amended: Form41Filing = {
    ...filing,
    status: "amended",
    amendedAt: deps.now?.() ?? new Date().toISOString(),
    amendmentReason: reason,
  };
  await deps.filings.save(amended);
  return amended;
}

/**
 * Refuse a posting dated inside a quarter whose Form 41 has been filed.
 *
 * Structurally identical to the LIVE VAT control, `assertVatNotFiled` in
 * `gl/post.ts`: a structural repository parameter rather than the concrete
 * type, and an absent repository means the control is simply not configured
 * for this tenant. Keeping the two the same shape is what lets the posting
 * path take both gates the same way.
 */
export async function assertWithholdingNotFiled(
  date: string,
  filings: { findCovering(date: string): Promise<readonly { id: string; status: string }[]> } | undefined,
): Promise<void> {
  if (!filings) return;
  const live = (await filings.findCovering(date)).find((f) => f.status === "filed");
  if (live) throw new Form41PeriodAlreadyFiledError(live.id, date);
}
