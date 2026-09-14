import { Money, Qty } from "../../money/index.js";

/**
 * تقارير الاستثناءات السبعة — the rules, and nothing else (design §06).
 *
 * The product ships 33 reports and not one of them is an exception report; for
 * a contracting customer that is the missing half of the control environment.
 * Each rule below is a PURE function over rows the service assembled from
 * posted documents, so "does it fire" is answerable without a database — and
 * an empty result is a real, honest answer, never a missing feature.
 */

export type ContractingExceptionKey =
  | "boq-overrun"
  | "unreceived-issues"
  | "consumption-variance"
  | "equipment-without-certificate"
  | "late-variation-approvals"
  | "early-retention-release"
  | "cost-overrun-vs-estimate";

export const CONTRACTING_EXCEPTION_KEYS: readonly ContractingExceptionKey[] = [
  "boq-overrun",
  "unreceived-issues",
  "consumption-variance",
  "equipment-without-certificate",
  "late-variation-approvals",
  "early-retention-release",
  "cost-overrun-vs-estimate",
];

export interface ContractingExceptionDefinition {
  readonly key: ContractingExceptionKey;
  readonly labelAr: string;
  readonly labelEn: string;
  /** The sentence the screen prints under the table, so a reader knows what an empty table means. */
  readonly ruleAr: string;
}

export const CONTRACTING_EXCEPTION_DEFINITIONS: readonly ContractingExceptionDefinition[] = [
  {
    key: "boq-overrun",
    labelAr: "تجاوز الكميات التعاقدية",
    labelEn: "Certified beyond the contracted quantity",
    ruleAr:
      "يظهر البند هنا إذا تجاوزت الكمية التراكمية المعتمدة الكمية التعاقدية المحسوبة بتاريخ التنفيذ — أي بعد ضم أوامر التغيير المعتمدة حتى ذلك التاريخ فقط.",
  },
  {
    key: "unreceived-issues",
    labelAr: "مواد مصروفة لم تُستلم بالموقع",
    labelEn: "Material issued and never received on site",
    ruleAr:
      "يظهر السطر هنا إذا مضى على إذن الصرف أكثر من المدة المحددة ولم يوقّع الموقع باستلام الكمية كاملة — الفرق قائم في مستودع الطريق.",
  },
  {
    key: "consumption-variance",
    labelAr: "انحراف الاستهلاك عن الكميات النظرية",
    labelEn: "Consumption variance against the theoretical quantity",
    ruleAr:
      "يظهر البند هنا إذا خالف الاستهلاك الفعلي الكمية النظرية (الكمية المعتمدة تراكميًا × الكمية النظرية لكل وحدة) بنسبة تتجاوز الحد المحدد.",
  },
  {
    key: "equipment-without-certificate",
    labelAr: "ساعات معدات بلا مستخلص مقابل",
    labelEn: "Plant hours with no certified work behind them",
    ruleAr:
      "يظهر السطر هنا إذا لم تتحرك الكمية المعتمدة تراكميًا لبند جدول الكميات منذ تاريخ تسجيل الساعات، أو إذا سُجّلت الساعات بلا بند على عقد سارٍ ومضى عليها أكثر من المدة المحددة.",
  },
  {
    key: "late-variation-approvals",
    labelAr: "أوامر تغيير معتمدة بعد التنفيذ",
    labelEn: "Variation orders approved after the work was executed",
    ruleAr:
      "يظهر السطر هنا إذا اعتُمد أمر التغيير بعد تاريخ تنفيذ مستخلص استهلك الكمية التي أضافها — وهو ما يرفضه النظام في المستخلصات الجديدة، فالتقرير يكشف البيانات المرحّلة أو المستوردة.",
  },
  {
    key: "early-retention-release",
    labelAr: "ضمان محتجز مفرج عنه قبل الميعاد",
    labelEn: "Retention released before its release event",
    ruleAr:
      "يظهر المستند هنا إذا كان تاريخ الإفراج يسبق ميعاد الاستحقاق — التسليم الابتدائي للشريحة الأولى، والتسليم النهائي مضافًا إليه فترة الضمان للشريحة الأخيرة.",
  },
  {
    key: "cost-overrun-vs-estimate",
    labelAr: "تجاوز التكلفة للتقدير",
    labelEn: "Cost to date running ahead of the estimate",
    ruleAr:
      "يظهر العقد هنا إذا تجاوزت التكلفة حتى تاريخه ما يقابل نسبة الإنجاز المعتمدة من التكلفة الكلية المقدرة بأكثر من الحد المحدد، أو إذا مضى على آخر مراجعة للتقدير أكثر من المدة المحددة بالأشهر — تقدير لم يُراجع هو تقدير لم يُختبر.",
  },
];

