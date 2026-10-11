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
import type { SimplifiedRegimeElection } from "./simplified-regime-election.js";
import { simplifiedRegimeActiveOn } from "./simplified-regime-election.js";
import type { SimplifiedRegimeSchedule, VatPeriodMode } from "./simplified-regime-schedule.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

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
  insert(filing: VatFiling): Promise<void>;
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

// --- المدة الضريبية: شهرية أم ربع سنوية -----------------------------------
//
// A filing is a claim about a WINDOW, and until now the window was the only
// thing recorded — nothing said whether the tenant files monthly or quarterly.
// Under the simplified regime the return becomes quarterly, and a tenant who
// keeps filing monthly windows is filing the wrong return.
//
// The mode is DERIVED from the window rather than stored beside it. A stored
// copy would be a second fact that can disagree with the first, and the store
// does not carry the column: a field the repository drops on the way back is
// exactly how a dimension vanishes behind a cheerful 201.

export interface VatPeriodWindow {
  readonly periodFrom: string;
  readonly periodTo: string;
  /** When the return falls due, per the schedule's own rule. */
  readonly dueDate: string;
}

export class VatPeriodModeMismatchError extends Error {
  readonly code = "VAT_PERIOD_MODE_MISMATCH";
  constructor(readonly expected: VatPeriodMode, readonly actual: VatPeriodMode) {
    super(
      expected === "quarterly"
        ? "النظام الضريبي المبسط يقتضي إقراراً ربع سنوي لضريبة القيمة المضافة؛ الفترة المُقدَّمة ليست ربع سنة."
        : "الفترة المُقدَّمة لا تطابق المدة الضريبية المسجَّلة لهذه المنشأة.",
    );
    this.name = "VatPeriodModeMismatchError";
  }
}

function monthsSpanned(periodFrom: string, periodTo: string): number {
  const [fy, fm] = periodFrom.split("-").map((part) => Number(part));
  const [ty, tm] = periodTo.split("-").map((part) => Number(part));
  return ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0)) + 1;
}

function lastDayOfMonth(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

/** The mode a recorded window IS, read off the window itself. */
export function vatPeriodModeOfWindow(window: { readonly periodFrom: string; readonly periodTo: string }): VatPeriodMode {
  return monthsSpanned(window.periodFrom, window.periodTo) >= 3 ? "quarterly" : "monthly";
}

/**
 * The mode this tenant should be filing on for a period ending `day`:
 * quarterly while the simplified regime is on the books, monthly otherwise.
 */
export function vatPeriodModeFor(
  election: SimplifiedRegimeElection | null,
  schedule: SimplifiedRegimeSchedule | null,
  day: string,
): VatPeriodMode {
  if (election === null || schedule === null) return "monthly";
  return simplifiedRegimeActiveOn(election, day) ? schedule.vatFiling.value.mode : "monthly";
}

/**
 * The due date for a window closing on `periodTo`.
 *
 * The QUARTERLY rule is the statutory one Mezan carries a source for: one
 * month after the quarter ends. Mezan does not model the monthly due date
 * under the ordinary VAT law, so this returns null for a monthly window rather
 * than inventing a deadline a taxpayer might act on.
 */
export function vatFilingDueDate(periodTo: string, mode: VatPeriodMode, schedule: SimplifiedRegimeSchedule | null): string | null {
  if (mode !== "quarterly" || schedule === null) return null;
  const [y, m, d] = periodTo.split("-").map((part) => Number(part));
  const year = y ?? 1970;
  const monthIndex = (m ?? 1) - 1 + schedule.vatFiling.value.dueWithinMonths;
  const target = new Date(Date.UTC(year, monthIndex, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d ?? 1, last))).toISOString().slice(0, 10);
}

/** Every filing window of `year` under `mode`, with the due date each carries. */
export function vatPeriodWindows(
  year: number,
  mode: VatPeriodMode,
  schedule: SimplifiedRegimeSchedule | null,
): readonly VatPeriodWindow[] {
  const step = mode === "quarterly" ? 3 : 1;
  const windows: VatPeriodWindow[] = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += step) {
    const periodFrom = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
    const periodTo = lastDayOfMonth(year, monthIndex + step - 1);
    windows.push({ periodFrom, periodTo, dueDate: vatFilingDueDate(periodTo, mode, schedule) ?? periodTo });
  }
  return windows;
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
  deps: {
    readonly filings: VatFilingRepository;
    /**
     * The mode this tenant is required to file on. Supplied, a window of the
     * wrong length is refused; omitted, the check is not made at all — an
     * ordinary tenant has no regime record and nothing to compare against.
     */
    readonly expectedPeriodMode?: VatPeriodMode;
  },
): Promise<VatFiling> {
  assertRecordIdIsNew(await deps.filings.findById(cmd.id), cmd.id);
  if (deps.expectedPeriodMode !== undefined) {
    const actual = vatPeriodModeOfWindow(cmd);
    if (actual !== deps.expectedPeriodMode) throw new VatPeriodModeMismatchError(deps.expectedPeriodMode, actual);
  }
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
  await deps.filings.insert(filing);
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
