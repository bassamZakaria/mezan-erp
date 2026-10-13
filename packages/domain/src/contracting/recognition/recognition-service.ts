import { Money } from "../../money/index.js";
import type { Account, AccountRepository } from "../../accounts/account.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import { routedAccountId, type AccountRoutingRepository } from "../../accounts/account-routing.js";
import { postJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../../gl/index.js";
import type { LedgerRepository, PostedLine } from "../../gl/ledger.js";
import type { CostCategory } from "../cost-category.js";
import type {
  BoqLine,
  VariationOrder,
  WorksContract,
  WorksContractStatus,
  WorksContractStore,
} from "../contracts/contract.js";
import {
  computeRecognition,
  contractValueAsOf,
  estimatedTotalCostAsOf,
  isMonthEnd,
  monthEndOf,
  previousMonthEnd,
  type RecognitionAccountIds,
} from "./recognition-math.js";
import {
  RECOGNITION_DOC_TYPE,
  type RecognitionFigures,
  type RecognitionRunFilter,
  type RevenueRecognitionRun,
  type RevenueRecognitionRunRepository,
} from "./recognition.js";
import {
  InvalidRecognitionRunError,
  RecognitionPreviousPeriodMissingError,
  RecognitionRunAlreadyPostedError,
  RecognitionRunAlreadyReversedError,
  RecognitionRunNotFoundError,
  RecognitionRunNotLatestError,
} from "./errors.js";
import { tenantTodayIso } from "../../dates.js";

/** The numbering sequence a run draws its `RR-…` number from. */
const RECOGNITION_SEQUENCE = "REVENUE_RECOGNITION_RUN";

/** WIP that was capitalised without a category is relieved as تكاليف غير مباشرة. */
const UNCATEGORISED_RELIEF_CATEGORY: CostCategory = "indirect";

const ROUTING_DEFAULTS: Readonly<Record<keyof RecognitionAccountIds, [string, string]>> = {
  wip: ["contracting.wip", "1230"],
  costOfRevenue: ["contracting.cost_of_revenue", "5150"],
  billings: ["contracting.billings", "2165"],
  contractAsset: ["contracting.contract_asset", "1170"],
  contractLiability: ["contracting.contract_liability", "2175"],
  onerousProvision: ["contracting.onerous_provision", "2196"],
  onerousLoss: ["contracting.onerous_loss", "5930"],
  revenue: ["contracting.revenue", "4150"],
  plantRecovery: ["contracting.plant_recovery", "5160"],
  customerAdvances: ["contracting.customer_advances", "2160"],
  retentionReceivable: ["contracting.retention_receivable", "1150"],
};

export interface RecognitionServiceDeps {
  readonly runs: RevenueRecognitionRunRepository;
  readonly contracts: WorksContractStore;
  readonly accounts: Pick<AccountRepository, "list">;
  readonly ledger: Pick<LedgerRepository, "listLines">;
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  /** The REAL GL posting engine's ports — a run posts through it, nothing else. */
  readonly gl: JournalPostingDeps;
  /**
   * The expense accounts that are NOT contract cost — غرامات التأخير, the plant
   * recovery contra, the onerous-loss line and the inventory-adjustment
   * accounts (5060–5080). Built from the routing table in the composition.
   */
  readonly costExcludedAccountIds?: () => Promise<ReadonlySet<string>>;
  /** سجل العمليات الحساسة — a run recognises revenue, so it is recorded. */
  readonly audit?: AuditSink;
  /** ISO `YYYY-MM-DD` "today", overridable for deterministic tests. */
  readonly today?: () => string;
  /** ISO-8601 UTC "now", overridable for deterministic tests. */
  readonly now?: () => string;
}

export interface PostRecognitionRunCommand {
  readonly id?: string;
  readonly contractId: string;
  readonly periodEnd: string;
  readonly postedBy?: string | null;
}

export interface ReverseRecognitionRunCommand {
  readonly reversedBy?: string | null;
}

/** The computed block a preview or a status row carries — every figure, none of them posted. */
export interface RecognitionPreview extends RecognitionFigures {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly contractTitleAr: string;
  readonly contractStatus: WorksContractStatus;
  readonly projectId: string;
  readonly periodEnd: string;
  readonly lastRunPeriodEnd: string | null;
  readonly existingRunId: string | null;
  readonly existingRunDocNo: string | null;
  /** True when this contract still has something to post for this period. */
  readonly due: boolean;
  /** Why «تشغيل» is refused, in Arabic. Null when the run would go through. */
  readonly blockedReasonAr: string | null;
  /**
   * A closed month answers with the figures the run POSTED; this is the same
   * arithmetic run again against the ledger as it stands TODAY. A cost
   * confirmed after the month was closed lands dated inside it, so the two
   * diverge — which is the only way a reader ever learns the tie is broken.
   * Null on a period that has not been run.
   */
  readonly recomputed: RecognitionFigures | null;
  /** True when `recomputed` disagrees with the posted figures on cost, billings or WIP. */
  readonly divergent: boolean;
}

/**
 * The fields a divergence is judged on.
 *
 * NOT billedInPeriod or wipRelieved directly: the run ITSELF debits 2165 and
 * credits 1230, so recomputing a closed month always reports both as nil and
 * comparing them would flag every run ever posted. What a later posting shows
 * up as is a cost to date that no longer matches, or a 1230 balance that is
 * standing at the period end again after the run took it to zero.
 */
function divergesFrom(posted: RecognitionFigures, recomputed: RecognitionFigures): boolean {
  return (
    posted.costToDate.scaled !== recomputed.costToDate.scaled ||
    posted.revenueToDate.scaled !== recomputed.revenueToDate.scaled ||
    recomputed.wipRelieved.scaled !== 0n
  );
}

const EMPTY_FIGURES: Omit<RecognitionFigures, "recognitionPolicy"> = {
  estimatedTotalCost: Money.zero(),
  costToDate: Money.zero(),
  costToComplete: Money.zero(),
  percentComplete: "0.0000",
  contractValue: Money.zero(),
  revenueToDate: Money.zero(),
  revenueRecognisedPreviously: Money.zero(),
  periodRevenue: Money.zero(),
  billedInPeriod: Money.zero(),
  billedToDate: Money.zero(),
  contractAsset: Money.zero(),
  contractLiability: Money.zero(),
  contractPositionMovement: Money.zero(),
  foreseeableLoss: Money.zero(),
  provisionRequired: Money.zero(),
  provisionBalance: Money.zero(),
  provisionMovement: Money.zero(),
  wipOpening: Money.zero(),
  wipIncurred: Money.zero(),
  wipRelieved: Money.zero(),
  wipClosing: Money.zero(),
  wipByCategory: [],
  advanceOutstanding: Money.zero(),
  retentionHeld: Money.zero(),
};

/** The figures a preview or a stored run carries, without the context around them. */
function figuresOf(preview: RecognitionFigures): RecognitionFigures {
  return {
    recognitionPolicy: preview.recognitionPolicy,
    estimatedTotalCost: preview.estimatedTotalCost,
    costToDate: preview.costToDate,
    costToComplete: preview.costToComplete,
    percentComplete: preview.percentComplete,
    contractValue: preview.contractValue,
    revenueToDate: preview.revenueToDate,
    revenueRecognisedPreviously: preview.revenueRecognisedPreviously,
    periodRevenue: preview.periodRevenue,
    billedInPeriod: preview.billedInPeriod,
    billedToDate: preview.billedToDate,
    contractAsset: preview.contractAsset,
    contractLiability: preview.contractLiability,
    contractPositionMovement: preview.contractPositionMovement,
    foreseeableLoss: preview.foreseeableLoss,
    provisionRequired: preview.provisionRequired,
    provisionBalance: preview.provisionBalance,
    provisionMovement: preview.provisionMovement,
    wipOpening: preview.wipOpening,
    wipIncurred: preview.wipIncurred,
    wipRelieved: preview.wipRelieved,
    wipClosing: preview.wipClosing,
    wipByCategory: preview.wipByCategory,
    advanceOutstanding: preview.advanceOutstanding,
    retentionHeld: preview.retentionHeld,
  };
}

export class RecognitionService {
  constructor(private readonly deps: RecognitionServiceDeps) {}

  private today(): string {
    return this.deps.today ? this.deps.today() : tenantTodayIso();
  }

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** The period end the screen opens on: the end of the month before this one. */
  defaultPeriodEnd(): string {
    return previousMonthEnd(this.today());
  }

  private async accountIds(): Promise<RecognitionAccountIds> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    const entries = Object.entries(ROUTING_DEFAULTS) as [keyof RecognitionAccountIds, [string, string]][];
    return Object.fromEntries(
      entries.map(([field, [key, fallback]]) => [field, routedAccountId(routing, key) ?? fallback]),
    ) as unknown as RecognitionAccountIds;
  }

  private async expenseAccountIds(): Promise<Set<string>> {
    const accounts = (await this.deps.accounts.list()) as Account[];
    return new Set(accounts.filter((a) => a.type === "expense").map((a) => a.id));
  }

  private async costExcluded(): Promise<ReadonlySet<string>> {
    return this.deps.costExcludedAccountIds ? this.deps.costExcludedAccountIds() : new Set<string>();
  }

  private async requireContract(idOrDocNo: string): Promise<WorksContract> {
    const contract =
      (await this.deps.contracts.findContractById(idOrDocNo)) ??
      (await this.deps.contracts.findContractByDocNo(idOrDocNo));
    if (!contract) throw new InvalidRecognitionRunError([`العقد "${idOrDocNo}" غير موجود.`]);
    return contract;
  }

  private async liveRuns(contractId: string): Promise<RevenueRecognitionRun[]> {
    const runs = await this.deps.runs.list({ contractId });
    return runs.filter((r) => r.status === "posted").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  }

  private async projectLines(projectId: string, toDate: string): Promise<readonly PostedLine[]> {
    return (await this.deps.ledger.listLines?.({ projectId, toDate })) ?? [];
  }

  /**
   * The whole computed block for one contract and one period end, without
   * posting anything. The screen's «مساحة عمل التكلفة حتى الإتمام» reads this,
   * and so does the run itself — one arithmetic, two callers.
   */
  async preview(contractIdOrDocNo: string, periodEnd: string): Promise<RecognitionPreview> {
    const contract = await this.requireContract(contractIdOrDocNo);
    if (!isMonthEnd(periodEnd)) {
      throw new InvalidRecognitionRunError(["تاريخ نهاية الفترة يجب أن يكون آخر يوم في الشهر."]);
    }

    const liveRuns = await this.liveRuns(contract.id);
    const existing = liveRuns.find((r) => r.periodEnd === periodEnd) ?? null;
    const earlier = liveRuns.filter((r) => r.periodEnd < periodEnd);
    const lastRunPeriodEnd = liveRuns.length > 0 ? liveRuns[liveRuns.length - 1]!.periodEnd : null;

    const base = {
      contractId: contract.id,
      contractDocNo: contract.docNo,
      contractTitleAr: contract.titleAr,
      contractStatus: contract.status,
      projectId: contract.projectId,
      periodEnd,
      lastRunPeriodEnd,
      existingRunId: existing?.id ?? null,
      existingRunDocNo: existing?.docNo ?? null,
    };

    // A period that has already been run reports the figures THAT RUN posted.
    // Recomputing them would answer a different question — the run relieved WIP
    // and reclassified the billings it is now being asked about, so a fresh
    // computation of a closed month contradicts the entry standing in the books.
    if (existing) {
      const recomputed = await this.recompute(contract, periodEnd, earlier);
      return {
        ...base,
        ...figuresOf(existing),
        due: false,
        blockedReasonAr: `سبق تشغيل هذه الفترة بالمستند ${existing.docNo}.`,
        recomputed,
        divergent: recomputed !== null && divergesFrom(existing, recomputed),
      };
    }

    const estimatedTotalCost = estimatedTotalCostAsOf(contract, periodEnd);
    if (contract.status === "draft") {
      return {
        ...base,
        ...EMPTY_FIGURES,
        recognitionPolicy: contract.recognitionPolicy,
        due: false,
        blockedReasonAr: "لا يمكن الاعتراف بالإيراد على عقد ما زال مسودة.",
        recomputed: null,
        divergent: false,
      };
    }
    if (estimatedTotalCost === null || estimatedTotalCost.scaled <= 0n) {
      return {
        ...base,
        ...EMPTY_FIGURES,
        recognitionPolicy: contract.recognitionPolicy,
        due: false,
        blockedReasonAr: "لا يمكن الاعتراف بالإيراد دون تقدير التكلفة الكلية.",
        recomputed: null,
        divergent: false,
      };
    }

    const figures = (await this.recompute(contract, periodEnd, earlier, estimatedTotalCost))!;

    const movesSomething =
      figures.periodRevenue.scaled !== 0n ||
      figures.billedInPeriod.scaled !== 0n ||
      figures.contractPositionMovement.scaled !== 0n ||
      figures.wipRelieved.scaled !== 0n ||
      figures.provisionMovement.scaled !== 0n;

    let blockedReasonAr: string | null = null;
    if (contract.activatedAt !== null && contract.activatedAt > periodEnd) {
      blockedReasonAr = "لم يكن العقد سارياً في نهاية هذه الفترة.";
    } else if (liveRuns.some((r) => r.periodEnd > periodEnd)) {
      blockedReasonAr = `لا يمكن تشغيل فترة سابقة لآخر تشغيل (${lastRunPeriodEnd}).`;
    } else if (this.previousPeriodMissing(contract, periodEnd, liveRuns)) {
      blockedReasonAr = `يجب تشغيل الشهر السابق أولًا — الفترة المنتهية في ${previousMonthEnd(periodEnd)}.`;
    }

    const due =
      blockedReasonAr === null && (contract.status === "active" ? true : movesSomething);

    return { ...base, ...figures, due, blockedReasonAr, recomputed: null, divergent: false };
  }

  /**
   * The arithmetic, run against the ledger AS IT STANDS NOW for one period.
   * Called both to compute a fresh period and to re-explain a closed one.
   */
  private async recompute(
    contract: WorksContract,
    periodEnd: string,
    earlier: readonly RevenueRecognitionRun[],
    estimated?: Money,
  ): Promise<RecognitionFigures | null> {
    const estimatedTotalCost = estimated ?? estimatedTotalCostAsOf(contract, periodEnd);
    if (estimatedTotalCost === null || estimatedTotalCost.scaled <= 0n) return null;
    const [boqLines, orders, lines, expenseAccountIds, accounts, costExcludedAccountIds] = await Promise.all([
      this.deps.contracts.listBoqLines(contract.id) as Promise<BoqLine[]>,
      this.deps.contracts.listVariationOrders({ contractId: contract.id }) as Promise<VariationOrder[]>,
      this.projectLines(contract.projectId, periodEnd),
      this.expenseAccountIds(),
      this.accountIds(),
      this.costExcluded(),
    ]);
    return computeRecognition({
      periodEnd,
      recognitionPolicy: contract.recognitionPolicy,
      estimatedTotalCost,
      contractValue: contractValueAsOf(boqLines, orders, periodEnd),
      lines,
      expenseAccountIds,
      costExcludedAccountIds,
      accounts,
      revenueRecognisedPreviously: Money.sum(earlier.map((r) => r.periodRevenue)),
      billedReclassedPreviously: Money.sum(earlier.map((r) => r.billedInPeriod)),
    });
  }

  /**
   * The previous month must be run before this one, so periodRevenue is always
   * the movement of ONE month and no month can be silently skipped. The
   * contract's own first run is the exception — there is nothing before it.
   */
  private previousPeriodMissing(
    contract: WorksContract,
    periodEnd: string,
    liveRuns: readonly RevenueRecognitionRun[],
  ): boolean {
    if (liveRuns.length === 0) return false;
    const previous = previousMonthEnd(periodEnd);
    if (contract.activatedAt === null || contract.activatedAt > previous) return false;
    return !liveRuns.some((r) => r.periodEnd === previous);
  }

  /** تشغيل الاعتراف بالإيراد — compute, post ONE balanced entry, record the run. */
  async post(command: PostRecognitionRunCommand): Promise<RevenueRecognitionRun> {
    const contract = await this.requireContract(command.contractId);
    const preview = await this.preview(contract.id, command.periodEnd);

    if (preview.existingRunId !== null) {
      throw new RecognitionRunAlreadyPostedError(contract.id, command.periodEnd, preview.existingRunDocNo ?? "");
    }
    if (contract.status === "draft") {
      throw new InvalidRecognitionRunError(["لا يمكن الاعتراف بالإيراد على عقد ما زال مسودة."]);
    }
    const estimatedTotalCost = estimatedTotalCostAsOf(contract, command.periodEnd);
    if (estimatedTotalCost === null || estimatedTotalCost.scaled <= 0n) {
      throw new InvalidRecognitionRunError(["لا يمكن الاعتراف بالإيراد دون تقدير التكلفة الكلية."]);
    }
    if (contract.activatedAt !== null && contract.activatedAt > command.periodEnd) {
      throw new InvalidRecognitionRunError(["لم يكن العقد سارياً في نهاية هذه الفترة."]);
    }
    const liveRuns = await this.liveRuns(contract.id);
    if (liveRuns.some((r) => r.periodEnd > command.periodEnd)) {
      throw new InvalidRecognitionRunError([
        `لا يمكن تشغيل فترة سابقة لآخر تشغيل (${liveRuns[liveRuns.length - 1]!.periodEnd}).`,
      ]);
    }
    if (this.previousPeriodMissing(contract, command.periodEnd, liveRuns)) {
      throw new RecognitionPreviousPeriodMissingError(contract.id, previousMonthEnd(command.periodEnd));
    }

    const accounts = await this.accountIds();
    const lines = this.entryLines(preview, accounts, contract.projectId);
    const runId = command.id ?? `${RECOGNITION_DOC_TYPE}-${contract.id}-${command.periodEnd}`;
    if (await this.deps.runs.findById(runId)) {
      throw new InvalidRecognitionRunError([`تشغيل الاعتراف بالإيراد "${runId}" موجود بالفعل.`]);
    }

    const posted = await this.deps.runs.transaction(async () => {
      const number = await this.deps.gl.numbering.next(RECOGNITION_SEQUENCE);
      let journalEntryId: string | null = null;
      if (lines.length > 0) {
        const entry = await postJournalEntry(
          {
            id: `${RECOGNITION_DOC_TYPE}:${runId}`,
            date: command.periodEnd,
            memo: `الاعتراف بالإيراد ${number.formatted} — ${contract.docNo}`,
            source: "system",
            sourceDocType: RECOGNITION_DOC_TYPE,
            sourceDocId: runId,
            sourceDocNumber: number.formatted,
            lines,
          },
          this.deps.gl,
          { mintedBySystem: true },
        );
        journalEntryId = entry.id;
      }

      const run: RevenueRecognitionRun = {
        ...figuresOf(preview),
        id: runId,
        docNo: number.formatted,
        contractId: contract.id,
        contractDocNo: contract.docNo,
        projectId: contract.projectId,
        periodEnd: command.periodEnd,
        status: "posted",
        journalEntryId,
        reversalJournalEntryId: null,
        postedAt: this.now(),
        postedBy: command.postedBy ?? null,
        reversedAt: null,
        reversedBy: null,
      };
      await this.deps.runs.save(run);
      return run;
    });
    await recordTransition(this.deps.audit, {
      entityType: RECOGNITION_DOC_TYPE,
      entityId: posted.id,
      action: "POST",
      actor: posted.postedBy ?? "system",
      severity: "WARNING",
      details: {
        docNo: posted.docNo,
        contractId: posted.contractId,
        projectId: posted.projectId,
        periodEnd: posted.periodEnd,
        periodRevenue: posted.periodRevenue.toString(),
        journalEntryId: posted.journalEntryId,
      },
    });
    return posted;
  }

  /**
   * The four postings, in one entry so no half of the month's recognition can
   * exist without the others (design D-12). Every line carries the project;
   * only the WIP relief carries a cost category, because only it is cost.
   */
  private entryLines(
    figures: RecognitionFigures,
    accounts: RecognitionAccountIds,
    projectId: string,
  ): JournalLineInput[] {
    const lines: JournalLineInput[] = [];
    const pair = (
      debit: { accountId: string; costCategory?: CostCategory | null },
      credit: { accountId: string; costCategory?: CostCategory | null },
      amount: Money,
      memo: string,
    ): void => {
      if (amount.scaled === 0n) return;
      const positive = amount.scaled > 0n;
      const value = Money.fromScaled(positive ? amount.scaled : -amount.scaled);
      const [dr, cr] = positive ? [debit, credit] : [credit, debit];
      lines.push({
        accountId: dr.accountId,
        debit: value,
        credit: Money.zero(),
        memo,
        projectId,
        costCategory: dr.costCategory ?? null,
      });
      lines.push({
        accountId: cr.accountId,
        debit: Money.zero(),
        credit: value,
        memo,
        projectId,
        costCategory: cr.costCategory ?? null,
      });
    };

    pair({ accountId: accounts.contractAsset }, { accountId: accounts.revenue }, figures.periodRevenue, "إيراد الفترة — نسبة الإنجاز");
    pair({ accountId: accounts.billings }, { accountId: accounts.contractAsset }, figures.billedInPeriod, "إعادة تبويب مستخلصات الفترة");
    pair(
      { accountId: accounts.contractAsset },
      { accountId: accounts.contractLiability },
      figures.contractPositionMovement,
      "تسوية أصل/التزام العقد",
    );

    for (const bucket of figures.wipByCategory) {
      // The 1230 credit carries the SAME category as the debit that created it
      // — null included. Relieve an uncategorised debit with an «indirect»
      // credit and the WIP balance stops netting to zero per category, so the
      // relief can never be proved to have taken out exactly what went in.
      pair(
        { accountId: accounts.costOfRevenue, costCategory: bucket.costCategory ?? UNCATEGORISED_RELIEF_CATEGORY },
        { accountId: accounts.wip, costCategory: bucket.costCategory },
        bucket.amount,
        "تحميل تكلفة إيراد العقود",
      );
    }

    pair({ accountId: accounts.onerousLoss }, { accountId: accounts.onerousProvision }, figures.provisionMovement, "مخصص عقد خاسر");
    return lines;
  }

  /** عكس التشغيل — the mirror entry, and only for the contract's latest run. */
  async reverse(runId: string, command: ReverseRecognitionRunCommand = {}): Promise<RevenueRecognitionRun> {
    const run = (await this.deps.runs.findById(runId)) ?? (await this.deps.runs.findByDocNo(runId));
    if (!run) throw new RecognitionRunNotFoundError(runId);
    if (run.status === "reversed") throw new RecognitionRunAlreadyReversedError(run.id);
    const liveRuns = await this.liveRuns(run.contractId);
    const latest = liveRuns[liveRuns.length - 1];
    if (latest && latest.id !== run.id) throw new RecognitionRunNotLatestError(run.id, latest.periodEnd);

    return this.deps.runs.transaction(async () => {
      let reversalJournalEntryId: string | null = null;
      if (run.journalEntryId) {
        const original = await this.deps.gl.ledger.findById(run.journalEntryId);
        if (!original) throw new RecognitionRunNotFoundError(run.journalEntryId);
        const entry = await postJournalEntry(
          {
            id: `${RECOGNITION_DOC_TYPE}:REVERSE:${run.id}`,
            date: run.periodEnd,
            memo: `عكس الاعتراف بالإيراد ${run.docNo}`,
            source: "system",
            sourceDocType: RECOGNITION_DOC_TYPE,
            sourceDocId: run.id,
            sourceDocNumber: run.docNo,
            lines: original.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              memo: l.memo,
              projectId: l.projectId,
              costCategory: l.costCategory,
            })),
          },
          this.deps.gl,
          { mintedBySystem: true },
        );
        reversalJournalEntryId = entry.id;
      }
      const reversed: RevenueRecognitionRun = {
        ...run,
        status: "reversed",
        reversalJournalEntryId,
        reversedAt: this.now(),
        reversedBy: command.reversedBy ?? null,
      };
      await this.deps.runs.save(reversed);
      return reversed;
    });
  }

  async listRuns(filter?: RecognitionRunFilter): Promise<RevenueRecognitionRun[]> {
    return this.deps.runs.list(filter);
  }

  async findRun(idOrDocNo: string): Promise<RevenueRecognitionRun | null> {
    return (await this.deps.runs.findById(idOrDocNo)) ?? (await this.deps.runs.findByDocNo(idOrDocNo));
  }

  /** Every contract that has started, with its last run and this period's figures. */
  async status(periodEnd: string): Promise<RecognitionPreview[]> {
    if (!isMonthEnd(periodEnd)) {
      throw new InvalidRecognitionRunError(["تاريخ نهاية الفترة يجب أن يكون آخر يوم في الشهر."]);
    }
    const contracts = await this.deps.contracts.listContracts();
    const live = contracts.filter((c) => c.status !== "draft");
    const rows = await Promise.all(live.map((c) => this.preview(c.id, periodEnd)));
    return rows.sort((a, b) => a.contractDocNo.localeCompare(b.contractDocNo));
  }

  /** The end of the month `date` falls in — the screen's month picker resolves through this. */
  monthEnd(date: string): string {
    return monthEndOf(date);
  }
}
