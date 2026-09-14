import { Money, Qty } from "../../money/index.js";
import { routedAccountId, type AccountRoutingRepository } from "../../accounts/account-routing.js";
import type { NextNumberService } from "../../numbering/index.js";
import type { JournalPostingDeps } from "../../gl/index.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import type { ProjectRepository } from "../../projects/project.js";
import { approvalDates, contractedQtyOf } from "../contracts/index.js";
import type {
  BoqLine,
  BoqLineAdjustment,
  VariationOrder,
  WorksContract,
  WorksContractStore,
} from "../contracts/contract.js";
import { isLiveCertificate, type ProgressCertificate, type ProgressCertificateStore } from "../certificates/certificate.js";
import type {
  ConsumptionByBoqLineRow,
  EquipmentLog,
  EquipmentLogRepository,
  UnreceivedRow,
} from "../site/index.js";
import { getBoqUnitLabel } from "../contracts/boq-unit.js";
import { contractValueAsOf } from "../recognition/recognition-math.js";
import type { SubcontractView } from "../subcontracts/subcontract-service.js";
import {
  CONTRACTING_EXCEPTION_KEYS,
  daysBetweenDates,
  findBoqOverruns,
  findConsumptionVariances,
  findEarlyRetentionReleases,
  findCostOverrunsVsEstimate,
  findEquipmentWithoutCertificate,
  findLateVariationApprovals,
  findUnreceivedIssues,
  getContractingExceptionDefinition,
  monthsBetweenDates,
  type BoqOverrunCandidate,
  type BoqOverrunRow,
  type ConsumptionVarianceCandidate,
  type ConsumptionVarianceRow,
  type ContractingExceptionKey,
  type CostOverrunCandidate,
  type CostOverrunRow,
  type EarlyReleaseCandidate,
  type EarlyReleaseRow,
  type EquipmentExceptionCandidate,
  type EquipmentExceptionRow,
  type LateVariationCandidate,
  type LateVariationRow,
} from "./exceptions.js";
import {
  isEarlyRelease,
  nextRetentionEvent,
  releaseCapOf,
  releaseEventDateOf,
  retentionPayablePositionOf,
  retentionPositionOf,
  type RetentionCalendarEvent,
  type RetentionPosition,
} from "./retention-math.js";
import {
  RETENTION_RELEASE_ITEM_ID,
  type RetentionRelease,
  type RetentionReleaseKind,
  type RetentionReleaseListFilter,
  type RetentionReleaseStore,
} from "./retention-release.js";
import {
  InvalidRetentionReleaseError,
  InvalidRetentionReleaseTransitionError,
  RetentionReleaseExceedsBalanceError,
  RetentionReleaseNotFoundError,
} from "./errors.js";

/**
 * تقارير الاستثناءات والإفراج عن المحتجزات — slice 5B (design §06).
 *
 * Every report is assembled HERE from posted documents through the other
 * slices' own ports — the certificates' cumulative quantities, the contract's
 * variation approval dates, the site module's unreceived/consumption/plant
 * readings — and never from SQL this module writes itself. The rules those
 * rows are judged by live in `exceptions.ts` and are pure.
 */

const RETENTION_RELEASE_SEQUENCE = "RETENTION_RELEASE";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A money figure as a person reads it — two places, not the ledger's six. */
function minor(amount: Money): string {
  const text = amount.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? text : text.slice(0, dot + 3);
}

/** Statuses at which the consultant has signed the quantities — the ones a control report may rely on. */
const CERTIFIED_STATUSES = new Set(["certified", "approved_for_payment", "invoiced"]);

export const DEFAULT_UNRECEIVED_OLDER_THAN_DAYS = 7;
export const DEFAULT_CONSUMPTION_VARIANCE_PERCENT = "10";
export const DEFAULT_EQUIPMENT_OLDER_THAN_DAYS = 30;
export const DEFAULT_COST_OVERRUN_PERCENT = "10";
export const DEFAULT_ESTIMATE_STALENESS_MONTHS = 6;

/** The site module's read models, as the control reports see them (slice 4A owns them). */
export interface SiteReadPort {
  listUnreceived(options: {
    olderThanDays?: number;
    projectId?: string;
    asOf?: string;
  }): Promise<readonly UnreceivedRow[]>;
  consumptionByBoqLine(projectId: string): Promise<readonly ConsumptionByBoqLineRow[]>;
}

export interface RetentionReleaseInvoiceCommand {
  readonly releaseId: string;
  readonly releaseDocNo: string;
  readonly contractDocNo: string;
  readonly customerId: string;
  readonly projectId: string;
  readonly date: string;
  /** The release EVENT date, which is the whole point: retention ages from here, not from the certificate. */
  readonly dueDate: string;
  readonly amount: Money;
  /** The retention account. Crediting it from the invoice is what keeps AR == GL. */
  readonly retentionAccountId: string;
  readonly itemId: string;
  readonly lineDescriptionAr: string;
  readonly memoAr: string;
  /** WHO released the retention — the generated invoice's audit row named `system`. */
  readonly actor?: string | null;
}

export interface RetentionReleaseInvoiceResult {
  readonly invoiceId: string;
  readonly invoiceDocNo: string;
  readonly arAccountId: string;
  readonly total: Money;
}

export interface RetentionReleaseInvoiceStatus {
  readonly invoiceId: string;
  readonly docNo: string | null;
  readonly total: Money;
  readonly amountPaid: Money;
  readonly remainingBalance: Money;
  readonly dueDate: string | null;
  readonly status: string;
}

/**
 * The sales-invoice engine, as the release sees it.
 *
 * INVARIANT: a retention release is NOT a new sale — the invoice's single line
 * credits the RETENTION account, so its own posting is the Dr 1105 / Cr 1150
 * reclass and the receivables sub-ledger moves by exactly what the control
 * account did. Posting a separate journal entry instead would move GL 1105
 * without the sub-ledger and the two would never agree again.
 */
export interface RetentionReleaseInvoicingPort {
  issue(cmd: RetentionReleaseInvoiceCommand): Promise<RetentionReleaseInvoiceResult>;
  status(invoiceId: string): Promise<RetentionReleaseInvoiceStatus | null>;
}

/**
 * One subcontract's retention row on the calendar. The event is the sub's own
 * clock — completion for the provisional tranche, completion + فترة الضمان for
 * the final one — so the payable side ages from when it becomes claimable
 * rather than from the certificate that withheld it.
 */
