import { Money, Qty } from "../../money/index.js";
import { routedAccountId, type AccountRoutingRepository } from "../../accounts/account-routing.js";
import type { NextNumberService } from "../../numbering/index.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import type { BoqLine, WorksContract, WorksContractStore } from "../contracts/contract.js";
import {
  computeSubcontractClientValue,
  computeSubcontractValue,
  isEarlySubcontractRelease,
  lineMarginVsClient,
  remainingCommitmentOf,
  subcontractReleaseEventDate,
} from "./amounts.js";
import {
  InvalidSubcontractError,
  InvalidSubcontractTransitionError,
  SubcontractNotFoundError,
  SubcontractRetentionError,
  SubcontractorNotPayableError,
} from "./errors.js";
import type {
  SubcontractRetentionInvoicingPort,
  SubcontractSupplierPort,
  SubcontractVoucherPort,
} from "./ports.js";
import { isLiveSubCertificate, type SubcontractStore } from "./sub-certificate.js";
import {
  canTransitionSubcontract,
  getSubcontractRetentionReleaseKindLabel,
  getSubcontractStatusLabel,
  type Subcontract,
  type SubcontractAdvancePayment,
  type SubcontractKind,
  type SubcontractLine,
  type SubcontractListFilter,
  type SubcontractRetentionRelease,
  type SubcontractRetentionReleaseKind,
  type SubcontractStatus,
} from "./subcontract.js";
import { tenantTodayIso } from "../../dates.js";

/**
 * عقد الباطن — the use cases and the ledger behind the two that post
 * (design §03 "THE MIRROR", D-04, D-05).
 *
 * Nothing a caller sends is trusted where the server can derive it: the
 * subcontract's value, the margin against the client line, the advance paid,
 * the retention held and the retention still releasable are all computed here
 * from the lines, the linked vouchers and the posted certificates.
 */

export const SUBCONTRACT_DOC_TYPE = "SUBCONTRACT";
const SUBCONTRACT_SEQUENCE = "SUBCONTRACT";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERCENT = /^\d{1,3}(\.\d{1,6})?$/;

/**
 * The routing slot a supplier advance sits in until a certificate recovers it —
 * سلف مقاولي الباطن, registered in `account-routing.ts` with its shipped default.
 * There is deliberately no literal fallback here: an account id spelled in a
 * poster is the one a tenant cannot repoint.
 */
export const SUPPLIER_ADVANCES_ROUTING_KEY = "contracting.subcontractor_advances";

export interface SubcontractActor {
  readonly userId: string;
  readonly wildcardAdmin: boolean;
}

export interface SubcontractServiceDeps {
  readonly store: SubcontractStore;
  readonly contracts: WorksContractStore;
  readonly numbering: NextNumberService;
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  readonly suppliers?: SubcontractSupplierPort;
  readonly vouchers?: SubcontractVoucherPort;
  /** The purchase-invoice engine the retention release is raised through. */
  readonly retentionInvoicing?: SubcontractRetentionInvoicingPort;
  /** سجل العمليات الحساسة — the retention release is a payment decision, so it is recorded. */
  readonly audit?: AuditSink;
  readonly today?: () => string;
}

export interface SubcontractLineInput {
  readonly id?: string | null;
  readonly clientBoqLineId: string;
  readonly descriptionAr?: string | null;
  readonly qty: string;
  readonly unitRate: string;
  readonly estimatedUnitCost?: string | null;
}

export interface SubcontractTermsInput {
  readonly retentionPercent?: string;
  readonly retentionCapPercent?: string | null;
  readonly advancePercent?: string;
  readonly advanceRecoveryPercent?: string;
  readonly withholdingTaxPercent?: string;
  readonly deemedWagePercent?: string;
  readonly socialInsuranceRatePercent?: string;
  readonly withholdSocialInsurance?: boolean;
  readonly socialInsuranceNote?: string | null;
  readonly penaltyCapPercent?: string;
  readonly paymentTermDays?: number;
  readonly defectsLiabilityMonths?: number;
  readonly vatBasis?: "standard" | "transitional";
}

