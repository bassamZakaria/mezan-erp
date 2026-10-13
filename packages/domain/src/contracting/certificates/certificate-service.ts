import { Money, Qty } from "../../money/index.js";
import type { AccountRepository } from "../../accounts/account.js";
import {
  DEFAULT_ACCOUNT_ROUTING_OPTIONS,
  routedAccountId,
  type AccountRoutingRepository,
} from "../../accounts/account-routing.js";
import type { ProjectRepository } from "../../projects/project.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import type { NextNumberService } from "../../numbering/index.js";
import {
  postJournalEntry,
  reverseJournalEntry,
  type JournalLineInput,
  type JournalPostingDeps,
} from "../../gl/index.js";
import type { BoqUnit } from "../contracts/boq-unit.js";
import type { BoqLine, WorksContract, WorksContractStore } from "../contracts/contract.js";
import {
  approvalDates,
  computeApprovedVariationsValue,
  computeContractValue,
  computeContractedQuantities,
} from "../contracts/index.js";
import {
  EDITABLE_CERTIFICATE_STATUSES,
  getProgressCertificateStatusLabel,
  isLiveCertificate,
  type CertificateComputation,
  type CertificateMaterialLine,
  type CertificateWorkLine,
  type ProgressCertificate,
  type ProgressCertificateDerivedStatus,
  type ProgressCertificateListFilter,
  type ProgressCertificateStatus,
  type ProgressCertificateStore,
} from "./certificate.js";
import {
  completionPercentOf,
  completionPercentOfMoney,
  computeCertificate,
  extendQty,
  percentOf,
  subtract,
} from "./amounts.js";
import {
  CertificateDateOrderError,
  CertificateQuantityError,
  CertificateSegregationError,
  InvalidProgressCertificateError,
  InvalidProgressCertificateTransitionError,
  LaterCertificateExistsError,
  ProgressCertificateNotFoundError,
} from "./errors.js";
import { tenantTodayIso } from "../../dates.js";

/**
 * المستخلص — the use cases and the ledger behind them (design §04).
 *
 * Nothing the client sends is trusted where the server can derive it: the
 * previous cumulative, the contracted quantity, the retention held, the
 * advance outstanding and every deduction are computed here from posted
 * documents. The ONLY figures a caller supplies are this period's quantities
 * and the four manual cumulative deduction amounts.
 */

/** The document type stamped on the deductions entry. */
export const PROGRESS_CERTIFICATE_DOC_TYPE = "PROGRESS_CERTIFICATE";
const CERTIFICATE_SEQUENCE = "PROGRESS_CERTIFICATE";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The person acting. `wildcardAdmin` is the tenant admin whose grant is `"*"`.
 *
 * Holding the wildcard is NOT by itself an exemption from فصل المهام: the
 * `segregationWaived` dep decides, and it reads the tenant setting
 * `contracting.singleOperatorMode` (default false). A one-person install turns
 * it on and the waiver applies; everywhere else the admin is held to
 * preparer ≠ certifier ≠ approver like anyone.
 */
export interface CertificateActor {
  readonly userId: string;
  readonly wildcardAdmin: boolean;
}

/** What the invoice generated from an approved certificate looks like on the way in. */
export interface CertificateInvoiceCommand {
  readonly certificateId: string;
  readonly certificateDocNo: string;
  readonly serial: number;
  readonly contractDocNo: string;
  readonly customerId: string;
  readonly projectId: string;
  readonly date: string;
  readonly dueDate: string;
  readonly amount: Money;
  /** What the line is actually raised at: 14, or 5.04 on the transitional basis. */
  readonly taxRatePercent: string;
  readonly revenueAccountId: string;
  readonly lineDescriptionAr: string;
  readonly memoAr: string;
  /**
   * WHO approved the certificate. The generated invoice's own audit row named
   * `system`, so the one act that created a live receivable was traceable to
   * nobody.
   */
  readonly actor?: string | null;
}

export interface CertificateInvoiceResult {
  readonly invoiceId: string;
  readonly invoiceDocNo: string;
  /** The receivable account the invoice debited — the deductions entry credits the same one. */
  readonly arAccountId: string;
  readonly total: Money;
}

export interface CertificateInvoiceStatus {
  readonly invoiceId: string;
  readonly docNo: string | null;
  readonly total: Money;
  readonly amountPaid: Money;
  readonly remainingBalance: Money;
  readonly dueDate: string | null;
  readonly status: string;
}

/**
 * The sales-invoice engine, as the certificate sees it. The certificate never
 * builds an invoice itself — D-02 keeps the invoice a thin derived document so
 * the AR, aging, ETA and allocation machinery is reused unchanged.
 */
export interface CertificateInvoicingPort {
  issue(cmd: CertificateInvoiceCommand): Promise<CertificateInvoiceResult>;
  status(invoiceId: string): Promise<CertificateInvoiceStatus | null>;
  /**
   * Records the posted deductions as settled against the invoice, so the AR
   * sub-ledger's outstanding balance equals the net payable and still ties to
   * GL 1105 — the deductions credited AR in the ledger, and a sub-ledger that
   * ignored them would read permanently high.
   */
  settle(invoiceId: string, amount: Money, reference: string): Promise<void>;
  /**
   * The sales-invoice void path — the SAME one /sales/invoices/:id/void uses,
   * so the reversal is a linked mirror entry and the receivable sub-ledger
   * leaves with it. Optional: a server without it simply refuses the void.
   */
  voidInvoice?(invoiceId: string, date: string, reasonAr: string): Promise<void>;
}

/** Slice 5A's advance guarantee, reduced in step with recovery (Law 182/2018 Art. 44). */
export interface CertificateGuaranteePort {
  reduceAdvanceGuarantee(input: {
    contractId: string;
    /** The register links a letter to a project OR to a contract; both are given. */
    projectId: string;
    date: string;
    amount: Money;
    sourceRef: string;
    /** WHO approved the certificate that drove the reduction. */
    actor?: string | null;
  }): Promise<void>;
  /**
   * The mirror of {@link reduceAdvanceGuarantee}, for a voided certificate. A
   * negative reduction would corrupt the reduction history, so the register
   * records a RESTORE of its own.
   */
  restoreAdvanceGuarantee?(input: {
    contractId: string;
    projectId: string;
    date: string;
    amount: Money;
    sourceRef: string;
  }): Promise<void>;
}

export interface CertificateServiceDeps {
  readonly store: ProgressCertificateStore;
  readonly contracts: WorksContractStore;
  readonly numbering: NextNumberService;
  readonly gl: JournalPostingDeps;
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  readonly invoicing?: CertificateInvoicingPort;
  readonly guarantees?: CertificateGuaranteePort;
  /** The chart, for the مستخلص تنفيذي's project-level actual cost. */
  readonly accounts?: Pick<AccountRepository, "list">;
  readonly projects?: Pick<ProjectRepository, "list">;
  /**
   * سعر الائتمان والخصم المعلن من البنك المركزي — the rate Law 182/2018 Art. 45
   * compensates late payment at. Null when the tenant has not set it, in which
   * case the compensation is reported as zero and the screen says «غير مُعد».
   */
  readonly cbeCreditDiscountRatePercent?: () => Promise<string | null>;
  /** سجل العمليات الحساسة — every transition below is recorded against the certificate. */
  readonly audit?: AuditSink;
  /**
   * Whether the segregation-of-duties rules are waived for this actor — the
   * tenant setting `contracting.singleOperatorMode`, resolved per call. False
   * (the default) subjects the wildcard admin to the same rules as anyone.
   */
  readonly segregationWaived?: (actor: CertificateActor) => Promise<boolean>;
  readonly today?: () => string;
}