export function getContractingExceptionDefinition(key: ContractingExceptionKey): ContractingExceptionDefinition {
  const found = CONTRACTING_EXCEPTION_DEFINITIONS.find((d) => d.key === key);
  if (!found) throw new Error(`unknown contracting exception "${key}"`);
  return found;
}

const SCALE = 1_000_000n;

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** qty × qtyPerUnit — both at 1e-6, so the product lands back on 1e-6. */
export function multiplyQty(qty: Qty, perUnit: Qty): Qty {
  return Qty.fromScaled(divHalfUp(qty.scaled * perUnit.scaled, SCALE));
}

/**
 * (actual − theoretical) ÷ theoretical × 100, as an exact decimal string with
 * one place. Null when the theoretical quantity is zero: a percentage of
 * nothing is not a big number, it is an undefined one, and printing "∞%" is
 * how a real exception gets dismissed as a glitch.
 */
export function variancePercentOf(actual: Qty, theoretical: Qty): string | null {
  if (theoretical.scaled === 0n) return null;
  const tenths = divHalfUp((actual.scaled - theoretical.scaled) * 1000n, theoretical.scaled);
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  return `${negative ? "-" : ""}${abs / 10n}.${abs % 10n}`;
}

/** |variance| > threshold, where a theoretical of zero against real consumption always fires. */
export function exceedsVarianceThreshold(
  actual: Qty,
  theoretical: Qty,
  thresholdPercent: string,
): boolean {
  if (theoretical.scaled === 0n) return actual.scaled !== 0n;
  const threshold = Money.fromMajor(thresholdPercent).scaled;
  const diff = actual.scaled - theoretical.scaled;
  const absDiff = diff < 0n ? -diff : diff;
  // |diff| / theoretical × 100 > threshold, cross-multiplied so nothing rounds.
  return absDiff * 100n * SCALE > threshold * theoretical.scaled;
}

// ----- 1. تجاوز الكميات التعاقدية ------------------------------------------

export interface BoqOverrunCandidate {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  readonly boqLineId: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly unitLabelAr: string;
  readonly certificateId: string;
  readonly certificateDocNo: string;
  readonly executionDate: string;
  readonly cumulativeQty: Qty;
  /** الكمية التعاقدية as of `executionDate` — variation orders approved after it do not count. */
  readonly contractedQty: Qty;
}

export interface BoqOverrunRow extends BoqOverrunCandidate {
  readonly excessQty: Qty;
}

export function findBoqOverruns(candidates: readonly BoqOverrunCandidate[]): BoqOverrunRow[] {
  return candidates
    .filter((c) => c.cumulativeQty.scaled > c.contractedQty.scaled)
    .map((c) => ({ ...c, excessQty: Qty.fromScaled(c.cumulativeQty.scaled - c.contractedQty.scaled) }));
}

// ----- 2. مواد مصروفة لم تُستلم بالموقع --------------------------------------

export interface UnreceivedCandidate {
  readonly issueId: string;
  readonly docNo: string | null;
  readonly date: string;
  readonly projectId: string;
  readonly itemId: string;
  readonly qtyIssued: Qty;
  readonly qtyReceived: Qty;
  readonly qtyOutstanding: Qty;
  readonly ageDays: number;
  /** `received_before_issue` rows are the fraud signature, not an ageing shortfall. */
  readonly kind?: "outstanding" | "received_before_issue";
}

/**
 * A receipt dated BEFORE the issue it closes is reported whatever its age and
 * whatever it left outstanding — it is not a shortfall waiting to be signed
 * for, and an ageing filter is exactly where such a row would hide.
 */
export function findUnreceivedIssues<T extends UnreceivedCandidate>(
  candidates: readonly T[],
  olderThanDays: number,
): T[] {
  return candidates.filter((c) =>
    c.kind === "received_before_issue" ? true : c.ageDays >= olderThanDays && c.qtyOutstanding.scaled > 0n,
  );
}

// ----- 3. انحراف الاستهلاك عن الكميات النظرية ---------------------------------

export interface ConsumptionVarianceCandidate {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  readonly boqLineId: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly itemId: string;
  readonly theoreticalQtyPerUnit: Qty;
  /** الكمية المعتمدة تراكميًا for the line at the report date. */
  readonly certifiedCumulativeQty: Qty;
  readonly consumedQty: Qty;
  readonly consumedCost: Money;
}