export interface CreateSubcontractCommand extends SubcontractTermsInput {
  readonly id: string;
  readonly contractId: string;
  readonly supplierId: string;
  readonly titleAr: string;
  readonly kind?: SubcontractKind;
  readonly disguisedEmploymentReviewed?: boolean;
  readonly reviewNote?: string | null;
  readonly signedDate: string;
  readonly startDate: string;
  readonly plannedEndDate: string;
  readonly notes?: string | null;
  readonly lines?: readonly SubcontractLineInput[];
}

export interface UpdateSubcontractCommand extends SubcontractTermsInput {
  readonly supplierId?: string;
  readonly titleAr?: string;
  readonly kind?: SubcontractKind;
  readonly disguisedEmploymentReviewed?: boolean;
  readonly reviewNote?: string | null;
  readonly signedDate?: string;
  readonly startDate?: string;
  readonly plannedEndDate?: string;
  readonly notes?: string | null;
}

/** المحتجزات — held, released, what is still releasable and when it falls due. */
export interface SubcontractRetentionPosition {
  readonly held: Money;
  readonly released: Money;
  readonly balance: Money;
  /** completionDate — the clock the release event hangs on. Null until the package is completed. */
  readonly completionDate: string | null;
  readonly defectsLiabilityMonths: number;
  /** completionDate, for the tranche released when the sub finishes. */
  readonly provisionalReleaseEventDate: string | null;
  /** completionDate + فترة الضمان, for the last tranche. */
  readonly finalReleaseEventDate: string | null;
  readonly releases: readonly SubcontractRetentionRelease[];
}

/** The subcontract plus everything the server derives for the screen and the print. */
export interface SubcontractView {
  readonly subcontract: Subcontract;
  readonly contractDocNo: string;
  readonly contractTitleAr: string;
  readonly supplierNameAr: string;
  readonly value: Money;
  /** The same quantities at the CLIENT's rates. */
  readonly clientValue: Money;
  readonly margin: Money;
  readonly advancePaid: Money;
  readonly advanceRecovered: Money;
  readonly advanceOutstanding: Money;
  readonly retention: SubcontractRetentionPosition;
  /** Σ of the latest POSTED certificate's cumulative net certified value. */
  readonly certifiedToDate: Money;
  /** value − certifiedToDate, floored at zero — the committed cost still ahead. */
  readonly remainingCommitment: Money;
  readonly certificateCount: number;
  /** Why the subcontract cannot be activated or certified yet, in Arabic. Empty when it can. */
  readonly payabilityRefusals: readonly string[];
}

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

function percentOfInput(
  reasons: string[],
  label: string,
  value: string | null | undefined,
  fallback: string,
): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (!PERCENT.test(value)) {
    reasons.push(`${label} يجب أن تكون نسبة عشرية موجبة`);
    return fallback;
  }
  return value;
}

export class SubcontractService {
  constructor(private readonly deps: SubcontractServiceDeps) {}

  private today(): string {
    return this.deps.today ? this.deps.today() : tenantTodayIso();
  }