export interface CertificateWorkLineInput {
  readonly boqLineId: string;
  readonly thisPeriodQty: string;
}

export interface CertificateMaterialLineInput {
  readonly materialKey: string;
  readonly descriptionAr: string;
  readonly unit: string;
  readonly qty: string;
  readonly unitRate: string;
}

export interface CertificateDraftInput {
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly executionDate?: string | null;
  readonly isFinal?: boolean;
  readonly workLines?: readonly CertificateWorkLineInput[];
  readonly materialLines?: readonly CertificateMaterialLineInput[];
  readonly penaltiesCumulative?: string;
  readonly suspendedCumulative?: string;
  readonly employerMaterialsCumulative?: string;
  readonly waterElectricityCumulative?: string;
  readonly notes?: string | null;
}

/** A PATCH applies only what it carries, and only to a certificate still open for entry. */
export interface UpdateCertificateCommand extends Partial<CertificateDraftInput> {}

export interface CreateCertificateCommand extends CertificateDraftInput {
  readonly id: string;
  readonly contractId: string;
}

export interface PreviewCertificateCommand extends CertificateDraftInput {
  readonly contractId: string;
  /** Preview an EXISTING certificate's edit rather than a new one. */
  readonly certificateId?: string | null;
}

/** The certificate plus everything the server derives for the screen and the print. */
export interface CertificateView {
  readonly certificate: ProgressCertificate;
  readonly derivedStatus: ProgressCertificateDerivedStatus;
  readonly contractDocNo: string;
  readonly contractTitleAr: string;
  readonly customerId: string;
  readonly invoice: CertificateInvoiceStatus | null;
  readonly daysOverdue: number;
  readonly latePaymentCompensation: Money;
  readonly cbeCreditDiscountRatePercent: string | null;
  /** True when a later certificate exists — every action on this one is refused. */
  readonly hasLaterCertificate: boolean;
}

export interface InternalCertificateRow {
  readonly boqLineId: string;
  readonly code: string;
  readonly descriptionAr: string;
  readonly unit: BoqUnit;
  readonly cumulativeQty: Qty;
  readonly estimatedUnitCost: Money | null;
  readonly estimatedCost: Money;
  readonly sellingValue: Money;
  readonly lineMargin: Money;
  readonly lineMarginPercent: string;
}

export interface InternalCertificateReport {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly projectId: string;
  readonly asOfCertificateId: string | null;
  readonly asOfDocNo: string | null;
  readonly asOfSerial: number | null;
  readonly rows: readonly InternalCertificateRow[];
  readonly totals: {
    readonly estimatedCost: Money;
    readonly sellingValue: Money;
    readonly margin: Money;
    readonly marginPercent: string;
  };
  /**
   * Cost carries no BOQ-line dimension, so the ACTUAL figure is only
   * answerable at project level. Reported beside the table rather than divided
   * into it: a per-line actual that was really an allocation would read as a
   * measurement, and the margin column is the one number this document exists
   * for.
   */
  readonly projectActual: {
    readonly cost: Money;
    readonly revenue: Money;
    readonly byCategory: Readonly<Record<string, Money>>;
  } | null;
  readonly actualCostNoteAr: string;
}

const ACTUAL_COST_NOTE =
  "التكلفة الفعلية على مستوى المشروع؛ الربط بالبند يتطلب بُعد البند على التكلفة.";

function moneyOf(reasons: string[], label: string, value: string | null | undefined, fallback = Money.zero()): Money {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return Money.fromMajor(value);
  } catch {
    reasons.push(`${label} يجب أن يكون رقمًا`);
    return fallback;
  }
}

function qtyOf(reasons: string[], label: string, value: string | null | undefined): Qty {
  if (value === null || value === undefined || value === "") return Qty.zero();
  try {
    return Qty.fromMajor(value);
  } catch {
    reasons.push(`${label} يجب أن تكون رقمًا`);
    return Qty.zero();
  }
}