export interface ConsumptionVarianceRow extends ConsumptionVarianceCandidate {
  readonly theoreticalQty: Qty;
  readonly varianceQty: Qty;
  readonly variancePercent: string | null;
}

export function findConsumptionVariances(
  candidates: readonly ConsumptionVarianceCandidate[],
  thresholdPercent: string,
): ConsumptionVarianceRow[] {
  const rows: ConsumptionVarianceRow[] = [];
  for (const c of candidates) {
    const theoreticalQty = multiplyQty(c.certifiedCumulativeQty, c.theoreticalQtyPerUnit);
    if (!exceedsVarianceThreshold(c.consumedQty, theoreticalQty, thresholdPercent)) continue;
    rows.push({
      ...c,
      theoreticalQty,
      varianceQty: Qty.fromScaled(c.consumedQty.scaled - theoreticalQty.scaled),
      variancePercent: variancePercentOf(c.consumedQty, theoreticalQty),
    });
  }
  return rows;
}

// ----- 4. ساعات معدات بلا مستخلص مقابل ---------------------------------------

export type EquipmentExceptionReason = "no_boq_line" | "not_certified_since";

export interface EquipmentExceptionCandidate {
  readonly contractId: string | null;
  readonly contractDocNo: string | null;
  readonly contractStatus: string | null;
  readonly projectId: string;
  readonly equipmentLogId: string;
  readonly docNo: string | null;
  readonly assetId: string;
  readonly date: string;
  readonly hours: Qty;
  readonly amount: Money;
  readonly boqLineId: string | null;
  readonly code: string | null;
  readonly descriptionAr: string | null;
  /** The line's certified cumulative quantity ON the day the hours were logged. */
  readonly certifiedCumulativeAtLog: Qty;
  /** …and at the report date. Unmoved between the two is the exception. */
  readonly certifiedCumulativeNow: Qty;
  readonly ageDays: number;
}

export interface EquipmentExceptionRow extends EquipmentExceptionCandidate {
  readonly reason: EquipmentExceptionReason;
}

export function findEquipmentWithoutCertificate(
  candidates: readonly EquipmentExceptionCandidate[],
  olderThanDays: number,
): EquipmentExceptionRow[] {
  const rows: EquipmentExceptionRow[] = [];
  for (const c of candidates) {
    if (c.boqLineId === null) {
      if (c.contractStatus === "active" && c.ageDays > olderThanDays) {
        rows.push({ ...c, reason: "no_boq_line" });
      }
      continue;
    }
    if (c.certifiedCumulativeNow.scaled <= c.certifiedCumulativeAtLog.scaled) {
      rows.push({ ...c, reason: "not_certified_since" });
    }
  }
  return rows;
}

// ----- 5. أوامر تغيير معتمدة بعد التنفيذ -------------------------------------

export interface LateVariationCandidate {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  readonly variationOrderId: string;
  readonly variationDocNo: string;
  readonly variationTitleAr: string;
  readonly approvedAt: string;
  readonly boqLineId: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly certificateId: string;
  readonly certificateDocNo: string;
  readonly executionDate: string;
  readonly cumulativeQty: Qty;
  /** الكمية التعاقدية as of the certificate's own execution date. */
  readonly contractedQtyAtExecution: Qty;
}

export interface LateVariationRow extends LateVariationCandidate {
  readonly reliedOnQty: Qty;
}

/**
 * Fires only where the certificate ACTUALLY leaned on the late order: an order
 * approved after a certificate whose quantities it never touched is ordinary
 * paperwork, and reporting it would bury the finding that matters.
 */
export function findLateVariationApprovals(
  candidates: readonly LateVariationCandidate[],
): LateVariationRow[] {
  return candidates
    .filter((c) => c.approvedAt > c.executionDate && c.cumulativeQty.scaled > c.contractedQtyAtExecution.scaled)
    .map((c) => ({
      ...c,
      reliedOnQty: Qty.fromScaled(c.cumulativeQty.scaled - c.contractedQtyAtExecution.scaled),
    }));
}

// ----- 6. ضمان محتجز مفرج عنه قبل الميعاد ------------------------------------

/**
 * Both sides of the retention. A release to a SUBCONTRACTOR is exactly the same
 * exception as an early release by the employer — money let go before the event
 * that entitled anyone to it — and a report that only looked at the receivable
 * side left the half the contractor actually controls unwatched.
 */
export type RetentionReleaseParty = "customer" | "subcontractor";