function subcontractRetentionClock(view: SubcontractView, asOfDate: string): RetentionPayableSubcontractRow {
  const s = view.subcontract;
  const releaseEventDate =
    view.retention.finalReleaseEventDate ?? view.retention.provisionalReleaseEventDate;
  const daysToEvent = releaseEventDate === null ? null : daysBetweenDates(asOfDate, releaseEventDate);
  const due = releaseEventDate !== null && releaseEventDate <= asOfDate;
  return {
    subcontractId: s.id,
    subcontractDocNo: s.docNo,
    titleAr: s.titleAr,
    supplierId: s.supplierId,
    status: s.status,
    held: view.retention.held,
    released: view.retention.released,
    balance: view.retention.balance,
    completionDate: view.retention.completionDate,
    defectsLiabilityMonths: view.retention.defectsLiabilityMonths,
    releaseEventDate,
    daysToEvent,
    due,
    ageDays: due && daysToEvent !== null ? -daysToEvent : null,
  };
}

export interface ControlsServiceDeps {
  readonly releases: RetentionReleaseStore;
  readonly contracts: WorksContractStore;
  readonly certificates: Pick<ProgressCertificateStore, "listByContract">;
  readonly gl: JournalPostingDeps;
  readonly numbering: NextNumberService;
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  readonly invoicing?: RetentionReleaseInvoicingPort;
  /** Slice 4A. Absent, reports 2 and 3 answer honestly with no rows. */
  readonly site?: SiteReadPort;
  readonly equipmentLogs?: Pick<EquipmentLogRepository, "list">;
  readonly projects?: Pick<ProjectRepository, "list">;
  /**
   * عقود الباطن. Absent, the retention reports show the receivable side only —
   * which is honest, not silently half-right.
   */
  readonly subcontracts?: { list(): Promise<readonly SubcontractView[]> };
  /**
   * التكلفة حتى تاريخه for a project, on the recognition run's OWN basis —
   * the same `costToDateOf` the run posts through, so report 7 and the run can
   * never disagree about what a contract has cost. Absent, only the staleness
   * half of report 7 can fire.
   */
  readonly projectCostToDate?: (projectId: string, toDate: string) => Promise<Money>;
  /** The service item the generated release invoice names. */
  readonly releaseItemId?: string;
  /** سجل العمليات الحساسة — the release moves money, so it is recorded. */
  readonly audit?: AuditSink;
  readonly today?: () => string;
  /**
   * Reads the tenant's `contracting.singleOperatorMode`. False — the default —
   * waives nothing, so the creator of a release may never be the one who
   * releases it. The same predicate the certificate uses.
   */
  readonly segregationWaived?: (actor: RetentionReleaseActor) => Promise<boolean>;
}

/** WHO is releasing. `wildcardAdmin` is what «وضع المشغّل الواحد» waives, and only that. */
export interface RetentionReleaseActor {
  readonly userId: string;
  readonly wildcardAdmin: boolean;
}

export interface ExceptionReportParams {
  readonly projectId?: string | null;
  readonly asOfDate?: string | null;
  readonly olderThanDays?: number | null;
  readonly thresholdPercent?: string | null;
  /** How many months an unrevised التكلفة الكلية المقدرة may stand before it is an exception. */
  readonly stalenessMonths?: number | null;
}

export interface ExceptionReport<TRow> {
  readonly key: ContractingExceptionKey;
  readonly labelAr: string;
  readonly ruleAr: string;
  readonly asOfDate: string;
  readonly projectId: string | null;
  readonly olderThanDays: number | null;
  readonly thresholdPercent: string | null;
  readonly stalenessMonths: number | null;
  readonly rows: readonly TRow[];
}

export interface ExceptionSummaryRow {
  readonly key: ContractingExceptionKey;
  readonly labelAr: string;
  readonly count: number;
}

export interface ExceptionSummary {
  readonly asOfDate: string;
  readonly total: number;
  readonly reports: readonly ExceptionSummaryRow[];
}

export interface RetentionCalendarRow {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly contractTitleAr: string;
  readonly contractStatus: string;
  readonly projectId: string;
  readonly projectNameAr: string | null;
  readonly customerId: string;
  readonly retentionPercent: string;
  readonly provisionalReleasePercent: string;
  readonly provisionalHandoverDate: string | null;
  readonly finalHandoverDate: string | null;
  readonly defectsLiabilityMonths: number;
  readonly held: Money;
  readonly released: Money;
  readonly balance: Money;
  readonly provisionalReleasedToDate: Money;
  readonly event: RetentionCalendarEvent;
}

export interface RetentionPayableRow {
  readonly projectId: string;
  readonly projectNameAr: string | null;
  readonly contractId: string | null;
  readonly contractDocNo: string | null;
  readonly held: Money;
  readonly released: Money;
  readonly balance: Money;
  /** The subcontracts behind the project's balance, each on its own release clock. */
  readonly subcontracts: readonly RetentionPayableSubcontractRow[];
}

/** One subcontract's retention and the event that releases it (design §06). */
export interface RetentionPayableSubcontractRow {
  readonly subcontractId: string;
  readonly subcontractDocNo: string;
  readonly titleAr: string;
  readonly supplierId: string;
  readonly status: string;
  readonly held: Money;
  readonly released: Money;
  readonly balance: Money;
  readonly completionDate: string | null;
  readonly defectsLiabilityMonths: number;
  readonly releaseEventDate: string | null;
  readonly daysToEvent: number | null;
  readonly due: boolean;
  /** Days since the event fell due; null while it is still ahead. */
  readonly ageDays: number | null;
}

export interface RetentionCalendar {
  readonly asOfDate: string;
  readonly receivable: readonly RetentionCalendarRow[];
  readonly payable: readonly RetentionPayableRow[];
}

