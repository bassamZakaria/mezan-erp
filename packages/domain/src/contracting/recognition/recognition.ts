import type { Money } from "../../money/index.js";
import type { CostCategory } from "../cost-category.js";
import type { RecognitionPolicy } from "../contracts/contract.js";

/**
 * تشغيل الاعتراف بالإيراد — the monthly EAS 48 cost-to-cost run
 * (docs/artifacts/mezan-contracting-designs.html D-03, D-12).
 *
 * Billing and revenue are two arrows from two sources: the مستخلص credits
 * فواتير مستخلصات على العقود (2165) and this run credits إيرادات المقاولات
 * (4100). Their difference is أصل العقد / التزام العقد — a real balance an
 * auditor can test, and the figure that shows a loss-making contract before
 * the loss is realised.
 *
 * The run also relieves أعمال تحت التنفيذ every month rather than at handover,
 * so WIP is a month-end tieable balance: opening + incurred − relieved =
 * closing, and closing reads zero the moment a run posts.
 */

/** The document type stamped on every journal entry a run posts. */
export const RECOGNITION_DOC_TYPE = "REVENUE_RECOGNITION_RUN";

export type RecognitionRunStatus = "posted" | "reversed";

export const RECOGNITION_RUN_STATUS_DEFINITIONS: readonly { code: RecognitionRunStatus; labelAr: string }[] = [
  { code: "posted", labelAr: "مُرحّل" },
  { code: "reversed", labelAr: "معكوس" },
] as const;

export function getRecognitionRunStatusLabel(status: RecognitionRunStatus): string {
  return RECOGNITION_RUN_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** One slice of the WIP balance, as it was categorised when the cost was capitalised. */
export interface WipCategoryAmount {
  readonly costCategory: CostCategory | null;
  readonly amount: Money;
}

/**
 * Every figure the run computes, all of them server-derived. Stored on the run
 * so the posted entry can be re-explained years later without recomputing
 * against a ledger that has moved on.
 */
export interface RecognitionFigures {
  readonly recognitionPolicy: RecognitionPolicy;
  /** التكلفة الكلية المقدرة as of `periodEnd` — the latest budget revision dated on or before it. */
  readonly estimatedTotalCost: Money;
  readonly costToDate: Money;
  /** المتبقي للإنجاز = max(0, estimatedTotalCost − costToDate). */
  readonly costToComplete: Money;
  /** Exact decimal string with four places, capped at "100.0000". */
  readonly percentComplete: string;
  /** قيمة العقد بعد أوامر التغيير المعتمدة حتى `periodEnd`. */
  readonly contractValue: Money;
  readonly revenueToDate: Money;
  readonly revenueRecognisedPreviously: Money;
  /** revenueToDate − revenueRecognisedPreviously. Negative when an estimate worsened. */
  readonly periodRevenue: Money;
  /** The billings balance standing in 2165 at `periodEnd`, which this run reclassifies. */
  readonly billedInPeriod: Money;
  readonly billedToDate: Money;
  /** ≥ 0. Zero when the position is a liability. */
  readonly contractAsset: Money;
  /** ≥ 0. Zero when the position is an asset. */
  readonly contractLiability: Money;
  /**
   * The change in التزام العقد this run posts. Positive moves an excess credit
   * out of 1170 into 2175 (Dr 1170 / Cr 2175); negative releases the liability
   * back into the asset (Dr 2175 / Cr 1170).
   */
  readonly contractPositionMovement: Money;
  /** max(0, estimatedTotalCost − contractValue) — the whole loss, the month it is foreseen. */
  readonly foreseeableLoss: Money;
  /** The part of that loss not yet passed through P&L: foreseeableLoss × (1 − percentComplete). */
  readonly provisionRequired: Money;
  /** What 2196 already carries for this project at `periodEnd`. */
  readonly provisionBalance: Money;
  readonly provisionMovement: Money;
  readonly wipOpening: Money;
  readonly wipIncurred: Money;
  readonly wipRelieved: Money;
  /** opening + incurred − relieved. Reads zero after a run, which is the identity the screen shows. */
  readonly wipClosing: Money;
  readonly wipByCategory: readonly WipCategoryAmount[];
}

export interface RevenueRecognitionRun extends RecognitionFigures {
  readonly id: string;
  readonly docNo: string;
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  /** Last day of the month the run covers. */
  readonly periodEnd: string;
  readonly status: RecognitionRunStatus;
  readonly journalEntryId: string | null;
  readonly reversalJournalEntryId: string | null;
  readonly postedAt: string;
  readonly postedBy: string | null;
  readonly reversedAt: string | null;
  readonly reversedBy: string | null;
}

export interface RecognitionRunFilter {
  readonly contractId?: string;
  readonly projectId?: string;
  readonly periodEnd?: string;
  readonly status?: RecognitionRunStatus;
}

/** Persistence port. The domain depends on this interface only — no SQL, no driver. */
export interface RevenueRecognitionRunRepository {
  findById(id: string): Promise<RevenueRecognitionRun | null>;
  findByDocNo(docNo: string): Promise<RevenueRecognitionRun | null>;
  list(filter?: RecognitionRunFilter): Promise<RevenueRecognitionRun[]>;
  save(run: RevenueRecognitionRun): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