export interface EarlyReleaseCandidate {
  readonly releaseId: string;
  readonly docNo: string;
  readonly party: RetentionReleaseParty;
  /** The subcontractor's name on a `subcontractor` row; null on the client side. */
  readonly counterpartyNameAr: string | null;
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  readonly kind: string;
  readonly date: string;
  readonly amount: Money;
  readonly releaseEventDate: string | null;
  readonly status: string;
}

export interface EarlyReleaseRow extends EarlyReleaseCandidate {
  readonly daysEarly: number;
}

export function findEarlyRetentionReleases(
  candidates: readonly EarlyReleaseCandidate[],
): EarlyReleaseRow[] {
  const rows: EarlyReleaseRow[] = [];
  for (const c of candidates) {
    if (c.status !== "released" || c.releaseEventDate === null || c.date >= c.releaseEventDate) continue;
    rows.push({ ...c, daysEarly: daysBetweenDates(c.date, c.releaseEventDate) });
  }
  return rows;
}

/** Whole days from `from` to `to`, both ISO dates. Negative when `to` precedes `from`. */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ----- 7. تجاوز التكلفة للتقدير ----------------------------------------------

/**
 * The estimate is the denominator of every percentage of completion the run
 * posts, and nothing in the system ever questioned it: a contract could burn
 * twice the cost its certified work has earned, or carry an estimate untouched
 * since the day it was signed, and no report said a word. Both are the same
 * finding — the التكلفة الكلية المقدرة is no longer describing this contract.
 */
export interface CostOverrunCandidate {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly contractTitleAr: string;
  readonly projectId: string;
  readonly status: string;
  /** التكلفة حتى تاريخه on the same basis the run uses. */
  readonly costToDate: Money;
  readonly estimatedTotalCost: Money;
  /** إجمالي الأعمال المعتمدة تراكميًا — the certified gross works, before التشوينات and the discount. */
  readonly certifiedGrossWorks: Money;
  readonly contractValue: Money;
  /** The date التكلفة الكلية المقدرة was last set or revised. Null when it was never revised. */
  readonly lastEstimateRevisionDate: string | null;
  /** Whole months from that date to the report date. Null when there is no date at all. */
  readonly monthsSinceEstimateRevision: number | null;
}

export interface CostOverrunRow extends CostOverrunCandidate {
  /** estimatedTotalCost × certifiedGrossWorks / contractValue — what the earned work should have cost. */
  readonly expectedCostToDate: Money;
  /** costToDate − expectedCostToDate. Positive on every row that fired for cost. */
  readonly excessCost: Money;
  readonly costOverrun: boolean;
  readonly estimateStale: boolean;
}

/** Whole months between two ISO dates, floored — a 6-month staleness window is months, not 180 days. */
export function monthsBetweenDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  const months = (ty - fy) * 12 + (tm - fm);
  return td < fd ? months - 1 : months;
}

/**
 * Fires on either signal. The cost test is cross-multiplied so nothing rounds:
 * costToDate × contractValue × 100 > estimatedTotalCost × certifiedGrossWorks ×
 * (100 + threshold). A contract with no certified work yet has no earned cost
 * to compare against, so only the staleness test can fire on it.
 */
export function findCostOverrunsVsEstimate(
  candidates: readonly CostOverrunCandidate[],
  thresholdPercent: string,
  stalenessMonths: number,
): CostOverrunRow[] {
  const threshold = Money.fromMajor(thresholdPercent).scaled;
  const rows: CostOverrunRow[] = [];
  for (const c of candidates) {
    const expectedCostToDate =
      c.contractValue.scaled === 0n
        ? Money.zero()
        : Money.fromScaled(divHalfUp(c.estimatedTotalCost.scaled * c.certifiedGrossWorks.scaled, c.contractValue.scaled));
    const costOverrun =
      c.contractValue.scaled > 0n &&
      c.certifiedGrossWorks.scaled > 0n &&
      c.costToDate.scaled * c.contractValue.scaled * (100n * SCALE) >
        c.estimatedTotalCost.scaled * c.certifiedGrossWorks.scaled * (100n * SCALE + threshold);
    const estimateStale =
      c.monthsSinceEstimateRevision !== null && c.monthsSinceEstimateRevision >= stalenessMonths;
    if (!costOverrun && !estimateStale) continue;
    rows.push({
      ...c,
      expectedCostToDate,
      excessCost: Money.fromScaled(c.costToDate.scaled - expectedCostToDate.scaled),
      costOverrun,
      estimateStale,
    });
  }
  return rows;
}