/** A quantity as a person writes it — "12" not "12.000000". */
function qtyText(qty: Qty): string {
  const raw = qty.toString();
  return raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

interface DatedStep {
  readonly labelAr: string;
  readonly date: string | null;
}

/**
 * The three signatures run FORWARD from the period they certify and none of
 * them is in the future. Every refusal names BOTH dates: «تاريخ الاعتماد
 * (٢٠٢٤-٠١-٠١) يسبق…» is actionable, "invalid date" is not.
 */
function dateOrderRefusals(steps: readonly DatedStep[], today: string): string[] {
  const reasons: string[] = [];
  const known = steps.filter((s): s is { labelAr: string; date: string } => s.date !== null && s.date !== "");
  for (let i = 1; i < known.length; i++) {
    const earlier = known[i - 1] as { labelAr: string; date: string };
    const later = known[i] as { labelAr: string; date: string };
    if (later.date < earlier.date) {
      reasons.push(`${later.labelAr} (${later.date}) يسبق ${earlier.labelAr} (${earlier.date}).`);
    }
  }
  for (const step of known.slice(1)) {
    if (step.date > today) {
      reasons.push(`${step.labelAr} (${step.date}) يقع في المستقبل بعد تاريخ اليوم (${today}).`);
    }
  }
  return reasons;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export class CertificateService {
  constructor(private readonly deps: CertificateServiceDeps) {}

  private today(): string {
    return this.deps.today ? this.deps.today() : tenantTodayIso();
  }

  private async routed(key: string, fallback: string): Promise<string> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    return routedAccountId(routing, key) ?? fallback;
  }

  // ----- reads -------------------------------------------------------------

  async list(filter?: ProgressCertificateListFilter): Promise<CertificateView[]> {
    const rows = await this.deps.store.list(filter);
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async find(idOrDocNo: string): Promise<ProgressCertificate | null> {
    return (await this.deps.store.findById(idOrDocNo)) ?? (await this.deps.store.findByDocNo(idOrDocNo));
  }

  async get(idOrDocNo: string): Promise<CertificateView> {
    return this.view(await this.require(idOrDocNo));
  }

  private async require(idOrDocNo: string): Promise<ProgressCertificate> {
    const found = await this.find(idOrDocNo);
    if (!found) throw new ProgressCertificateNotFoundError(idOrDocNo);
    return found;
  }

  async view(certificate: ProgressCertificate): Promise<CertificateView> {
    const contract = await this.deps.contracts.findContractById(certificate.contractId);
    const invoice = certificate.invoiceId
      ? ((await this.deps.invoicing?.status(certificate.invoiceId)) ?? null)
      : null;
    const rate = (await this.deps.cbeCreditDiscountRatePercent?.()) ?? null;
    const today = this.today();
    const overdue =
      certificate.dueDate && invoice && invoice.remainingBalance.scaled > 0n
        ? Math.max(0, daysBetween(certificate.dueDate, today))
        : 0;
    const compensation =
      rate === null || overdue === 0 || invoice === null
        ? Money.zero()
        : Money.fromScaled(
            (percentOf(invoice.remainingBalance, rate).scaled * BigInt(overdue)) / 365n,
          );
    const siblings = await this.deps.store.listByContract(certificate.contractId);
    return {
      certificate,
      derivedStatus:
        certificate.status === "invoiced" && invoice !== null && invoice.remainingBalance.scaled <= 0n
          ? "collected"
          : certificate.status,
      contractDocNo: contract?.docNo ?? certificate.contractId,
      contractTitleAr: contract?.titleAr ?? "",
      customerId: contract?.customerId ?? "",
      invoice,
      daysOverdue: overdue,
      latePaymentCompensation: compensation,
      cbeCreditDiscountRatePercent: rate,
      hasLaterCertificate: siblings.some((s) => isLiveCertificate(s) && s.serial > certificate.serial),
    };
  }

  // ----- contract context --------------------------------------------------

  private async requireContract(contractId: string): Promise<WorksContract> {
    const contract = await this.deps.contracts.findContractById(contractId);
    if (!contract) throw new InvalidProgressCertificateError([`العقد "${contractId}" غير موجود`]);
    return contract;
  }

  private async contractContext(contract: WorksContract, executionDate: string) {
    const [boqLines, adjustments, orders] = await Promise.all([
      this.deps.contracts.listBoqLines(contract.id),
      this.deps.contracts.listAdjustments(contract.id),
      this.deps.contracts.listVariationOrders({ contractId: contract.id }),
    ]);
    const input = { lines: boqLines, adjustments, variationApprovals: approvalDates(orders) };
    const asOfExecution = new Map(
      computeContractedQuantities(input, executionDate).map((r) => [r.boqLineId, r.contractedQty]),
    );
    const asOfNow = new Map(
      computeContractedQuantities(input, null).map((r) => [r.boqLineId, r.contractedQty]),
    );
    const contractValueAfterVariations = computeContractValue(boqLines).add(
      computeApprovedVariationsValue(orders, boqLines),
    );
    return { boqLines, asOfExecution, asOfNow, contractValueAfterVariations };
  }

  /**
   * The advance the customer actually paid on this project, and what is still
   * owed back. Read off the POSTED ledger rather than off any certificate:
   * the recovery cap is "never more than what came in", and a figure derived
   * from progress would keep recovering after the advance was repaid.
   */
  private async advancePosition(
    projectId: string,
    contractId: string,
  ): Promise<{ received: Money; outstanding: Money; ceiling: Money }> {
    const accountId = await this.routed("contracting.customer_advances", "2160");
    const lines = (await this.deps.gl.ledger.listLines?.({ accountIds: [accountId], projectId })) ?? [];
    let credits = 0n;
    let debits = 0n;
    for (const line of lines) {
      credits += line.credit.scaled;
      debits += line.debit.scaled;
    }
    /**
     * INVARIANT: the advance is received per PROJECT and recovered per
     * CONTRACT. The ceiling for this contract is therefore what came in less
     * what the project's OTHER contracts have already recovered — a ceiling of
     * the full advance lets two contracts on one project each recover it and
     * drives the advances account negative.
     */
    let recoveredElsewhere = 0n;
    for (const sibling of await this.deps.store.list({ projectId })) {
      if (sibling.contractId === contractId) continue;
      if (sibling.status !== "invoiced" && sibling.status !== "approved_for_payment") continue;
      recoveredElsewhere +=
        sibling.computed.deductions.find((d) => d.key === "advanceRecovery")?.thisCertificate.scaled ?? 0n;
    }
    const ceiling = credits - recoveredElsewhere;
    return {
      received: Money.fromScaled(credits),
      outstanding: Money.fromScaled(credits - debits),
      ceiling: Money.fromScaled(ceiling > 0n ? ceiling : 0n),
    };
  }

  // ----- building ----------------------------------------------------------

  private buildWorkLines(
    certificateId: string,
    boqLines: readonly BoqLine[],
    asOfExecution: ReadonlyMap<string, Qty>,
    previous: ProgressCertificate | null,
    inputs: readonly CertificateWorkLineInput[],
    reasons: string[],
    stamped: readonly CertificateWorkLine[],
  ): CertificateWorkLine[] {
    const byId = new Map(inputs.map((i) => [i.boqLineId, i]));
    const stampedById = new Map(stamped.map((l) => [l.boqLineId, l]));
    const previousById = new Map((previous?.workLines ?? []).map((l) => [l.boqLineId, l]));
    for (const input of inputs) {
      if (!boqLines.some((l) => l.id === input.boqLineId)) {
        reasons.push(`البند "${input.boqLineId}" غير موجود في جدول الكميات`);
      }
    }
    return boqLines.map((line, index) => {
      const input = byId.get(line.id);
      const thisPeriodQty = qtyOf(reasons, `كمية البند "${line.code}"`, input?.thisPeriodQty);
      const prior = previousById.get(line.id);
      const previousCumulativeQty = prior?.cumulativeQty ?? Qty.zero();
      const previousCumulativeValue = prior?.cumulativeValue ?? Money.zero();
      const cumulativeQty = previousCumulativeQty.add(thisPeriodQty);
      // The rate is stamped ONCE, when the certificate is created. Re-reading it
      // from the BOQ later would restate a certificate the consultant signed.
      const unitRate = stampedById.get(line.id)?.unitRate ?? line.unitRate;
      const contractedQty = asOfExecution.get(line.id) ?? Qty.zero();
      const cumulativeValue = extendQty(cumulativeQty, unitRate);
      return {
        id: `${certificateId}-W${index + 1}`,
        boqLineId: line.id,
        code: line.code,
        descriptionAr: line.descriptionAr,
        unit: line.unit,
        unitRate,
        thisPeriodQty,
        previousCumulativeQty,
        cumulativeQty,
        contractedQty,
        completionPercent: completionPercentOf(cumulativeQty, contractedQty),
        previousCumulativeValue,
        cumulativeValue,
        thisPeriodValue: subtract(cumulativeValue, previousCumulativeValue),
        sortOrder: line.sortOrder,
      };
    });
  }

  private buildMaterialLines(
    certificateId: string,
    materialsOnSitePercent: string,
    previous: ProgressCertificate | null,
    inputs: readonly CertificateMaterialLineInput[],
    reasons: string[],
  ): CertificateMaterialLine[] {
    const priorByKey = new Map((previous?.materialLines ?? []).map((l) => [l.materialKey, l]));
    const seen = new Map<string, CertificateMaterialLineInput>();
    for (const input of inputs) {
      const key = input.materialKey.trim();
      if (key === "") reasons.push("كل سطر تشوينات يحتاج مفتاحًا ثابتًا للمادة");
      else if (seen.has(key)) reasons.push(`مفتاح التشوينات "${key}" مكرر`);
      else seen.set(key, input);
    }
    // Carried forward automatically: a material certified last month stays on
    // the certificate at its cumulative value even when nothing moved.
    for (const [key, prior] of priorByKey) {
      if (!seen.has(key)) {
        seen.set(key, {
          materialKey: key,
          descriptionAr: prior.descriptionAr,
          unit: prior.unit,
          qty: "0",
          unitRate: prior.unitRate.toString(),
        });
      }
    }
    return [...seen.values()].map((input, index) => {
      const key = input.materialKey.trim();
      const prior = priorByKey.get(key);
      const qty = qtyOf(reasons, `كمية التشوينات "${input.descriptionAr}"`, input.qty);
      // The rate is stamped by the FIRST certificate that carried the material,
      // exactly as a work line's rate is. Re-reading a re-typed rate here
      // restated the earlier certificate's cumulative value — money the
      // consultant had already signed for.
      const unitRate = prior?.unitRate ?? moneyOf(reasons, `فئة التشوينات "${input.descriptionAr}"`, input.unitRate);
      const previousCumulativeQty = prior?.cumulativeQty ?? Qty.zero();
      const cumulativeQty = previousCumulativeQty.add(qty);
      if (cumulativeQty.isNegative()) {
        reasons.push(`الكمية التراكمية للتشوينات "${input.descriptionAr}" سالبة`);
      }
      const value = percentOf(extendQty(cumulativeQty, unitRate), materialsOnSitePercent);
      return {
        id: `${certificateId}-M${index + 1}`,
        materialKey: key,
        descriptionAr: input.descriptionAr.trim(),
        unit: input.unit as BoqUnit,
        qty,
        unitRate,
        previousCumulativeQty,
        cumulativeQty,
        value,
        previousValue: prior?.value ?? Money.zero(),
        sortOrder: index + 1,
      };
    });
  }

  /**
   * The quantity refusals, in the words the design demands: a line whose
   * contracted quantity depends on a variation order approved AFTER the
   * execution date is refused by name, not silently accepted (design §06).
   */
  private quantityRefusals(
    workLines: readonly CertificateWorkLine[],
    asOfNow: ReadonlyMap<string, Qty>,
    executionDate: string,
  ): string[] {
    const reasons: string[] = [];
    for (const line of workLines) {
      if (line.cumulativeQty.isNegative()) {
        reasons.push(`الكمية التراكمية للبند "${line.code} — ${line.descriptionAr}" سالبة.`);
        continue;
      }
      if (line.cumulativeQty.compare(line.contractedQty) <= 0) continue;
      const now = asOfNow.get(line.boqLineId) ?? Qty.zero();
      if (now.scaled > line.contractedQty.scaled && line.cumulativeQty.compare(now) <= 0) {
        reasons.push(
          `البند "${line.code} — ${line.descriptionAr}": الكمية التراكمية ${qtyText(line.cumulativeQty)} تتجاوز الكمية التعاقدية ${qtyText(line.contractedQty)} في تاريخ التنفيذ ${executionDate} — أمر التغيير الذي يرفعها اعتُمد بعد هذا التاريخ.`,
        );
        continue;
      }
      reasons.push(
        `البند "${line.code} — ${line.descriptionAr}": الكمية التراكمية ${qtyText(line.cumulativeQty)} تتجاوز الكمية التعاقدية ${qtyText(line.contractedQty)}.`,
      );
    }
    return reasons;
  }

  private async compose(
    certificateId: string,
    contract: WorksContract,
    previous: ProgressCertificate | null,
    input: CertificateDraftInput,
    stamped: readonly CertificateWorkLine[],
  ): Promise<{
    workLines: CertificateWorkLine[];
    materialLines: CertificateMaterialLine[];
    computed: CertificateComputation;
    manual: {
      penaltiesCumulative: Money;
      suspendedCumulative: Money;
      employerMaterialsCumulative: Money;
      waterElectricityCumulative: Money;
    };
    executionDate: string;
    asOfNow: ReadonlyMap<string, Qty>;
  }> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(input.periodFrom)) reasons.push("تاريخ بداية الفترة مطلوب بصيغة YYYY-MM-DD");
    if (!ISO_DATE.test(input.periodTo)) reasons.push("تاريخ نهاية الفترة مطلوب بصيغة YYYY-MM-DD");
    const executionDate = input.executionDate ?? input.periodTo;
    if (!ISO_DATE.test(executionDate)) reasons.push("تاريخ التنفيذ مطلوب بصيغة YYYY-MM-DD");
    if (ISO_DATE.test(input.periodFrom) && ISO_DATE.test(input.periodTo) && input.periodTo < input.periodFrom) {
      reasons.push("تاريخ نهاية الفترة يسبق تاريخ بدايتها");
    }
    if (reasons.length > 0) throw new InvalidProgressCertificateError(reasons);

    const ctx = await this.contractContext(contract, executionDate);
    const workLines = this.buildWorkLines(
      certificateId,
      ctx.boqLines,
      ctx.asOfExecution,
      previous,
      input.workLines ?? [],
      reasons,
      stamped,
    );
    const materialLines = this.buildMaterialLines(
      certificateId,
      contract.materialsOnSitePercent,
      previous,
      input.materialLines ?? [],
      reasons,
    );
    const manual = {
      penaltiesCumulative: moneyOf(reasons, "غرامة التأخير", input.penaltiesCumulative),
      suspendedCumulative: moneyOf(reasons, "التعليات", input.suspendedCumulative),
      employerMaterialsCumulative: moneyOf(reasons, "استهلاك عهدة المواد", input.employerMaterialsCumulative),
      waterElectricityCumulative: moneyOf(reasons, "استهلاك المياه والكهرباء", input.waterElectricityCumulative),
    };
    if (reasons.length > 0) throw new InvalidProgressCertificateError(reasons);

    const advance = await this.advancePosition(contract.projectId, contract.id);
    const computed = computeCertificate({
      terms: contract,
      workLines,
      materialLines,
      manual: {
        penalties: manual.penaltiesCumulative,
        suspended: manual.suspendedCumulative,
        employerMaterials: manual.employerMaterialsCumulative,
        waterElectricity: manual.waterElectricityCumulative,
      },
      previous: previous?.computed ?? null,
      contractValueAfterVariations: ctx.contractValueAfterVariations,
      advanceReceived: advance.received,
      advanceOutstanding: advance.outstanding,
      advanceRecoveryCeiling: advance.ceiling,
      contractType: contract.contractType,
      finalSecurityPercent: contract.finalSecurityPercent,
    });

    return { workLines, materialLines, computed, manual, executionDate, asOfNow: ctx.asOfNow };
  }

  /** The certificate the next one builds on: the latest live certificate of the contract. */
  private async previousCertificate(contractId: string, excludeId?: string): Promise<ProgressCertificate | null> {
    const rows = (await this.deps.store.listByContract(contractId)).filter(
      (r) => isLiveCertificate(r) && r.id !== excludeId,
    );
    return rows.length === 0 ? null : (rows[rows.length - 1] as ProgressCertificate);
  }

  private async assertNoLaterCertificate(certificate: ProgressCertificate): Promise<void> {
    const later = (await this.deps.store.listByContract(certificate.contractId)).find(
      (r) => isLiveCertificate(r) && r.serial > certificate.serial,
    );
    if (later) throw new LaterCertificateExistsError(certificate.id, later.docNo, later.serial);
  }

  // ----- use cases ---------------------------------------------------------

  /** The live block the «مستخلص جديد» screen shows. Persists nothing. */
  async preview(cmd: PreviewCertificateCommand): Promise<{
    workLines: readonly CertificateWorkLine[];
    materialLines: readonly CertificateMaterialLine[];
    computed: CertificateComputation;
    refusals: readonly string[];
    serial: number;
    executionDate: string;
  }> {
    const contract = await this.requireContract(cmd.contractId);
    const existing = cmd.certificateId ? await this.deps.store.findById(cmd.certificateId) : null;
    const previous = existing
      ? existing.previousCertificateId
        ? await this.deps.store.findById(existing.previousCertificateId)
        : null
      : await this.previousCertificate(contract.id);
    const composed = await this.compose(
      existing?.id ?? `${contract.id}-PREVIEW`,
      contract,
      previous,
      cmd,
      existing?.workLines ?? [],
    );
    return {
      workLines: composed.workLines,
      materialLines: composed.materialLines,
      computed: composed.computed,
      refusals: this.quantityRefusals(composed.workLines, composed.asOfNow, composed.executionDate),
      serial:
        existing?.serial ??
        (await this.deps.store.listByContract(contract.id)).reduce((max, row) => Math.max(max, row.serial), 0) + 1,
      executionDate: composed.executionDate,
    };
  }

  async create(cmd: CreateCertificateCommand, actor: CertificateActor): Promise<CertificateView> {
    const contract = await this.requireContract(cmd.contractId);
    if (contract.status !== "active") {
      throw new InvalidProgressCertificateError([
        `لا يمكن إصدار مستخلص إلا على عقد ساري — حالة العقد "${contract.status}".`,
      ]);
    }
    const all = await this.deps.store.listByContract(contract.id);
    const siblings = all.filter(isLiveCertificate);
    const previous = siblings.length === 0 ? null : (siblings[siblings.length - 1] as ProgressCertificate);
    // INVARIANT: the serial is monotonic over EVERY certificate of the
    // contract, cancelled ones included — reusing a cancelled serial produces
    // two «مستخلص رقم ٣» on one contract and the audit trail stops being
    // followable. `previousCertificateId` still skips the cancelled ones,
    // because the cumulative is read off the last LIVE certificate.
    const nextSerial = all.reduce((max, row) => Math.max(max, row.serial), 0) + 1;
    if (previous?.isFinal) {
      throw new InvalidProgressCertificateError([
        `المستخلص الختامي رقم ${previous.serial} أقفل كميات هذا العقد — لا يجوز إصدار مستخلص بعده.`,
      ]);
    }
    const composed = await this.compose(cmd.id, contract, previous, cmd, []);

    return this.deps.store.transaction(async () => {
      const number = await this.deps.numbering.next(CERTIFICATE_SEQUENCE);
      const certificate: ProgressCertificate = {
        id: cmd.id,
        docNo: number.formatted,
        contractId: contract.id,
        projectId: contract.projectId,
        serial: nextSerial,
        previousCertificateId: previous?.id ?? null,
        periodFrom: cmd.periodFrom,
        periodTo: cmd.periodTo,
        executionDate: composed.executionDate,
        isFinal: cmd.isFinal ?? false,
        status: "draft",
        preparedBy: actor.userId,
        preparedAt: this.today(),
        measuredBy: null,
        measuredAt: null,
        certifiedBy: null,
        certifiedAt: null,
        approvedBy: null,
        approvedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReasonAr: null,
        voidedAt: null,
        voidedBy: null,
        voidReasonAr: null,
        voidJournalEntryId: null,
        invoiceId: null,
        invoiceDocNo: null,
        journalEntryId: null,
        postedDeductionsTotal: Money.zero(),
        dueDate: null,
        penaltiesCumulative: composed.manual.penaltiesCumulative,
        suspendedCumulative: composed.manual.suspendedCumulative,
        employerMaterialsCumulative: composed.manual.employerMaterialsCumulative,
        waterElectricityCumulative: composed.manual.waterElectricityCumulative,
        notes: cmd.notes ?? null,
        workLines: composed.workLines,
        materialLines: composed.materialLines,
        computed: composed.computed,
      };
      await this.deps.store.insert(certificate);
      return this.view(certificate);
    });
  }

  async update(idOrDocNo: string, cmd: UpdateCertificateCommand, actor: CertificateActor): Promise<CertificateView> {
    const current = await this.require(idOrDocNo);
    if (!EDITABLE_CERTIFICATE_STATUSES.includes(current.status)) {
      throw new InvalidProgressCertificateError([
        `لا يمكن تعديل مستخلص حالته "${getProgressCertificateStatusLabel(current.status)}" — التصحيح يكون بكمية على المستخلص التالي.`,
      ]);
    }
    await this.assertNoLaterCertificate(current);
    const contract = await this.requireContract(current.contractId);
    const previous = current.previousCertificateId
      ? await this.deps.store.findById(current.previousCertificateId)
      : null;
    const composed = await this.compose(
      current.id,
      contract,
      previous,
      {
        periodFrom: cmd.periodFrom ?? current.periodFrom,
        periodTo: cmd.periodTo ?? current.periodTo,
        executionDate: cmd.executionDate ?? current.executionDate,
        isFinal: cmd.isFinal ?? current.isFinal,
        workLines: cmd.workLines ?? current.workLines.map((l) => ({ boqLineId: l.boqLineId, thisPeriodQty: l.thisPeriodQty.toString() })),
        materialLines:
          cmd.materialLines ??
          current.materialLines.map((l) => ({
            materialKey: l.materialKey,
            descriptionAr: l.descriptionAr,
            unit: l.unit,
            qty: l.qty.toString(),
            unitRate: l.unitRate.toString(),
          })),
        penaltiesCumulative: cmd.penaltiesCumulative ?? current.penaltiesCumulative.toString(),
        suspendedCumulative: cmd.suspendedCumulative ?? current.suspendedCumulative.toString(),
        employerMaterialsCumulative: cmd.employerMaterialsCumulative ?? current.employerMaterialsCumulative.toString(),
        waterElectricityCumulative: cmd.waterElectricityCumulative ?? current.waterElectricityCumulative.toString(),
        notes: cmd.notes !== undefined ? cmd.notes : current.notes,
      },
      current.workLines,
    );
    const next: ProgressCertificate = {
      ...current,
      periodFrom: cmd.periodFrom ?? current.periodFrom,
      periodTo: cmd.periodTo ?? current.periodTo,
      executionDate: composed.executionDate,
      isFinal: cmd.isFinal ?? current.isFinal,
      notes: cmd.notes !== undefined ? cmd.notes : current.notes,
      preparedBy: current.preparedBy ?? actor.userId,
      penaltiesCumulative: composed.manual.penaltiesCumulative,
      suspendedCumulative: composed.manual.suspendedCumulative,
      employerMaterialsCumulative: composed.manual.employerMaterialsCumulative,
      waterElectricityCumulative: composed.manual.waterElectricityCumulative,
      workLines: composed.workLines,
      materialLines: composed.materialLines,
      computed: composed.computed,
    };
    await this.deps.store.save(next);
    return this.view(next);
  }

  /** حصر معتمد — the resident engineer's measurement. The quantities are frozen against the execution date here. */
  async measure(idOrDocNo: string, actor: CertificateActor, measuredAt?: string | null): Promise<CertificateView> {
    const current = await this.moveable(idOrDocNo, "draft", "measured");
    const date = measuredAt ?? this.today();
    if (!ISO_DATE.test(date)) throw new InvalidProgressCertificateError(["تاريخ الحصر مطلوب بصيغة YYYY-MM-DD"]);
    this.assertDates([
      { labelAr: "نهاية الفترة", date: current.periodTo },
      { labelAr: "تاريخ الحصر", date },
    ]);
    const refusals = await this.refuseQuantities(current);
    if (refusals.length > 0) throw new CertificateQuantityError(refusals);
    const next: ProgressCertificate = {
      ...current,
      status: "measured",
      measuredBy: actor.userId,
      measuredAt: date,
    };
    await this.deps.store.save(next);
    await this.audit(next, "MEASURE", actor, { measuredAt: date, periodTo: next.periodTo });
    return this.view(next);
  }

  /** معتمد من الاستشاري — the consultant certifies the quantities. Nothing changes after this. */
  async certify(idOrDocNo: string, actor: CertificateActor, certifiedAt?: string | null): Promise<CertificateView> {
    const current = await this.moveable(idOrDocNo, "measured", "certified");
    if (!(await this.waived(actor)) && current.preparedBy !== null && current.preparedBy === actor.userId) {
      throw new CertificateSegregationError(actor.userId, "لا يجوز اعتماد المستخلص من نفس الشخص الذي أعدّه. إذا كانت المنشأة شخصًا واحدًا، فعّل «وضع المشغّل الواحد» من الإعدادات العامة ← المقاولات.");
    }
    const date = certifiedAt ?? this.today();
    if (!ISO_DATE.test(date)) throw new InvalidProgressCertificateError(["تاريخ اعتماد الاستشاري مطلوب بصيغة YYYY-MM-DD"]);
    this.assertDates([
      { labelAr: "نهاية الفترة", date: current.periodTo },
      { labelAr: "تاريخ الحصر", date: current.measuredAt },
      { labelAr: "تاريخ اعتماد الاستشاري", date },
    ]);
    const refusals = await this.refuseQuantities(current);
    if (refusals.length > 0) throw new CertificateQuantityError(refusals);
    const next: ProgressCertificate = {
      ...current,
      status: "certified",
      certifiedBy: actor.userId,
      certifiedAt: date,
    };
    await this.deps.store.save(next);
    await this.audit(next, "CERTIFY", actor, { certifiedAt: date, measuredBy: next.measuredBy });
    return this.view(next);
  }

  /** One forensic row per transition; never allowed to fail the transition itself. */
  private async audit(
    certificate: ProgressCertificate,
    action: string,
    actor: CertificateActor,
    details: Record<string, unknown>,
  ): Promise<void> {
    await recordTransition(this.deps.audit, {
      entityType: "PROGRESS_CERTIFICATE",
      entityId: certificate.id,
      action,
      actor: actor.userId,
      severity: action === "APPROVE" || action === "VOID" ? "WARNING" : "INFO",
      details: { docNo: certificate.docNo, contractId: certificate.contractId, projectId: certificate.projectId, ...details },
    });
  }

  /** Is this actor exempt from فصل المهام? Only when the tenant runs in single-operator mode. */
  private async waived(actor: CertificateActor): Promise<boolean> {
    return this.deps.segregationWaived ? this.deps.segregationWaived(actor) : false;
  }

  private assertDates(steps: readonly DatedStep[]): void {
    const reasons = dateOrderRefusals(steps, this.today());
    if (reasons.length > 0) throw new CertificateDateOrderError(reasons);
  }

  /**
   * معتمد للصرف — the employer's finance clearance, which starts the payment
   * clock (D-09). It generates and confirms the sales invoice and posts the
   * deductions entry inside ONE transaction: the certificate passes through
   * `approved_for_payment` and comes to rest at `invoiced`.
   */
  async approve(idOrDocNo: string, approvedAt: string, actor: CertificateActor): Promise<CertificateView> {
    const current = await this.moveable(idOrDocNo, "certified", "approved_for_payment");
    if (!ISO_DATE.test(approvedAt)) throw new InvalidProgressCertificateError(["تاريخ الاعتماد مطلوب بصيغة YYYY-MM-DD"]);
    this.assertDates([
      { labelAr: "نهاية الفترة", date: current.periodTo },
      { labelAr: "تاريخ الحصر", date: current.measuredAt },
      { labelAr: "تاريخ اعتماد الاستشاري", date: current.certifiedAt },
      { labelAr: "تاريخ اعتماد الصرف", date: approvedAt },
    ]);
    if (!(await this.waived(actor))) {
      if (current.preparedBy !== null && current.preparedBy === actor.userId) {
        throw new CertificateSegregationError(actor.userId, "لا يجوز اعتماد المستخلص للصرف من نفس الشخص الذي أعدّه. إذا كانت المنشأة شخصًا واحدًا، فعّل «وضع المشغّل الواحد» من الإعدادات العامة ← المقاولات.");
      }
      if (current.certifiedBy !== null && current.certifiedBy === actor.userId) {
        throw new CertificateSegregationError(
          actor.userId,
          "لا يجوز اعتماد المستخلص للصرف من نفس الاستشاري الذي اعتمد الحصر. إذا كانت المنشأة شخصًا واحدًا، فعّل «وضع المشغّل الواحد» من الإعدادات العامة ← المقاولات.",
        );
      }
    }
    const invoicing = this.deps.invoicing;
    if (!invoicing) {
      throw new InvalidProgressCertificateError(["إصدار فاتورة المستخلص غير مُفعّل على هذا الخادم."]);
    }
    const refusals = await this.refuseQuantities(current);
    if (refusals.length > 0) throw new CertificateQuantityError(refusals);

    const contract = await this.requireContract(current.contractId);
    const computed = current.computed;
    const dueDate = addDays(approvedAt, contract.paymentTermDays);
    const revenueAccountId = await this.routed(
      contract.recognitionPolicy === "certified_value" ? "contracting.revenue" : "contracting.billings",
      contract.recognitionPolicy === "certified_value" ? "4150" : "2165",
    );

    const saved = await this.deps.store.transaction(async () => {
      const cleared: ProgressCertificate = {
        ...current,
        status: "approved_for_payment",
        approvedBy: actor.userId,
        approvedAt,
        dueDate,
      };
      await this.deps.store.save(cleared);

      const invoice = await invoicing.issue({
        certificateId: cleared.id,
        certificateDocNo: cleared.docNo,
        serial: cleared.serial,
        contractDocNo: contract.docNo,
        customerId: contract.customerId,
        projectId: cleared.projectId,
        date: approvedAt,
        dueDate,
        amount: computed.invoiceBase,
        taxRatePercent: computed.vatEffectiveRatePercent,
        revenueAccountId,
        lineDescriptionAr: `مستخلص رقم ${cleared.serial} — ${contract.docNo}`,
        actor: actor.userId,
        memoAr:
          contract.vatBasis === "transitional"
            ? `فاتورة مستخلص رقم ${cleared.serial} — أساس ضريبي انتقالي: ١٤٪ على ٣٦٪ من القيمة (قرار ٤١٨ لسنة ٢٠٢٥).`
            : `فاتورة مستخلص رقم ${cleared.serial} — ${contract.docNo}.`,
      });

      const deductionsTotal = computed.deductionsThisCertificate;
      let journalEntryId: string | null = null;
      if (deductionsTotal.scaled !== 0n) {
        journalEntryId = `${cleared.id}-DED`;
        await this.postDeductions(journalEntryId, cleared, contract, approvedAt, invoice.arAccountId);
        await invoicing.settle(invoice.invoiceId, deductionsTotal, cleared.docNo);
      }

      const advanceRecovery =
        computed.deductions.find((d) => d.key === "advanceRecovery")?.thisCertificate ?? Money.zero();
      if (advanceRecovery.scaled > 0n && this.deps.guarantees) {
        await this.deps.guarantees.reduceAdvanceGuarantee({
          contractId: contract.id,
          projectId: cleared.projectId,
          date: approvedAt,
          amount: advanceRecovery,
          sourceRef: cleared.docNo,
          actor: actor.userId,
        });
      }

      const invoiced: ProgressCertificate = {
        ...cleared,
        status: "invoiced",
        invoiceId: invoice.invoiceId,
        invoiceDocNo: invoice.invoiceDocNo,
        journalEntryId,
        postedDeductionsTotal: deductionsTotal,
      };
      await this.deps.store.save(invoiced);
      return invoiced;
    });

    await this.audit(saved, "APPROVE", actor, {
      approvedAt,
      invoiceDocNo: saved.invoiceDocNo,
      deductionsTotal: saved.postedDeductionsTotal.toString(),
      preparedBy: saved.preparedBy,
      certifiedBy: saved.certifiedBy,
    });
    return this.view(saved);
  }

  async cancel(idOrDocNo: string, reasonAr: string, actor: CertificateActor): Promise<CertificateView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft" && current.status !== "measured") {
      throw new InvalidProgressCertificateTransitionError(current.status, "cancelled");
    }
    if (reasonAr.trim() === "") {
      throw new InvalidProgressCertificateError(["سبب إلغاء المستخلص مطلوب."]);
    }
    await this.assertNoLaterCertificate(current);
    const next: ProgressCertificate = {
      ...current,
      status: "cancelled",
      cancelledAt: this.today(),
      // The canceller is NOT the measurer: back-filling `measuredBy` with them
      // credited a measurement that never happened and let one person hold two
      // of the three signatures on the next certificate.
      cancelledBy: actor.userId,
      cancelReasonAr: reasonAr.trim(),
    };
    await this.deps.store.save(next);
    await this.audit(next, "CANCEL", actor, { reasonAr: next.cancelReasonAr, from: current.status });
    return this.view(next);
  }

  /**
   * إلغاء مستخلص معتمد — the only exit from an approved certificate, and it is
   * a REVERSAL, not an edit: the deductions entry is mirrored, the generated
   * invoice is voided through the sales-invoice void path, and the advance
   * guarantee is restored by exactly what this certificate reduced it by.
   */
  async void(
    idOrDocNo: string,
    input: { readonly date: string; readonly reasonAr: string },
    actor: CertificateActor,
  ): Promise<CertificateView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "invoiced" && current.status !== "approved_for_payment") {
      throw new InvalidProgressCertificateTransitionError(current.status, "voided");
    }
    if (!ISO_DATE.test(input.date)) {
      throw new InvalidProgressCertificateError(["تاريخ الإلغاء مطلوب بصيغة YYYY-MM-DD"]);
    }
    if (input.reasonAr.trim() === "") {
      throw new InvalidProgressCertificateError(["سبب إلغاء المستخلص المعتمد مطلوب."]);
    }
    this.assertDates([
      { labelAr: "تاريخ اعتماد الصرف", date: current.approvedAt },
      { labelAr: "تاريخ الإلغاء", date: input.date },
    ]);
    await this.assertNoLaterCertificate(current);

    const invoicing = this.deps.invoicing;
    if (!invoicing?.voidInvoice) {
      throw new InvalidProgressCertificateError(["إلغاء فاتورة المستخلص غير مُفعّل على هذا الخادم."]);
    }
    if (current.invoiceId) {
      const status = await invoicing.status(current.invoiceId);
      // `settle` records the deductions against the invoice, so anything
      // collected ON TOP of them is real money that has to be un-allocated on
      // its own voucher first.
      const collected = (status?.amountPaid.scaled ?? 0n) - current.postedDeductionsTotal.scaled;
      if (collected > 0n) {
        throw new InvalidProgressCertificateError([
          `لا يمكن إلغاء مستخلص حُصّل جزء من فاتورته (${Money.fromScaled(collected).toString()}) — اعكس التحصيل أولًا.`,
        ]);
      }
    }

    const saved = await this.deps.store.transaction(async () => {
      let voidJournalEntryId: string | null = null;
      if (current.journalEntryId) {
        voidJournalEntryId = `${current.id}-DED-VOID`;
        const reversal = await reverseJournalEntry(current.journalEntryId, this.deps.gl, {
          reversalId: voidJournalEntryId,
          date: input.date,
          memo: `عكس خصومات المستخلص ${current.docNo} — ${input.reasonAr.trim()}`,
        }, { mintedBySystem: true });
        voidJournalEntryId = reversal.reversal.id;
      }
      if (current.invoiceId) {
        await invoicing.voidInvoice!(current.invoiceId, input.date, `إلغاء المستخلص ${current.docNo}`);
      }
      const advanceRecovery =
        current.computed.deductions.find((d) => d.key === "advanceRecovery")?.thisCertificate ?? Money.zero();
      if (advanceRecovery.scaled > 0n && this.deps.guarantees?.restoreAdvanceGuarantee) {
        await this.deps.guarantees.restoreAdvanceGuarantee({
          contractId: current.contractId,
          projectId: current.projectId,
          date: input.date,
          amount: advanceRecovery,
          sourceRef: current.docNo,
        });
      }
      const voided: ProgressCertificate = {
        ...current,
        status: "voided",
        voidedAt: input.date,
        voidedBy: actor.userId,
        voidReasonAr: input.reasonAr.trim(),
        voidJournalEntryId,
      };
      await this.deps.store.save(voided);
      return voided;
    });
    await this.audit(saved, "VOID", actor, { reasonAr: saved.voidReasonAr, journalEntryId: saved.voidJournalEntryId });
    return this.view(saved);
  }

  /**
   * The status guard for a FORWARD move. Deliberately does NOT refuse when a
   * later certificate exists: measure, certify and approve change no figure on
   * this certificate, so a draft successor is no reason to freeze the
   * signature chain of the one it was built on. Editing and cancelling still
   * are, and keep their own guard.
   */
  private async moveable(
    idOrDocNo: string,
    from: ProgressCertificateStatus,
    to: ProgressCertificateStatus,
  ): Promise<ProgressCertificate> {
    const current = await this.require(idOrDocNo);
    if (current.status !== from) throw new InvalidProgressCertificateTransitionError(current.status, to);
    return current;
  }

  /** Re-derives the contracted quantities as of the execution date and reports every refusal. */
  private async refuseQuantities(certificate: ProgressCertificate): Promise<string[]> {
    const contract = await this.requireContract(certificate.contractId);
    const ctx = await this.contractContext(contract, certificate.executionDate);
    const lines = certificate.workLines.map((line) => ({
      ...line,
      contractedQty: ctx.asOfExecution.get(line.boqLineId) ?? Qty.zero(),
    }));
    return this.quantityRefusals(lines, ctx.asOfNow, certificate.executionDate);
  }

  /**
   * The deductions entry. Every line carries `projectId`; only the expense
   * lines carry a cost category, because a category on a receivable is a figure
   * nothing can roll up. The credit side is the invoice's OWN receivable
   * account, so the AR control moves by exactly what the sub-ledger records.
   */
  private async postDeductions(
    entryId: string,
    certificate: ProgressCertificate,
    contract: WorksContract,
    date: string,
    arAccountId: string,
  ): Promise<void> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    const [
      retentionAccount,
      advanceAccount,
      whtAccount,
      socialAccount,
      penaltyExpenseAccount,
      employerMaterialsAccount,
      stampDutyAccount,
      utilitiesAccount,
      billingsAccount,
      revenueAccount,
    ] = await Promise.all([
      this.routed("contracting.retention_receivable", "1150"),
      this.routed("contracting.customer_advances", "2160"),
      this.routed("contracting.wht_receivable", "1175"),
      this.routed("contracting.social_insurance", "5155"),
      this.routed("contracting.late_penalty", "5910"),
      this.routed("contracting.employer_materials", "5157"),
      this.routed("contracting.stamp_duty", "5158"),
      this.routed("contracting.utilities", "5159"),
      this.routed("contracting.billings", "2165"),
      this.routed("contracting.revenue", "4150"),
    ]);
    /**
     * غرامة التأخير is money the customer never owed, so by default it is a
     * DEDUCTION FROM THE BILLING, not a cost of building: a contra to 2165 on
     * a cost-to-cost contract and to 4150 on a certified-value one. A tenant
     * that has chosen `expense` gets 5910 instead. Either way it never carries
     * a `costCategory` — a penalty counted as contract cost inflates
     * percentage-of-completion and brings revenue forward.
     */
    const penaltyIsRevenueDeduction =
      (routing?.options.latePenaltyTreatment ?? DEFAULT_ACCOUNT_ROUTING_OPTIONS.latePenaltyTreatment) ===
      "revenue_deduction";
    const penaltyAccount = penaltyIsRevenueDeduction
      ? contract.recognitionPolicy === "certified_value"
        ? revenueAccount
        : billingsAccount
      : penaltyExpenseAccount;
    const byKey = new Map(certificate.computed.deductions.map((d) => [d.key, d.thisCertificate]));
    const spec: readonly {
      key: string;
      accountId: string;
      amount: Money;
      memo: string;
      cost: boolean;
    }[] = [
      { key: "retention", accountId: retentionAccount, amount: byKey.get("retention") ?? Money.zero(), memo: "المحتجزات الضمانية", cost: false },
      { key: "advanceRecovery", accountId: advanceAccount, amount: byKey.get("advanceRecovery") ?? Money.zero(), memo: "خصم الدفعة المقدمة", cost: false },
      { key: "withholdingTax", accountId: whtAccount, amount: byKey.get("withholdingTax") ?? Money.zero(), memo: "ضريبة الخصم والتحصيل", cost: false },
      { key: "socialInsurance", accountId: socialAccount, amount: byKey.get("socialInsurance") ?? Money.zero(), memo: "التأمينات الاجتماعية", cost: true },
      { key: "penalties", accountId: penaltyAccount, amount: byKey.get("penalties") ?? Money.zero(), memo: penaltyIsRevenueDeduction ? "غرامة التأخير — خصم من قيمة الأعمال" : "غرامة التأخير", cost: false },
      { key: "employerMaterials", accountId: employerMaterialsAccount, amount: byKey.get("employerMaterials") ?? Money.zero(), memo: "استهلاك عهدة المواد", cost: true },
      { key: "waterElectricity", accountId: utilitiesAccount, amount: byKey.get("waterElectricity") ?? Money.zero(), memo: "استهلاك المياه والكهرباء", cost: true },
      { key: "stampDuty", accountId: stampDutyAccount, amount: byKey.get("stampDuty") ?? Money.zero(), memo: "دمغات ورسوم", cost: true },
    ];

    const lines: JournalLineInput[] = [];
    for (const entry of spec) {
      if (entry.amount.scaled === 0n) continue;
      lines.push({
        accountId: entry.accountId,
        debit: entry.amount,
        credit: Money.zero(),
        memo: entry.memo,
        projectId: certificate.projectId,
        ...(entry.cost ? { costCategory: "indirect" as const } : {}),
      });
    }
    if (lines.length === 0) return;
    lines.push({
      accountId: arAccountId,
      debit: Money.zero(),
      credit: Money.sum(lines.map((l) => l.debit)),
      memo: `خصومات مستخلص رقم ${certificate.serial}`,
      projectId: certificate.projectId,
    });

    await postJournalEntry(
      {
        id: entryId,
        date,
        memo: `خصومات المستخلص ${certificate.docNo} — ${contract.docNo}`,
        source: "system",
        sourceDocType: PROGRESS_CERTIFICATE_DOC_TYPE,
        sourceDocId: certificate.id,
        sourceDocNumber: certificate.docNo,
        lines,
      },
      this.deps.gl,
      { mintedBySystem: true },
    );
  }

  // ----- the internal certificate -----------------------------------------

  /**
   * مستخلص تنفيذي — the one document in the Egyptian set that never leaves the
   * company: estimated cost against selling value, per BOQ line, at the latest
   * certificate's cumulative quantities.
   */
  async internalCertificate(contractId: string): Promise<InternalCertificateReport> {
    const contract = await this.requireContract(contractId);
    const certificates = (await this.deps.store.listByContract(contract.id)).filter(isLiveCertificate);
    const latest = certificates.length === 0 ? null : (certificates[certificates.length - 1] as ProgressCertificate);
    const boqLines = await this.deps.contracts.listBoqLines(contract.id);
    const byBoqLineId = new Map((latest?.workLines ?? []).map((l) => [l.boqLineId, l]));

    const rows: InternalCertificateRow[] = boqLines.map((line) => {
      const work = byBoqLineId.get(line.id);
      const cumulativeQty = work?.cumulativeQty ?? Qty.zero();
      const estimatedCost = line.estimatedUnitCost ? extendQty(cumulativeQty, line.estimatedUnitCost) : Money.zero();
      const sellingValue = work?.cumulativeValue ?? Money.zero();
      const lineMargin = subtract(sellingValue, estimatedCost);
      return {
        boqLineId: line.id,
        code: line.code,
        descriptionAr: line.descriptionAr,
        unit: line.unit,
        cumulativeQty,
        estimatedUnitCost: line.estimatedUnitCost,
        estimatedCost,
        sellingValue,
        lineMargin,
        lineMarginPercent: marginPercent(lineMargin, sellingValue),
      };
    });

    const estimatedCost = Money.sum(rows.map((r) => r.estimatedCost));
    const sellingValue = Money.sum(rows.map((r) => r.sellingValue));
    const margin = subtract(sellingValue, estimatedCost);

    return {
      contractId: contract.id,
      contractDocNo: contract.docNo,
      projectId: contract.projectId,
      asOfCertificateId: latest?.id ?? null,
      asOfDocNo: latest?.docNo ?? null,
      asOfSerial: latest?.serial ?? null,
      rows,
      totals: { estimatedCost, sellingValue, margin, marginPercent: marginPercent(margin, sellingValue) },
      projectActual: await this.projectActual(contract.projectId),
      actualCostNoteAr: ACTUAL_COST_NOTE,
    };
  }

  private async projectActual(projectId: string): Promise<InternalCertificateReport["projectActual"]> {
    if (!this.deps.accounts) return null;
    const [lines, accounts] = await Promise.all([
      this.deps.gl.ledger.listLines?.({ projectId }) ?? Promise.resolve([]),
      this.deps.accounts.list(),
    ]);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    let cost = 0n;
    let revenue = 0n;
    const byCategory = new Map<string, bigint>();
    for (const line of lines) {
      const account = accountById.get(line.accountId);
      if (!account) continue;
      if (account.type === "revenue") {
        revenue += line.credit.scaled - line.debit.scaled;
        continue;
      }
      if (account.type !== "expense") continue;
      const amount = line.debit.scaled - line.credit.scaled;
      cost += amount;
      const key = line.costCategory ?? "uncategorised";
      byCategory.set(key, (byCategory.get(key) ?? 0n) + amount);
    }
    return {
      cost: Money.fromScaled(cost),
      revenue: Money.fromScaled(revenue),
      byCategory: Object.fromEntries([...byCategory].map(([k, v]) => [k, Money.fromScaled(v)])),
    };
  }

  /**
   * Slice 1's `completionGuard`. A contract closes on a مستخلص ختامي, so a
   * contract with certificates still in flight — or with none of them final —
   * is refused rather than quietly closed with quantities still open.
   */
  async completionRefusal(contractId: string): Promise<string | null> {
    const rows = (await this.deps.store.listByContract(contractId)).filter(isLiveCertificate);
    if (rows.length === 0) return null;
    const open = rows.filter((r) => r.status !== "invoiced" && r.status !== "approved_for_payment");
    if (open.length > 0) {
      return `لا يمكن إنهاء العقد ومستخلصات قيد الاعتماد قائمة: ${open.map((r) => r.docNo).join("، ")}.`;
    }
    if (!rows.some((r) => r.isFinal)) {
      return "لا يمكن إنهاء العقد قبل اعتماد المستخلص الختامي الذي يقفل الكميات.";
    }
    return null;
  }
}

function marginPercent(margin: Money, sellingValue: Money): string {
  return completionPercentOfMoney(margin, sellingValue);
}