export interface CreateRetentionReleaseCommand {
  readonly id: string;
  readonly contractId: string;
  readonly kind: RetentionReleaseKind;
  readonly date: string;
  readonly amount: string;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

export interface UpdateRetentionReleaseCommand {
  readonly kind?: RetentionReleaseKind;
  readonly date?: string;
  readonly amount?: string;
  readonly notes?: string | null;
}

/** The release plus everything the server derives — the client supplies none of it. */
export interface RetentionReleaseView {
  readonly release: RetentionRelease;
  readonly contractTitleAr: string;
  readonly position: RetentionPosition;
  /** The most this document may release, recomputed on every read. */
  readonly cap: Money;
  readonly invoice: RetentionReleaseInvoiceStatus | null;
}

interface ContractContext {
  readonly contract: WorksContract;
  readonly boqLines: readonly BoqLine[];
  readonly adjustments: readonly BoqLineAdjustment[];
  readonly orders: readonly VariationOrder[];
  readonly certificates: readonly ProgressCertificate[];
}

export class ControlsService {
  constructor(private readonly deps: ControlsServiceDeps) {}

  private today(): string {
    return this.deps.today ? this.deps.today() : new Date().toISOString().slice(0, 10);
  }

  private async routed(key: string, fallback: string): Promise<string> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    return routedAccountId(routing, key) ?? fallback;
  }

  private async projectNames(): Promise<ReadonlyMap<string, string>> {
    const projects = (await this.deps.projects?.list()) ?? [];
    return new Map(projects.map((p) => [p.id, p.nameAr]));
  }

  private async contexts(projectId?: string | null): Promise<ContractContext[]> {
    const contracts = await this.deps.contracts.listContracts(projectId ? { projectId } : undefined);
    return Promise.all(
      contracts.map(async (contract) => {
        const [boqLines, adjustments, orders, certificates] = await Promise.all([
          this.deps.contracts.listBoqLines(contract.id),
          this.deps.contracts.listAdjustments(contract.id),
          this.deps.contracts.listVariationOrders({ contractId: contract.id }),
          this.deps.certificates.listByContract(contract.id),
        ]);
        return {
          contract,
          boqLines,
          adjustments,
          orders,
          certificates: certificates
            .filter((c) => isLiveCertificate(c) && CERTIFIED_STATUSES.has(c.status))
            .sort((a, b) => a.serial - b.serial),
        };
      }),
    );
  }

  /** The latest certificate whose quantities were measured on or before `asOfDate`. */
  private static certificateAt(ctx: ContractContext, asOfDate: string): ProgressCertificate | null {
    let found: ProgressCertificate | null = null;
    for (const certificate of ctx.certificates) {
      if (certificate.executionDate <= asOfDate) found = certificate;
    }
    return found;
  }

  private static cumulativeAt(ctx: ContractContext, boqLineId: string, asOfDate: string): Qty {
    const certificate = ControlsService.certificateAt(ctx, asOfDate);
    return certificate?.workLines.find((l) => l.boqLineId === boqLineId)?.cumulativeQty ?? Qty.zero();
  }

  private static contractedAt(ctx: ContractContext, boqLineId: string, asOfDate: string): Qty {
    return contractedQtyOf(
      { lines: ctx.boqLines, adjustments: ctx.adjustments, variationApprovals: approvalDates(ctx.orders) },
      boqLineId,
      asOfDate,
    );
  }

  // ----- 1. تجاوز الكميات التعاقدية -----------------------------------------