  private async routed(key: string): Promise<string> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    const accountId = routedAccountId(routing, key);
    if (accountId === null) {
      throw new InvalidSubcontractError([`لم يُحدَّد حساب لتوجيه "${key}" في جدول توجيه الحسابات.`]);
    }
    return accountId;
  }

  // ----- reads -------------------------------------------------------------

  async list(filter?: SubcontractListFilter): Promise<SubcontractView[]> {
    const rows = await this.deps.store.list(filter);
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async find(idOrDocNo: string): Promise<Subcontract | null> {
    return (await this.deps.store.findById(idOrDocNo)) ?? (await this.deps.store.findByDocNo(idOrDocNo));
  }

  async require(idOrDocNo: string): Promise<Subcontract> {
    const found = await this.find(idOrDocNo);
    if (!found) throw new SubcontractNotFoundError(idOrDocNo);
    return found;
  }

  async get(idOrDocNo: string): Promise<SubcontractView> {
    return this.view(await this.require(idOrDocNo));
  }

  async view(subcontract: Subcontract): Promise<SubcontractView> {
    const [contract, supplier, certificates] = await Promise.all([
      this.deps.contracts.findContractById(subcontract.contractId),
      this.deps.suppliers?.find(subcontract.supplierId) ?? Promise.resolve(null),
      this.deps.store.listCertificatesBySubcontract(subcontract.id),
    ]);
    const value = computeSubcontractValue(subcontract.lines);
    const clientValue = computeSubcontractClientValue(subcontract.lines);
    const posted = certificates.filter(
      (c) => isLiveSubCertificate(c) && (c.status === "approved_for_payment" || c.status === "invoiced"),
    );
    const advancePaid = Money.sum(subcontract.advances.map((a) => a.amount));
    const advanceRecovered = Money.sum(
      posted.map(
        (c) => c.computed.deductions.find((d) => d.key === "advanceRecovery")?.thisCertificate ?? Money.zero(),
      ),
    );
    const held = Money.sum(
      posted.map((c) => c.computed.deductions.find((d) => d.key === "retention")?.thisCertificate ?? Money.zero()),
    );
    const released = Money.sum(subcontract.retentionReleases.map((r) => r.amount));
    const lastPosted = posted.length === 0 ? null : posted[posted.length - 1];
    const certifiedToDate = lastPosted?.computed.netCertified ?? Money.zero();
    return {
      subcontract,
      contractDocNo: contract?.docNo ?? subcontract.contractId,
      contractTitleAr: contract?.titleAr ?? "",
      supplierNameAr: supplier?.nameAr ?? subcontract.supplierId,
      value,
      clientValue,
      margin: Money.fromScaled(clientValue.scaled - value.scaled),
      advancePaid,
      advanceRecovered,
      advanceOutstanding: Money.fromScaled(advancePaid.scaled - advanceRecovered.scaled),
      certifiedToDate,
      remainingCommitment: remainingCommitmentOf(value, certifiedToDate),
      retention: {
        held,
        released,
        balance: Money.fromScaled(held.scaled - released.scaled),
        completionDate: subcontract.completedAt,
        defectsLiabilityMonths: subcontract.defectsLiabilityMonths,
        provisionalReleaseEventDate: subcontractReleaseEventDate("provisional", subcontract),
        finalReleaseEventDate: subcontractReleaseEventDate("final", subcontract),
        releases: subcontract.retentionReleases,
      },
      certificateCount: certificates.filter(isLiveSubCertificate).length,
      payabilityRefusals: payabilityRefusals(subcontract.supplierId, supplier),
    };
  }

  async retentionPosition(idOrDocNo: string): Promise<SubcontractRetentionPosition> {
    return (await this.get(idOrDocNo)).retention;
  }

  // ----- building ----------------------------------------------------------

  private async requireContract(contractId: string): Promise<WorksContract> {
    const contract = await this.deps.contracts.findContractById(contractId);
    if (!contract) throw new InvalidSubcontractError([`العقد "${contractId}" غير موجود`]);
    return contract;
  }

  /**
   * Back-to-back: every sub line names a CLIENT BOQ line, and the description,
   * the unit and the client rate are stamped from it. A sub line that could
   * name nothing is how a subcontract stops being comparable to the work it
   * was let against.
   */
  private buildLines(
    subcontractId: string,
    boqLines: readonly BoqLine[],
    inputs: readonly SubcontractLineInput[],
  ): SubcontractLine[] {
    const reasons: string[] = [];
    const byId = new Map(boqLines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const lines = inputs.map((input, index) => {
      const client = byId.get(input.clientBoqLineId);
      if (!client) {
        reasons.push(`البند "${input.clientBoqLineId}" غير موجود في جدول كميات العقد`);
      }
      if (client && seen.has(client.id)) {
        reasons.push(`البند "${client.code}" مكرر في بنود عقد الباطن`);
      }
      if (client) seen.add(client.id);
      const qty = qtyOf(reasons, `كمية البند "${client?.code ?? input.clientBoqLineId}"`, input.qty);
      const unitRate = moneyOf(reasons, `فئة البند "${client?.code ?? input.clientBoqLineId}"`, input.unitRate);
      if (qty.isZero() || qty.isNegative()) {
        reasons.push(`البند "${client?.code ?? input.clientBoqLineId}": الكمية يجب أن تكون رقمًا موجبًا`);
      }
      if (unitRate.scaled < 0n) {
        reasons.push(`البند "${client?.code ?? input.clientBoqLineId}": الفئة يجب ألا تكون سالبة`);
      }
      // The sub's quantity may not exceed what the client contract carries on
      // the same line: a package let for more than was sold is a loss the
      // moment it is certified.
      if (client && qty.compare(client.qty) > 0) {
        reasons.push(
          `البند "${client.code} — ${client.descriptionAr}": كمية الباطن ${qty.toString()} تتجاوز الكمية التعاقدية مع العميل ${client.qty.toString()}`,
        );
      }
      const clientUnitRate = client?.unitRate ?? Money.zero();
      return {
        id: input.id?.trim() ? input.id.trim() : `${subcontractId}-L${index + 1}`,
        subcontractId,
        clientBoqLineId: input.clientBoqLineId,
        code: client?.code ?? input.clientBoqLineId,
        descriptionAr: input.descriptionAr?.trim() ? input.descriptionAr.trim() : (client?.descriptionAr ?? ""),
        unit: client?.unit ?? "lump_sum",
        qty,
        unitRate,
        clientUnitRate,
        marginVsClient: lineMarginVsClient(clientUnitRate, unitRate),
        estimatedUnitCost:
          input.estimatedUnitCost === null || input.estimatedUnitCost === undefined || input.estimatedUnitCost === ""
            ? null
            : moneyOf(reasons, "التكلفة التقديرية للوحدة", input.estimatedUnitCost),
        sortOrder: index + 1,
      } satisfies SubcontractLine;
    });
    if (reasons.length > 0) throw new InvalidSubcontractError(reasons);
    return lines;
  }

  private terms(reasons: string[], input: SubcontractTermsInput, current?: Subcontract) {
    return {
      retentionPercent: percentOfInput(reasons, "نسبة المحتجزات", input.retentionPercent, current?.retentionPercent ?? "5"),
      retentionCapPercent:
        input.retentionCapPercent === undefined
          ? (current?.retentionCapPercent ?? null)
          : input.retentionCapPercent === null || input.retentionCapPercent === ""
            ? null
            : percentOfInput(reasons, "سقف المحتجزات", input.retentionCapPercent, "10"),
      advancePercent: percentOfInput(reasons, "نسبة الدفعة المقدمة", input.advancePercent, current?.advancePercent ?? "0"),
      advanceRecoveryPercent: percentOfInput(
        reasons,
        "نسبة خصم الدفعة المقدمة",
        input.advanceRecoveryPercent,
        current?.advanceRecoveryPercent ?? "0",
      ),
      withholdingTaxPercent: percentOfInput(
        reasons,
        "نسبة ضريبة الخصم والتحصيل",
        input.withholdingTaxPercent,
        current?.withholdingTaxPercent ?? "1",
      ),
      deemedWagePercent: percentOfInput(reasons, "نسبة الأجر الافتراضي", input.deemedWagePercent, current?.deemedWagePercent ?? "20"),
      socialInsuranceRatePercent: percentOfInput(
        reasons,
        "نسبة التأمينات الاجتماعية",
        input.socialInsuranceRatePercent,
        current?.socialInsuranceRatePercent ?? "18.75",
      ),
      withholdSocialInsurance: input.withholdSocialInsurance ?? current?.withholdSocialInsurance ?? false,
      socialInsuranceNote:
        input.socialInsuranceNote !== undefined ? input.socialInsuranceNote : (current?.socialInsuranceNote ?? null),
      penaltyCapPercent: percentOfInput(reasons, "سقف غرامة التأخير", input.penaltyCapPercent, current?.penaltyCapPercent ?? "10"),
      paymentTermDays: input.paymentTermDays ?? current?.paymentTermDays ?? 30,
      defectsLiabilityMonths: input.defectsLiabilityMonths ?? current?.defectsLiabilityMonths ?? 12,
      vatBasis: input.vatBasis ?? current?.vatBasis ?? ("standard" as const),
    };
  }

  // ----- use cases ---------------------------------------------------------

  async create(cmd: CreateSubcontractCommand, actor: SubcontractActor): Promise<SubcontractView> {
    const reasons: string[] = [];
    if (cmd.titleAr.trim() === "") reasons.push("اسم عقد الباطن مطلوب");
    if (cmd.supplierId.trim() === "") reasons.push("مقاول الباطن مطلوب");
    for (const [label, value] of [
      ["تاريخ التوقيع", cmd.signedDate],
      ["تاريخ البدء", cmd.startDate],
      ["تاريخ الانتهاء المخطط", cmd.plannedEndDate],
    ] as const) {
      if (!ISO_DATE.test(value)) reasons.push(`${label} مطلوب بصيغة YYYY-MM-DD`);
    }
    if (ISO_DATE.test(cmd.startDate) && ISO_DATE.test(cmd.plannedEndDate) && cmd.plannedEndDate < cmd.startDate) {
      reasons.push("تاريخ الانتهاء المخطط يسبق تاريخ البدء");
    }
    const terms = this.terms(reasons, cmd);
    if (reasons.length > 0) throw new InvalidSubcontractError(reasons);

    const contract = await this.requireContract(cmd.contractId);
    if (contract.status === "completed" || contract.status === "terminated") {
      throw new InvalidSubcontractError([
        `لا يمكن إبرام عقد باطن تحت عقد حالته "${contract.status}".`,
      ]);
    }
    if (this.deps.suppliers && !(await this.deps.suppliers.find(cmd.supplierId))) {
      throw new InvalidSubcontractError([`المورد "${cmd.supplierId}" غير موجود`]);
    }
    const boqLines = await this.deps.contracts.listBoqLines(contract.id);
    const lines = this.buildLines(cmd.id, boqLines, cmd.lines ?? []);

    return this.deps.store.transaction(async () => {
      const number = await this.deps.numbering.next(SUBCONTRACT_SEQUENCE);
      const subcontract: Subcontract = {
        ...terms,
        id: cmd.id,
        docNo: number.formatted,
        contractId: contract.id,
        projectId: contract.projectId,
        supplierId: cmd.supplierId,
        titleAr: cmd.titleAr.trim(),
        kind: cmd.kind ?? "works",
        disguisedEmploymentReviewed: cmd.disguisedEmploymentReviewed ?? false,
        reviewNote: cmd.reviewNote ?? null,
        signedDate: cmd.signedDate,
        startDate: cmd.startDate,
        plannedEndDate: cmd.plannedEndDate,
        currency: contract.currency,
        status: "draft",
        activatedAt: null,
        completedAt: null,
        terminatedAt: null,
        notes: cmd.notes ?? null,
        createdBy: actor.userId,
        advances: [],
        retentionReleases: [],
        lines,
      };
      await this.deps.store.insert(subcontract);
      return this.view(subcontract);
    });
  }

  async update(idOrDocNo: string, cmd: UpdateSubcontractCommand): Promise<SubcontractView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft") {
      throw new InvalidSubcontractError([
        `لا يمكن تعديل عقد باطن حالته "${getSubcontractStatusLabel(current.status)}" — التعديل يكون بأمر تغيير على البنود.`,
      ]);
    }
    const reasons: string[] = [];
    for (const [label, value] of [
      ["تاريخ التوقيع", cmd.signedDate],
      ["تاريخ البدء", cmd.startDate],
      ["تاريخ الانتهاء المخطط", cmd.plannedEndDate],
    ] as const) {
      if (value !== undefined && !ISO_DATE.test(value)) reasons.push(`${label} مطلوب بصيغة YYYY-MM-DD`);
    }
    const terms = this.terms(reasons, cmd, current);
    if (reasons.length > 0) throw new InvalidSubcontractError(reasons);
    if (cmd.supplierId && this.deps.suppliers && !(await this.deps.suppliers.find(cmd.supplierId))) {
      throw new InvalidSubcontractError([`المورد "${cmd.supplierId}" غير موجود`]);
    }
    const next: Subcontract = {
      ...current,
      ...terms,
      supplierId: cmd.supplierId ?? current.supplierId,
      titleAr: cmd.titleAr?.trim() ? cmd.titleAr.trim() : current.titleAr,
      kind: cmd.kind ?? current.kind,
      disguisedEmploymentReviewed: cmd.disguisedEmploymentReviewed ?? current.disguisedEmploymentReviewed,
      reviewNote: cmd.reviewNote !== undefined ? cmd.reviewNote : current.reviewNote,
      signedDate: cmd.signedDate ?? current.signedDate,
      startDate: cmd.startDate ?? current.startDate,
      plannedEndDate: cmd.plannedEndDate ?? current.plannedEndDate,
      notes: cmd.notes !== undefined ? cmd.notes : current.notes,
    };
    await this.deps.store.save(next);
    return this.view(next);
  }

  /** البنود — replaced wholesale while the subcontract is still a draft. */
  async replaceLines(idOrDocNo: string, inputs: readonly SubcontractLineInput[]): Promise<SubcontractView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft") {
      throw new InvalidSubcontractError([
        `لا يمكن تعديل بنود عقد باطن حالته "${getSubcontractStatusLabel(current.status)}".`,
      ]);
    }
    const boqLines = await this.deps.contracts.listBoqLines(current.contractId);
    const next: Subcontract = { ...current, lines: this.buildLines(current.id, boqLines, inputs) };
    await this.deps.store.save(next);
    return this.view(next);
  }

  /**
   * التفعيل. The payability gate bites HERE and again at every certificate
   * posting: Egypt withholds tax on the payment and remits it under the
   * subcontractor's own tax number, and money leaves through a bank account.
   */
  async activate(idOrDocNo: string, activatedAt: string): Promise<SubcontractView> {
    const current = await this.moveable(idOrDocNo, "active");
    if (!ISO_DATE.test(activatedAt)) throw new InvalidSubcontractError(["تاريخ السريان مطلوب بصيغة YYYY-MM-DD"]);
    if (current.lines.length === 0) {
      throw new InvalidSubcontractError(["لا يمكن تفعيل عقد باطن بلا بنود."]);
    }
    if (current.kind === "labour_only" && !current.disguisedEmploymentReviewed) {
      throw new InvalidSubcontractError([
        "عقد عمالة بالمقاولة يحتاج إقرارًا بمراجعة تكييفه الضريبي والتأميني قبل التفعيل.",
      ]);
    }
    await this.assertPayable(current, "تفعيل عقد الباطن");
    const next: Subcontract = { ...current, status: "active", activatedAt };
    await this.deps.store.save(next);
    return this.view(next);
  }

  async complete(idOrDocNo: string, completedAt: string): Promise<SubcontractView> {
    const current = await this.moveable(idOrDocNo, "completed");
    if (!ISO_DATE.test(completedAt)) throw new InvalidSubcontractError(["تاريخ الإنهاء مطلوب بصيغة YYYY-MM-DD"]);
    const open = (await this.deps.store.listCertificatesBySubcontract(current.id)).filter(
      (c) => isLiveSubCertificate(c) && c.status !== "invoiced" && c.status !== "approved_for_payment",
    );
    if (open.length > 0) {
      throw new InvalidSubcontractError([
        `لا يمكن إنهاء عقد الباطن ومستخلصات قيد الاعتماد قائمة: ${open.map((c) => c.docNo).join("، ")}.`,
      ]);
    }
    const next: Subcontract = { ...current, status: "completed", completedAt };
    await this.deps.store.save(next);
    return this.view(next);
  }

  async terminate(idOrDocNo: string, terminatedAt: string, reason: string | null): Promise<SubcontractView> {
    const current = await this.moveable(idOrDocNo, "terminated");
    if (!ISO_DATE.test(terminatedAt)) throw new InvalidSubcontractError(["تاريخ الفسخ مطلوب بصيغة YYYY-MM-DD"]);
    const next: Subcontract = {
      ...current,
      status: "terminated",
      terminatedAt,
      notes: reason ?? current.notes,
    };
    await this.deps.store.save(next);
    return this.view(next);
  }

  private async moveable(idOrDocNo: string, to: SubcontractStatus): Promise<Subcontract> {
    const current = await this.require(idOrDocNo);
    if (!canTransitionSubcontract(current.status, to) || current.status === to) {
      throw new InvalidSubcontractTransitionError(current.status, to);
    }
    return current;
  }

  /**
   * دفعة مقدمة لمقاول الباطن — LINKS an already-confirmed payment voucher
   * rather than paying anything itself. The recovery ceiling on every later
   * certificate is the sum of these, so the figure has to be money that
   * actually left the treasury against this supplier.
   */
  async linkAdvance(idOrDocNo: string, voucherId: string): Promise<SubcontractView> {
    const current = await this.require(idOrDocNo);
    if (current.status === "completed" || current.status === "terminated") {
      throw new InvalidSubcontractError([
        `لا يمكن ربط دفعة مقدمة بعقد باطن حالته "${getSubcontractStatusLabel(current.status)}".`,
      ]);
    }
    if (!this.deps.vouchers) {
      throw new InvalidSubcontractError(["ربط الدفعات المقدمة غير مُفعّل على هذا الخادم."]);
    }
    if (current.advances.some((a) => a.voucherId === voucherId)) {
      throw new InvalidSubcontractError([`السند "${voucherId}" مرتبط بالفعل بهذا العقد.`]);
    }
    const voucher = await this.deps.vouchers.find(voucherId);
    if (!voucher) throw new InvalidSubcontractError([`السند "${voucherId}" غير موجود`]);
    const advanceAccount = await this.routed(SUPPLIER_ADVANCES_ROUTING_KEY);
    const reasons: string[] = [];
    if (voucher.status !== "confirmed") reasons.push(`السند "${voucher.docNo ?? voucherId}" غير مؤكد`);
    if (voucher.direction !== "payment") reasons.push(`السند "${voucher.docNo ?? voucherId}" ليس سند صرف`);
    if (voucher.supplierId !== null && voucher.supplierId !== current.supplierId) {
      reasons.push(`السند "${voucher.docNo ?? voucherId}" مُحرَّر لمورد آخر`);
    }
    if (voucher.counterpartyGlAccountId !== advanceAccount) {
      reasons.push(
        `السند "${voucher.docNo ?? voucherId}" لم يُرحَّل إلى حساب سلف الموردين ${advanceAccount} — الدفعة المقدمة أصل يُسترد، لا سدادًا لفاتورة`,
      );
    }
    if (voucher.amount.scaled <= 0n) reasons.push("قيمة الدفعة المقدمة يجب أن تكون موجبة");
    if (reasons.length > 0) throw new InvalidSubcontractError(reasons);

    const advance: SubcontractAdvancePayment = {
      voucherId: voucher.id,
      voucherNo: voucher.docNo,
      date: voucher.date,
      amount: voucher.amount,
    };
    const next: Subcontract = { ...current, advances: [...current.advances, advance] };
    await this.deps.store.save(next);
    return this.view(next);
  }

  /**
   * الإفراج عن المحتجزات — raised as an AP DOCUMENT, never as a bare journal.
   *
   * INVARIANT: the release is a purchase invoice whose single expense line
   * debits the retention-payable account, so its OWN posting is Dr 2195 / Cr AP
   * and the payables sub-ledger moves by exactly what GL 2100 moved. A bare
   * Dr 2195 / Cr 2100 journal left the control account high with nothing in the
   * sub-ledger for a voucher to pay.
   *
   * The due date is the RELEASE EVENT, not the invoice date plus payment terms:
   * retention ages from when it becomes claimable (design §06).
   */
  async releaseRetention(
    idOrDocNo: string,
    input: {
      readonly amount: string;
      readonly date: string;
      readonly kind?: SubcontractRetentionReleaseKind;
      readonly notes?: string | null;
    },
    actor: SubcontractActor,
  ): Promise<SubcontractView> {
    const current = await this.require(idOrDocNo);
    const reasons: string[] = [];
    if (!ISO_DATE.test(input.date)) reasons.push("تاريخ الإفراج مطلوب بصيغة YYYY-MM-DD");
    const amount = moneyOf(reasons, "قيمة الإفراج", input.amount);
    if (amount.scaled <= 0n) reasons.push("قيمة الإفراج يجب أن تكون موجبة");
    if (reasons.length > 0) throw new InvalidSubcontractError(reasons);
    const invoicing = this.deps.retentionInvoicing;
    if (!invoicing) {
      throw new InvalidSubcontractError(["الإفراج عن محتجزات مقاولي الباطن غير مُفعّل على هذا الخادم."]);
    }
    await this.assertPayable(current, "الإفراج عن محتجزات مقاول الباطن");

    const position = (await this.view(current)).retention;
    if (amount.scaled > position.balance.scaled) {
      throw new SubcontractRetentionError(
        `لا يمكن الإفراج عن ${amount.toString()}: رصيد المحتجزات المتاح لمقاول الباطن ${position.balance.toString()} فقط.`,
      );
    }

    const kind: SubcontractRetentionReleaseKind = input.kind ?? "final";
    const releaseEventDate = subcontractReleaseEventDate(kind, current);
    const retentionAccount = await this.routed("contracting.retention_payable");
    const releaseId = `${current.id}-RET-${current.retentionReleases.length + 1}`;

    const saved = await this.deps.store.transaction(async () => {
      const invoice = await invoicing.issue({
        releaseId,
        subcontractId: current.id,
        subcontractDocNo: current.docNo,
        supplierId: current.supplierId,
        projectId: current.projectId,
        date: input.date,
        dueDate: releaseEventDate ?? input.date,
        amount,
        retentionAccountId: retentionAccount,
        lineDescriptionAr: `الإفراج عن محتجزات مقاول الباطن ${current.docNo}`,
        memoAr: `الإفراج عن محتجزات مقاول الباطن ${current.docNo} — ${getSubcontractRetentionReleaseKindLabel(kind)}.`,
        actor: actor.userId,
      });
      const release: SubcontractRetentionRelease = {
        id: releaseId,
        date: input.date,
        amount,
        journalEntryId: invoice.journalEntryId,
        kind,
        releaseEventDate,
        earlyRelease: isEarlySubcontractRelease(input.date, releaseEventDate),
        invoiceId: invoice.invoiceId,
        invoiceDocNo: invoice.invoiceDocNo,
        releasedBy: actor.userId,
        notes: input.notes ?? null,
      };
      const next: Subcontract = { ...current, retentionReleases: [...current.retentionReleases, release] };
      await this.deps.store.save(next);
      return next;
    });
    await recordTransition(this.deps.audit, {
      entityType: "SUBCONTRACT_RETENTION_RELEASE",
      entityId: releaseId,
      action: "RELEASE",
      actor: actor.userId,
      severity: "WARNING",
      details: {
        subcontractId: current.id,
        subcontractDocNo: current.docNo,
        supplierId: current.supplierId,
        amount: amount.toString(),
        date: input.date,
        kind,
        releaseEventDate,
        earlyRelease: isEarlySubcontractRelease(input.date, releaseEventDate),
      },
    });
    return this.view(saved);
  }

  /** The gate, reused by the certificate service at every posting step. */
  async assertPayable(subcontract: Subcontract, action: string): Promise<void> {
    if (!this.deps.suppliers) return;
    const supplier = await this.deps.suppliers.find(subcontract.supplierId);
    const reasons = payabilityRefusals(subcontract.supplierId, supplier).map((r) => `لا يمكن ${action}: ${r}`);
    if (reasons.length > 0) throw new SubcontractorNotPayableError(subcontract.supplierId, reasons);
  }
}

/**
 * The two things a subcontractor must carry before a certificate can be
 * posted against it. Stated as a LIST rather than a first-failure, so the
 * screen can show both at once instead of making the user discover them one
 * save at a time.
 */
export function payabilityRefusals(
  supplierId: string,
  supplier: { readonly nameAr: string; readonly taxNumber: string | null; readonly bankAccount: string | null } | null,
): string[] {
  if (!supplier) return [`مقاول الباطن "${supplierId}" غير موجود.`];
  const reasons: string[] = [];
  if (!supplier.taxNumber || supplier.taxNumber.trim() === "") {
    reasons.push(`مقاول الباطن "${supplier.nameAr}" بلا رقم ضريبي — ضريبة الخصم والتحصيل تُورَّد باسمه.`);
  }
  if (!supplier.bankAccount || supplier.bankAccount.trim() === "") {
    reasons.push(`مقاول الباطن "${supplier.nameAr}" بلا حساب بنكي.`);
  }
  return reasons;
}