  async boqOverruns(params: ExceptionReportParams = {}): Promise<ExceptionReport<BoqOverrunRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const candidates: BoqOverrunCandidate[] = [];
    for (const ctx of await this.contexts(params.projectId)) {
      const certificate = ControlsService.certificateAt(ctx, asOfDate);
      if (!certificate) continue;
      for (const line of ctx.boqLines) {
        const cumulativeQty = certificate.workLines.find((l) => l.boqLineId === line.id)?.cumulativeQty ?? Qty.zero();
        if (cumulativeQty.isZero()) continue;
        candidates.push({
          contractId: ctx.contract.id,
          contractDocNo: ctx.contract.docNo,
          projectId: ctx.contract.projectId,
          boqLineId: line.id,
          code: line.code,
          descriptionAr: line.descriptionAr,
          unitLabelAr: getBoqUnitLabel(line.unit),
          certificateId: certificate.id,
          certificateDocNo: certificate.docNo,
          executionDate: certificate.executionDate,
          cumulativeQty,
          contractedQty: ControlsService.contractedAt(ctx, line.id, certificate.executionDate),
        });
      }
    }
    return this.report("boq-overrun", params, asOfDate, findBoqOverruns(candidates));
  }

  // ----- 2. مواد مصروفة لم تُستلم بالموقع --------------------------------------

  async unreceivedIssues(params: ExceptionReportParams = {}): Promise<ExceptionReport<UnreceivedRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const olderThanDays = params.olderThanDays ?? DEFAULT_UNRECEIVED_OLDER_THAN_DAYS;
    const rows =
      (await this.deps.site?.listUnreceived({
        olderThanDays,
        asOf: asOfDate,
        ...(params.projectId ? { projectId: params.projectId } : {}),
      })) ?? [];
    return {
      ...this.report("unreceived-issues", params, asOfDate, findUnreceivedIssues(rows, olderThanDays)),
      olderThanDays,
    };
  }

  // ----- 3. انحراف الاستهلاك عن الكميات النظرية ---------------------------------

  async consumptionVariances(params: ExceptionReportParams = {}): Promise<ExceptionReport<ConsumptionVarianceRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const thresholdPercent = params.thresholdPercent ?? DEFAULT_CONSUMPTION_VARIANCE_PERCENT;
    const candidates: ConsumptionVarianceCandidate[] = [];
    for (const ctx of await this.contexts(params.projectId)) {
      const measured = ctx.boqLines.filter((l) => l.theoreticalQtyPerUnit !== null);
      if (measured.length === 0) continue;
      const consumption = (await this.deps.site?.consumptionByBoqLine(ctx.contract.projectId)) ?? [];
      for (const line of measured) {
        const perUnit = line.theoreticalQtyPerUnit as Qty;
        const matches = consumption.filter(
          (row) => row.boqLineId === line.id && (line.theoreticalItemId === null || row.itemId === line.theoreticalItemId),
        );
        candidates.push({
          contractId: ctx.contract.id,
          contractDocNo: ctx.contract.docNo,
          projectId: ctx.contract.projectId,
          boqLineId: line.id,
          code: line.code,
          descriptionAr: line.descriptionAr,
          itemId: line.theoreticalItemId ?? (matches[0]?.itemId ?? ""),
          theoreticalQtyPerUnit: perUnit,
          certifiedCumulativeQty: ControlsService.cumulativeAt(ctx, line.id, asOfDate),
          consumedQty: Qty.sum(matches.map((m) => m.qty)),
          consumedCost: Money.sum(matches.map((m) => m.cost)),
        });
      }
    }
    return {
      ...this.report("consumption-variance", params, asOfDate, findConsumptionVariances(candidates, thresholdPercent)),
      thresholdPercent,
    };
  }

  // ----- 4. ساعات معدات بلا مستخلص مقابل ---------------------------------------

  async equipmentWithoutCertificate(params: ExceptionReportParams = {}): Promise<ExceptionReport<EquipmentExceptionRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const olderThanDays = params.olderThanDays ?? DEFAULT_EQUIPMENT_OLDER_THAN_DAYS;
    const contexts = await this.contexts(params.projectId);
    const byProject = new Map(contexts.map((ctx) => [ctx.contract.projectId, ctx]));
    const logs: readonly EquipmentLog[] =
      (await this.deps.equipmentLogs?.list({
        status: "confirmed",
        ...(params.projectId ? { projectId: params.projectId } : {}),
      })) ?? [];
    const candidates: EquipmentExceptionCandidate[] = [];
    for (const log of logs) {
      if (log.date > asOfDate) continue;
      const ctx =
        contexts.find((c) => c.boqLines.some((l) => l.id === log.boqLineId)) ?? byProject.get(log.projectId) ?? null;
      const line = ctx?.boqLines.find((l) => l.id === log.boqLineId) ?? null;
      candidates.push({
        contractId: ctx?.contract.id ?? null,
        contractDocNo: ctx?.contract.docNo ?? null,
        contractStatus: ctx?.contract.status ?? null,
        projectId: log.projectId,
        equipmentLogId: log.id,
        docNo: log.docNo,
        assetId: log.assetId,
        date: log.date,
        hours: log.hours,
        amount: log.amount,
        boqLineId: log.boqLineId,
        code: line?.code ?? null,
        descriptionAr: line?.descriptionAr ?? null,
        certifiedCumulativeAtLog: ctx && log.boqLineId ? ControlsService.cumulativeAt(ctx, log.boqLineId, log.date) : Qty.zero(),
        certifiedCumulativeNow: ctx && log.boqLineId ? ControlsService.cumulativeAt(ctx, log.boqLineId, asOfDate) : Qty.zero(),
        ageDays: daysBetweenDates(log.date, asOfDate),
      });
    }
    return {
      ...this.report(
        "equipment-without-certificate",
        params,
        asOfDate,
        findEquipmentWithoutCertificate(candidates, olderThanDays),
      ),
      olderThanDays,
    };
  }

  // ----- 5. أوامر تغيير معتمدة بعد التنفيذ -------------------------------------

  async lateVariationApprovals(params: ExceptionReportParams = {}): Promise<ExceptionReport<LateVariationRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const candidates: LateVariationCandidate[] = [];
    for (const ctx of await this.contexts(params.projectId)) {
      for (const order of ctx.orders) {
        if (order.status !== "approved" || order.approvedAt === null || order.approvedAt > asOfDate) continue;
        const touched = new Set<string>([
          ...ctx.boqLines.filter((l) => l.variationOrderId === order.id).map((l) => l.id),
          ...ctx.adjustments.filter((a) => a.variationOrderId === order.id).map((a) => a.boqLineId),
        ]);
        if (touched.size === 0) continue;
        for (const certificate of ctx.certificates) {
          if (certificate.executionDate > asOfDate) continue;
          for (const boqLineId of touched) {
            const workLine = certificate.workLines.find((l) => l.boqLineId === boqLineId);
            if (!workLine || workLine.cumulativeQty.isZero()) continue;
            candidates.push({
              contractId: ctx.contract.id,
              contractDocNo: ctx.contract.docNo,
              projectId: ctx.contract.projectId,
              variationOrderId: order.id,
              variationDocNo: order.docNo,
              variationTitleAr: order.titleAr,
              approvedAt: order.approvedAt,
              boqLineId,
              code: workLine.code,
              descriptionAr: workLine.descriptionAr,
              certificateId: certificate.id,
              certificateDocNo: certificate.docNo,
              executionDate: certificate.executionDate,
              cumulativeQty: workLine.cumulativeQty,
              contractedQtyAtExecution: ControlsService.contractedAt(ctx, boqLineId, certificate.executionDate),
            });
          }
        }
      }
    }
    return this.report("late-variation-approvals", params, asOfDate, findLateVariationApprovals(candidates));
  }

  // ----- 6. ضمان محتجز مفرج عنه قبل الميعاد ------------------------------------

  async earlyRetentionReleases(params: ExceptionReportParams = {}): Promise<ExceptionReport<EarlyReleaseRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const releases = await this.deps.releases.list(params.projectId ? { projectId: params.projectId } : undefined);
    const contracts = new Map((await this.deps.contracts.listContracts()).map((c) => [c.id, c]));
    const candidates: EarlyReleaseCandidate[] = releases
      .filter((r) => r.date <= asOfDate)
      .map((r) => ({
        releaseId: r.id,
        docNo: r.docNo,
        party: "customer" as const,
        counterpartyNameAr: null,
        contractId: r.contractId,
        contractDocNo: contracts.get(r.contractId)?.docNo ?? r.contractDocNo,
        projectId: r.projectId,
        kind: r.kind,
        date: r.date,
        amount: r.amount,
        releaseEventDate: r.releaseEventDate,
        status: r.status,
      }));
    candidates.push(...(await this.subcontractReleaseCandidates(asOfDate, params.projectId ?? null)));
    return this.report("early-retention-release", params, asOfDate, findEarlyRetentionReleases(candidates));
  }

  /** The payable side: a release to a subcontractor before its own event fell due. */
  private async subcontractReleaseCandidates(
    asOfDate: string,
    projectId: string | null,
  ): Promise<EarlyReleaseCandidate[]> {
    if (!this.deps.subcontracts) return [];
    const rows: EarlyReleaseCandidate[] = [];
    for (const view of await this.deps.subcontracts.list()) {
      const subcontract = view.subcontract;
      if (projectId !== null && subcontract.projectId !== projectId) continue;
      for (const release of subcontract.retentionReleases) {
        if (release.date > asOfDate) continue;
        rows.push({
          releaseId: release.id,
          docNo: release.invoiceDocNo ?? subcontract.docNo,
          party: "subcontractor",
          counterpartyNameAr: view.supplierNameAr,
          contractId: subcontract.contractId,
          contractDocNo: subcontract.docNo,
          projectId: subcontract.projectId,
          kind: release.kind,
          date: release.date,
          amount: release.amount,
          releaseEventDate: release.releaseEventDate,
          status: "released",
        });
      }
    }
    return rows;
  }

  // ----- 7. تجاوز التكلفة للتقدير ----------------------------------------------

  /**
   * The estimate is the denominator of every percentage of completion the run
   * posts. This is the only report that questions it: cost that has run ahead
   * of what the certified work has earned, and an estimate nobody has revised
   * for months. Both mean the same thing — the forecast no longer describes
   * the contract, so every revenue figure derived from it is stale too.
   */
  async costOverrunsVsEstimate(params: ExceptionReportParams = {}): Promise<ExceptionReport<CostOverrunRow>> {
    const asOfDate = params.asOfDate ?? this.today();
    const thresholdPercent = params.thresholdPercent ?? DEFAULT_COST_OVERRUN_PERCENT;
    const stalenessMonths = params.stalenessMonths ?? DEFAULT_ESTIMATE_STALENESS_MONTHS;
    const candidates: CostOverrunCandidate[] = [];
    for (const ctx of await this.contexts(params.projectId)) {
      if (ctx.contract.status !== "active") continue;
      // A contract with no التكلفة الكلية المقدرة at all has nothing to be
      // measured against, and the recognition run already refuses it by name —
      // firing here too would bury the contracts whose estimate IS wrong under
      // the ones that never had one.
      const estimatedTotalCost = ctx.contract.estimatedTotalCost;
      if (estimatedTotalCost === null || estimatedTotalCost.scaled <= 0n) continue;
      const certificate = ControlsService.certificateAt(ctx, asOfDate);
      const revisions = [...ctx.contract.budgetRevisions].sort((a, b) => a.date.localeCompare(b.date));
      const lastEstimateRevisionDate =
        revisions[revisions.length - 1]?.date ?? ctx.contract.activatedAt ?? ctx.contract.signedDate ?? null;
      candidates.push({
        contractId: ctx.contract.id,
        contractDocNo: ctx.contract.docNo,
        contractTitleAr: ctx.contract.titleAr,
        projectId: ctx.contract.projectId,
        status: ctx.contract.status,
        costToDate: (await this.deps.projectCostToDate?.(ctx.contract.projectId, asOfDate)) ?? Money.zero(),
        estimatedTotalCost,
        certifiedGrossWorks: certificate?.computed.grossWorks ?? Money.zero(),
        contractValue: contractValueAsOf(ctx.boqLines, ctx.orders, asOfDate),
        lastEstimateRevisionDate,
        monthsSinceEstimateRevision:
          lastEstimateRevisionDate === null ? null : monthsBetweenDates(lastEstimateRevisionDate, asOfDate),
      });
    }
    return {
      ...this.report(
        "cost-overrun-vs-estimate",
        params,
        asOfDate,
        findCostOverrunsVsEstimate(candidates, thresholdPercent, stalenessMonths),
      ),
      thresholdPercent,
      stalenessMonths,
    };
  }

  async summary(asOfDate?: string | null): Promise<ExceptionSummary> {
    const on = asOfDate ?? this.today();
    const params = { asOfDate: on };
    const counts = await Promise.all([
      this.boqOverruns(params),
      this.unreceivedIssues(params),
      this.consumptionVariances(params),
      this.equipmentWithoutCertificate(params),
      this.lateVariationApprovals(params),
      this.earlyRetentionReleases(params),
      this.costOverrunsVsEstimate(params),
    ]);
    const reports = CONTRACTING_EXCEPTION_KEYS.map((key, index) => ({
      key,
      labelAr: getContractingExceptionDefinition(key).labelAr,
      count: counts[index]?.rows.length ?? 0,
    }));
    return { asOfDate: on, total: reports.reduce((sum, r) => sum + r.count, 0), reports };
  }

  private report<TRow>(
    key: ContractingExceptionKey,
    params: ExceptionReportParams,
    asOfDate: string,
    rows: readonly TRow[],
  ): ExceptionReport<TRow> {
    const definition = getContractingExceptionDefinition(key);
    return {
      key,
      labelAr: definition.labelAr,
      ruleAr: definition.ruleAr,
      asOfDate,
      projectId: params.projectId ?? null,
      olderThanDays: null,
      thresholdPercent: null,
      stalenessMonths: null,
      rows,
    };
  }

  // ----- المحتجزات: position, calendar --------------------------------------

  /**
   * What the ledger says is held on a project. Derived from POSTED lines on the
   * retention account, never from a stored total — the certificates debit it
   * and the release invoices credit it, so this figure is the control account.
   */
  async retentionPosition(projectId: string): Promise<RetentionPosition> {
    const accountId = await this.routed("contracting.retention_receivable", "1150");
    const lines = (await this.deps.gl.ledger.listLines?.({ accountIds: [accountId], projectId })) ?? [];
    let debits = 0n;
    let credits = 0n;
    for (const line of lines) {
      debits += line.debit.scaled;
      credits += line.credit.scaled;
    }
    return retentionPositionOf(Money.fromScaled(debits), Money.fromScaled(credits));
  }

  private async provisionalReleasedToDate(contractId: string): Promise<Money> {
    const rows = await this.deps.releases.list({ contractId, status: "released" });
    return Money.sum(rows.filter((r) => r.kind === "provisional").map((r) => r.amount));
  }

  async calendar(asOfDate?: string | null): Promise<RetentionCalendar> {
    const on = asOfDate ?? this.today();
    const [contracts, names] = await Promise.all([this.deps.contracts.listContracts(), this.projectNames()]);
    const receivable: RetentionCalendarRow[] = [];
    for (const contract of contracts) {
      const position = await this.retentionPosition(contract.projectId);
      const provisionalReleasedToDate = await this.provisionalReleasedToDate(contract.id);
      if (position.held.scaled === 0n && position.released.scaled === 0n) continue;
      receivable.push({
        contractId: contract.id,
        contractDocNo: contract.docNo,
        contractTitleAr: contract.titleAr,
        contractStatus: contract.status,
        projectId: contract.projectId,
        projectNameAr: names.get(contract.projectId) ?? null,
        customerId: contract.customerId,
        retentionPercent: contract.retentionPercent,
        provisionalReleasePercent: contract.provisionalReleasePercent,
        provisionalHandoverDate: contract.provisionalHandoverDate,
        finalHandoverDate: contract.finalHandoverDate,
        defectsLiabilityMonths: contract.defectsLiabilityMonths,
        held: position.held,
        released: position.released,
        balance: position.balance,
        provisionalReleasedToDate,
        event: nextRetentionEvent({
          provisionalHandoverDate: contract.provisionalHandoverDate,
          finalHandoverDate: contract.finalHandoverDate,
          defectsLiabilityMonths: contract.defectsLiabilityMonths,
          position,
          provisionalReleasePercent: contract.provisionalReleasePercent,
          provisionalReleasedToDate,
          asOfDate: on,
        }),
      });
    }
    return { asOfDate: on, receivable, payable: await this.payableRows(contracts, names, on) };
  }

  /**
   * The payable side (2195). Read off the LEDGER by account and project rather
   * than out of the subcontract module's tables: this screen must keep showing
   * what was withheld from subcontractors whichever slice wrote it.
   */
  private async payableRows(
    contracts: readonly WorksContract[],
    names: ReadonlyMap<string, string>,
    asOfDate: string,
  ): Promise<RetentionPayableRow[]> {
    const accountId = await this.routed("contracting.retention_payable", "2195");
    const lines = (await this.deps.gl.ledger.listLines?.({ accountIds: [accountId] })) ?? [];
    const byProject = new Map<string, { debits: bigint; credits: bigint }>();
    for (const line of lines) {
      if (line.projectId === null) continue;
      const bucket = byProject.get(line.projectId) ?? { debits: 0n, credits: 0n };
      bucket.debits += line.debit.scaled;
      bucket.credits += line.credit.scaled;
      byProject.set(line.projectId, bucket);
    }
    const subcontracts = (await this.deps.subcontracts?.list()) ?? [];
    const rows: RetentionPayableRow[] = [];
    for (const [projectId, bucket] of byProject) {
      const position = retentionPayablePositionOf(Money.fromScaled(bucket.debits), Money.fromScaled(bucket.credits));
      const contract = contracts.find((c) => c.projectId === projectId) ?? null;
      rows.push({
        projectId,
        projectNameAr: names.get(projectId) ?? null,
        contractId: contract?.id ?? null,
        contractDocNo: contract?.docNo ?? null,
        held: position.held,
        released: position.released,
        balance: position.balance,
        subcontracts: subcontracts
          .filter((v) => v.subcontract.projectId === projectId)
          .filter((v) => v.retention.held.scaled !== 0n || v.retention.released.scaled !== 0n)
          .map((v) => subcontractRetentionClock(v, asOfDate)),
      });
    }
    return rows;
  }

  // ----- المحتجزات: the release document ------------------------------------

  async listReleases(filter?: RetentionReleaseListFilter): Promise<RetentionReleaseView[]> {
    const rows = await this.deps.releases.list(filter);
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async getRelease(idOrDocNo: string): Promise<RetentionReleaseView> {
    return this.view(await this.require(idOrDocNo));
  }

  private async require(idOrDocNo: string): Promise<RetentionRelease> {
    const found =
      (await this.deps.releases.findById(idOrDocNo)) ?? (await this.deps.releases.findByDocNo(idOrDocNo));
    if (!found) throw new RetentionReleaseNotFoundError(idOrDocNo);
    return found;
  }

  private async view(release: RetentionRelease): Promise<RetentionReleaseView> {
    const contract = await this.deps.contracts.findContractById(release.contractId);
    const position = await this.retentionPosition(release.projectId);
    const cap = releaseCapOf({
      kind: release.kind,
      position,
      provisionalReleasePercent: contract?.provisionalReleasePercent ?? "50",
      provisionalReleasedToDate: await this.provisionalReleasedToDate(release.contractId),
    });
    return {
      release,
      contractTitleAr: contract?.titleAr ?? release.contractId,
      position,
      // A draft has not moved the ledger yet, so its own amount is still inside the headroom.
      cap: release.status === "draft" ? cap : Money.fromScaled(cap.scaled + release.amount.scaled),
      invoice: release.invoiceId ? ((await this.deps.invoicing?.status(release.invoiceId)) ?? null) : null,
    };
  }

  /** The cap for a release NOT yet posted — the headroom a new or draft document has. */
  async releaseHeadroom(contractId: string, kind: RetentionReleaseKind): Promise<{ position: RetentionPosition; cap: Money }> {
    const contract = await this.deps.contracts.findContractById(contractId);
    if (!contract) throw new InvalidRetentionReleaseError([`العقد "${contractId}" غير موجود`]);
    const position = await this.retentionPosition(contract.projectId);
    return {
      position,
      cap: releaseCapOf({
        kind,
        position,
        provisionalReleasePercent: contract.provisionalReleasePercent,
        provisionalReleasedToDate: await this.provisionalReleasedToDate(contract.id),
      }),
    };
  }

  async createRelease(cmd: CreateRetentionReleaseCommand): Promise<RetentionReleaseView> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(cmd.date)) reasons.push("تاريخ الإفراج مطلوب بصيغة YYYY-MM-DD");
    const contract = await this.deps.contracts.findContractById(cmd.contractId);
    if (!contract) reasons.push(`العقد "${cmd.contractId}" غير موجود`);
    let amount = Money.zero();
    try {
      amount = Money.fromMajor(cmd.amount);
    } catch {
      reasons.push("قيمة الإفراج يجب أن تكون رقمًا");
    }
    if (amount.scaled <= 0n) reasons.push("قيمة الإفراج يجب أن تكون أكبر من صفر");
    if (reasons.length > 0 || !contract) throw new InvalidRetentionReleaseError(reasons);

    const releaseEventDate = releaseEventDateOf(cmd.kind, contract);
    await this.assertWithinCap(contract, cmd.kind, amount);

    return this.deps.releases.transaction(async () => {
      if (await this.deps.releases.findById(cmd.id)) {
        throw new InvalidRetentionReleaseError([`مستند الإفراج "${cmd.id}" موجود بالفعل`]);
      }
      const number = await this.deps.numbering.next(RETENTION_RELEASE_SEQUENCE);
      const release: RetentionRelease = {
        id: cmd.id,
        docNo: number.formatted,
        contractId: contract.id,
        contractDocNo: contract.docNo,
        projectId: contract.projectId,
        customerId: contract.customerId,
        kind: cmd.kind,
        date: cmd.date,
        amount,
        releaseEventDate,
        earlyRelease: isEarlyRelease(cmd.date, releaseEventDate),
        status: "draft",
        notes: cmd.notes ?? null,
        invoiceId: null,
        invoiceDocNo: null,
        releasedAt: null,
        releasedBy: null,
        approvedBy: null,
        cancelledAt: null,
        createdAt: this.today(),
        createdBy: cmd.createdBy ?? null,
      };
      await this.deps.releases.save(release);
      return this.view(release);
    });
  }

  async updateRelease(idOrDocNo: string, cmd: UpdateRetentionReleaseCommand): Promise<RetentionReleaseView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft") throw new InvalidRetentionReleaseTransitionError(current.status, "draft");
    const contract = await this.deps.contracts.findContractById(current.contractId);
    if (!contract) throw new InvalidRetentionReleaseError([`العقد "${current.contractId}" غير موجود`]);
    const reasons: string[] = [];
    const date = cmd.date ?? current.date;
    if (!ISO_DATE.test(date)) reasons.push("تاريخ الإفراج مطلوب بصيغة YYYY-MM-DD");
    let amount = current.amount;
    if (cmd.amount !== undefined) {
      try {
        amount = Money.fromMajor(cmd.amount);
      } catch {
        reasons.push("قيمة الإفراج يجب أن تكون رقمًا");
      }
    }
    if (amount.scaled <= 0n) reasons.push("قيمة الإفراج يجب أن تكون أكبر من صفر");
    if (reasons.length > 0) throw new InvalidRetentionReleaseError(reasons);

    const kind = cmd.kind ?? current.kind;
    await this.assertWithinCap(contract, kind, amount);
    const releaseEventDate = releaseEventDateOf(kind, contract);
    const next: RetentionRelease = {
      ...current,
      kind,
      date,
      amount,
      releaseEventDate,
      earlyRelease: isEarlyRelease(date, releaseEventDate),
      notes: cmd.notes !== undefined ? cmd.notes : current.notes,
    };
    await this.deps.releases.save(next);
    return this.view(next);
  }

  /**
   * الإفراج — the release is recorded by ISSUING the receivable, not by posting
   * a journal entry beside it: the invoice's own Dr AR / Cr 1150 is the reclass,
   * and its due date is the release event, which is the whole point of the
   * document (design §06).
   */
  async release(
    idOrDocNo: string,
    actor: RetentionReleaseActor,
    options: { approvedBy?: string | null } = {},
  ): Promise<RetentionReleaseView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft") throw new InvalidRetentionReleaseTransitionError(current.status, "released");
    const invoicing = this.deps.invoicing;
    if (!invoicing) {
      throw new InvalidRetentionReleaseError(["إصدار مستند الإفراج عن المحتجزات غير مُفعّل على هذا الخادم."]);
    }
    const contract = await this.deps.contracts.findContractById(current.contractId);
    if (!contract) throw new InvalidRetentionReleaseError([`العقد "${current.contractId}" غير موجود`]);

    // Re-derived at release time: the handover may have been recorded, and the
    // balance may have moved, since the draft was written.
    const releaseEventDate = releaseEventDateOf(current.kind, contract);
    await this.assertWithinCap(contract, current.kind, current.amount);

    // فصل المهام. Enforced on the USER id, not on a role: an admin wildcard
    // grants every permission and would otherwise walk straight through the
    // only check standing between one person and the retention account.
    const waived = this.deps.segregationWaived ? await this.deps.segregationWaived(actor) : false;
    if (!waived && current.createdBy !== null && current.createdBy === actor.userId) {
      throw new InvalidRetentionReleaseError([
        "لا يمكن لمن أنشأ مستند الإفراج أن يفرج عنه — يلزم مستخدم آخر.",
      ]);
    }

    // الإفراج المبكر. Money let go before the event that entitles anyone to it
    // carries a named second approval of its own, and the approver may be
    // neither the author of the document nor the person releasing it.
    const early = isEarlyRelease(current.date, releaseEventDate);
    const approvedBy = options.approvedBy?.trim() ? options.approvedBy.trim() : null;
    if (early && !waived) {
      if (approvedBy === null) {
        throw new InvalidRetentionReleaseError([
          `الإفراج قبل ميعاد الاستحقاق (${releaseEventDate ?? "غير محدد"}) يحتاج اعتماد مستخدم ثانٍ.`,
        ]);
      }
      if (approvedBy === current.createdBy || approvedBy === actor.userId) {
        throw new InvalidRetentionReleaseError([
          "معتمد الإفراج المبكر يجب أن يكون مستخدمًا غير مُنشئ المستند وغير المُفرِج.",
        ]);
      }
    }
    const retentionAccountId = await this.routed("contracting.retention_receivable", "1150");

    const saved = await this.deps.releases.transaction(async () => {
      const invoice = await invoicing.issue({
        releaseId: current.id,
        releaseDocNo: current.docNo,
        contractDocNo: contract.docNo,
        customerId: contract.customerId,
        projectId: current.projectId,
        date: current.date,
        dueDate: releaseEventDate ?? current.date,
        amount: current.amount,
        retentionAccountId,
        itemId: this.deps.releaseItemId ?? RETENTION_RELEASE_ITEM_ID,
        lineDescriptionAr: `إفراج عن محتجزات — ${contract.docNo}`,
        memoAr: `${current.docNo} — إفراج عن المحتجزات الضمانية، ${contract.titleAr}.`,
        actor: actor.userId,
      });
      const next: RetentionRelease = {
        ...current,
        status: "released",
        releaseEventDate,
        earlyRelease: early,
        invoiceId: invoice.invoiceId,
        invoiceDocNo: invoice.invoiceDocNo,
        releasedAt: this.today(),
        releasedBy: actor.userId,
        approvedBy: early ? approvedBy : null,
      };
      await this.deps.releases.save(next);
      return next;
    });
    await recordTransition(this.deps.audit, {
      entityType: "RETENTION_RELEASE",
      entityId: saved.id,
      action: "RELEASE",
      actor: actor.userId,
      severity: "WARNING",
      details: {
        docNo: saved.docNo,
        contractId: saved.contractId,
        projectId: saved.projectId,
        amount: saved.amount.toString(),
        date: saved.date,
        kind: saved.kind,
        releaseEventDate: saved.releaseEventDate,
        earlyRelease: saved.earlyRelease,
        createdBy: saved.createdBy,
        approvedBy: saved.approvedBy,
        invoiceDocNo: saved.invoiceDocNo,
      },
    });
    return this.view(saved);
  }

  async cancelRelease(idOrDocNo: string): Promise<RetentionReleaseView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft") throw new InvalidRetentionReleaseTransitionError(current.status, "cancelled");
    const next: RetentionRelease = { ...current, status: "cancelled", cancelledAt: this.today() };
    await this.deps.releases.save(next);
    return this.view(next);
  }

  private async assertWithinCap(
    contract: WorksContract,
    kind: RetentionReleaseKind,
    amount: Money,
  ): Promise<void> {
    const position = await this.retentionPosition(contract.projectId);
    const cap = releaseCapOf({
      kind,
      position,
      provisionalReleasePercent: contract.provisionalReleasePercent,
      provisionalReleasedToDate: await this.provisionalReleasedToDate(contract.id),
    });
    if (amount.scaled <= cap.scaled) return;
    throw new RetentionReleaseExceedsBalanceError(
      amount.toString(),
      cap.toString(),
      kind === "provisional"
        ? `قيمة الإفراج ${minor(amount)} تتجاوز الحد المسموح ${minor(cap)} — الإفراج عند التسليم الابتدائي محدود بنسبة ${contract.provisionalReleasePercent}٪ من إجمالي المحتجزات (${minor(position.held)}).`
        : `قيمة الإفراج ${minor(amount)} تتجاوز رصيد المحتجزات المتاح ${minor(cap)}.`,
    );
  }

  // ----- التسليم والكميات النظرية -------------------------------------------

  /**
   * التسليم الابتدائي والنهائي, recorded when they happen. They are NOT
   * commercial terms frozen at activation: the handover of a finished contract
   * is the event the whole retention calendar hangs on, so a completed contract
   * must still be able to record it.
   */
  async recordHandover(
    idOrDocNo: string,
    input: {
      provisionalHandoverDate?: string | null;
      finalHandoverDate?: string | null;
      provisionalReleasePercent?: string;
    },
  ): Promise<WorksContract> {
    const contract =
      (await this.deps.contracts.findContractById(idOrDocNo)) ??
      (await this.deps.contracts.findContractByDocNo(idOrDocNo));
    if (!contract) throw new InvalidRetentionReleaseError([`العقد "${idOrDocNo}" غير موجود`]);
    const reasons: string[] = [];
    const provisional =
      input.provisionalHandoverDate !== undefined ? input.provisionalHandoverDate : contract.provisionalHandoverDate;
    const final = input.finalHandoverDate !== undefined ? input.finalHandoverDate : contract.finalHandoverDate;
    if (provisional !== null && !ISO_DATE.test(provisional)) reasons.push("تاريخ التسليم الابتدائي مطلوب بصيغة YYYY-MM-DD");
    if (final !== null && !ISO_DATE.test(final)) reasons.push("تاريخ التسليم النهائي مطلوب بصيغة YYYY-MM-DD");
    if (provisional !== null && final !== null && final < provisional) {
      reasons.push("تاريخ التسليم النهائي يسبق تاريخ التسليم الابتدائي");
    }
    const percent = input.provisionalReleasePercent ?? contract.provisionalReleasePercent;
    if (!/^\d{1,3}(\.\d{1,6})?$/.test(percent) || Number.parseFloat(percent) > 100) {
      reasons.push("نسبة الإفراج عند التسليم الابتدائي يجب أن تكون نسبة رقمية لا تتجاوز 100%");
    }
    if (reasons.length > 0) throw new InvalidRetentionReleaseError(reasons);
    const next: WorksContract = {
      ...contract,
      provisionalHandoverDate: provisional,
      finalHandoverDate: final,
      provisionalReleasePercent: percent,
    };
    await this.deps.contracts.saveContract(next);
    return next;
  }

  /**
   * الكمية النظرية لكل وحدة on a BOQ line. Reporting metadata only — it never
   * enters a contracted quantity, a certificate or a posting — which is why it
   * stays editable after the contract is active, unlike the bill itself.
   */
  async setTheoreticalQuantities(
    contractIdOrDocNo: string,
    rows: readonly { boqLineId: string; theoreticalQtyPerUnit: string | null; theoreticalItemId: string | null }[],
  ): Promise<BoqLine[]> {
    const contract =
      (await this.deps.contracts.findContractById(contractIdOrDocNo)) ??
      (await this.deps.contracts.findContractByDocNo(contractIdOrDocNo));
    if (!contract) throw new InvalidRetentionReleaseError([`العقد "${contractIdOrDocNo}" غير موجود`]);
    const lines = await this.deps.contracts.listBoqLines(contract.id);
    const reasons: string[] = [];
    const patched: BoqLine[] = [];
    for (const row of rows) {
      const line = lines.find((l) => l.id === row.boqLineId);
      if (!line) {
        reasons.push(`البند "${row.boqLineId}" غير موجود في جدول الكميات`);
        continue;
      }
      let perUnit: Qty | null = null;
      if (row.theoreticalQtyPerUnit !== null && row.theoreticalQtyPerUnit !== "") {
        try {
          perUnit = Qty.fromMajor(row.theoreticalQtyPerUnit);
        } catch {
          reasons.push(`الكمية النظرية للبند "${line.code}" يجب أن تكون رقمًا`);
        }
        if (perUnit?.isNegative()) reasons.push(`الكمية النظرية للبند "${line.code}" لا يمكن أن تكون سالبة`);
      }
      patched.push({ ...line, theoreticalQtyPerUnit: perUnit, theoreticalItemId: row.theoreticalItemId ?? null });
    }
    if (reasons.length > 0) throw new InvalidRetentionReleaseError(reasons);
    if (patched.length > 0) await this.deps.contracts.addBoqLines(patched);
    return this.deps.contracts.listBoqLines(contract.id);
  }
}
