import { Money, Qty } from "../../money/index.js";
import { routedAccountId, type AccountRoutingRepository } from "../../accounts/account-routing.js";
import type { NextNumberService } from "../../numbering/index.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import { postJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../../gl/index.js";
import type { WorksContractStore } from "../contracts/contract.js";
import {
  completionPercentOf,
  computeCertificate,
  extendQty,
  percentOf,
  subtract,
  toPiastres,
} from "../certificates/amounts.js";
import type { CertificateComputation } from "../certificates/certificate.js";
import { subcontractCertificateTerms } from "./amounts.js";
import {
  InvalidSubCertificateError,
  InvalidSubCertificateTransitionError,
  LaterSubCertificateExistsError,
  SubCertificateDeductionError,
  SubCertificateNotFoundError,
  SubCertificateQuantityError,
  SubCertificateSegregationError,
} from "./errors.js";
import type {
  ClientCertifiedQuantityPort,
  SubCertificateInvoiceStatus,
  SubCertificateInvoicingPort,
  SubcontractConsumptionPort,
  SubcontractSupplierPort,
} from "./ports.js";
import {
  EDITABLE_SUB_CERTIFICATE_STATUSES,
  getSubCertificateStatusLabel,
  isLiveSubCertificate,
  type SubCertificate,
  type SubCertificateDerivedStatus,
  type SubCertificateListFilter,
  type SubCertificateStatus,
  type SubCertificateWorkLine,
  type SubcontractStore,
} from "./sub-certificate.js";
import { payabilityRefusals } from "./subcontract-service.js";
import type { Subcontract, SubcontractLine } from "./subcontract.js";
import { tenantTodayIso } from "../../dates.js";

/**
 * مستخلص مقاول باطن — the use cases and the ledger behind them (design §03
 * "THE MIRROR", D-04, D-05).
 *
 * The block is the CLIENT certificate's block, struck at the subcontractor's
 * own percentages and posted with the opposite sign: a purchase invoice
 * debiting أعمال تحت التنفيذ instead of a sales invoice crediting billings, and
 * a deductions entry DEBITING AP instead of crediting AR. The only figures a
 * caller supplies are this period's quantities and the four manual cumulative
 * deduction amounts.
 */

export const SUB_CERTIFICATE_DOC_TYPE = "SUBCONTRACT_CERTIFICATE";
const SUB_CERTIFICATE_SEQUENCE = "SUBCONTRACT_CERTIFICATE";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** «خصم مواد مصروفة للمقاول» — the sub side's name for the shared `employerMaterials` row. */
const EMPLOYER_MATERIALS_LABEL_AR = "خصم مواد مصروفة للمقاول";

export interface SubCertificateActor {
  readonly userId: string;
  readonly wildcardAdmin: boolean;
}

export interface SubCertificateServiceDeps {
  readonly store: SubcontractStore;
  readonly contracts: WorksContractStore;
  readonly numbering: NextNumberService;
  readonly gl: JournalPostingDeps;
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  readonly invoicing?: SubCertificateInvoicingPort;
  readonly suppliers?: SubcontractSupplierPort;
  /** The client certificates, for the back-to-back ceiling. */
  readonly clientCertificates?: ClientCertifiedQuantityPort;
  /** Slice 4A's consumptions that name this subcontract, for the materials prefill. */
  readonly consumptions?: SubcontractConsumptionPort;
  /** سجل العمليات الحساسة — every transition below is recorded against the sub certificate. */
  readonly audit?: AuditSink;
  /** Reads the tenant's `contracting.singleOperatorMode`; false waives nothing. */
  readonly segregationWaived?: (actor: SubCertificateActor) => Promise<boolean>;
  readonly today?: () => string;
}

export interface SubCertificateWorkLineInput {
  readonly subcontractLineId: string;
  readonly thisPeriodQty: string;
}

export interface SubCertificateDraftInput {
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly executionDate?: string | null;
  readonly isFinal?: boolean;
  readonly workLines?: readonly SubCertificateWorkLineInput[];
  readonly penaltiesCumulative?: string;
  readonly suspendedCumulative?: string;
  readonly employerMaterialsCumulative?: string;
  readonly waterElectricityCumulative?: string;
  readonly notes?: string | null;
}

export interface CreateSubCertificateCommand extends SubCertificateDraftInput {
  readonly id: string;
  readonly subcontractId: string;
}

export interface UpdateSubCertificateCommand extends Partial<SubCertificateDraftInput> {}

export interface PreviewSubCertificateCommand extends SubCertificateDraftInput {
  readonly subcontractId: string;
  readonly certificateId?: string | null;
}

export interface SubCertificateView {
  readonly certificate: SubCertificate;
  readonly derivedStatus: SubCertificateDerivedStatus;
  readonly subcontractDocNo: string;
  readonly subcontractTitleAr: string;
  readonly supplierNameAr: string;
  /** الرقم الضريبي لمقاول الباطن — printed on the certificate, both parties named. */
  readonly supplierTaxNumber: string | null;
  readonly contractDocNo: string;
  readonly invoice: SubCertificateInvoiceStatus | null;
  /** True when a later certificate exists — every action on this one is refused. */
  readonly hasLaterCertificate: boolean;
  /** Why posting would be refused today: the subcontractor's own missing data. */
  readonly payabilityRefusals: readonly string[];
}

export interface SubCertificatePreview {
  readonly serial: number;
  readonly executionDate: string;
  readonly workLines: readonly SubCertificateWorkLine[];
  readonly computed: CertificateComputation;
  readonly refusals: readonly string[];
  /** Σ of the confirmed site consumptions that name this subcontract — the prefill, overridable. */
  readonly employerMaterialsPrefill: Money;
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

/** The shared block with the one row the sub side names differently. */
function relabel(computed: CertificateComputation): CertificateComputation {
  return {
    ...computed,
    deductions: computed.deductions.map((d) =>
      d.key === "employerMaterials" ? { ...d, labelAr: EMPLOYER_MATERIALS_LABEL_AR } : d,
    ),
  };
}

export class SubCertificateService {
  constructor(private readonly deps: SubCertificateServiceDeps) {}

  private today(): string {
    return this.deps.today ? this.deps.today() : tenantTodayIso();
  }

  private async routed(key: string): Promise<string> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    const accountId = routedAccountId(routing, key);
    if (accountId === null) {
      throw new InvalidSubCertificateError([`لم يُحدَّد حساب لتوجيه "${key}" في جدول توجيه الحسابات.`]);
    }
    return accountId;
  }

  // ----- reads -------------------------------------------------------------

  async list(filter?: SubCertificateListFilter): Promise<SubCertificateView[]> {
    const rows = await this.deps.store.listCertificates(filter);
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async find(idOrDocNo: string): Promise<SubCertificate | null> {
    return (
      (await this.deps.store.findCertificateById(idOrDocNo)) ??
      (await this.deps.store.findCertificateByDocNo(idOrDocNo))
    );
  }

  async get(idOrDocNo: string): Promise<SubCertificateView> {
    return this.view(await this.require(idOrDocNo));
  }

  private async require(idOrDocNo: string): Promise<SubCertificate> {
    const found = await this.find(idOrDocNo);
    if (!found) throw new SubCertificateNotFoundError(idOrDocNo);
    return found;
  }

  async view(certificate: SubCertificate): Promise<SubCertificateView> {
    const [subcontract, invoice, siblings] = await Promise.all([
      this.deps.store.findById(certificate.subcontractId),
      certificate.invoiceId
        ? ((await this.deps.invoicing?.status(certificate.invoiceId)) ?? null)
        : Promise.resolve(null),
      this.deps.store.listCertificatesBySubcontract(certificate.subcontractId),
    ]);
    const [contract, supplier] = await Promise.all([
      this.deps.contracts.findContractById(certificate.contractId),
      this.deps.suppliers?.find(certificate.supplierId) ?? Promise.resolve(null),
    ]);
    return {
      certificate,
      derivedStatus:
        certificate.status === "invoiced" && invoice !== null && invoice.remainingBalance.scaled <= 0n
          ? "paid"
          : certificate.status,
      subcontractDocNo: subcontract?.docNo ?? certificate.subcontractId,
      subcontractTitleAr: subcontract?.titleAr ?? "",
      supplierNameAr: supplier?.nameAr ?? certificate.supplierId,
      supplierTaxNumber: supplier?.taxNumber ?? null,
      contractDocNo: contract?.docNo ?? certificate.contractId,
      invoice,
      hasLaterCertificate: siblings.some((s) => isLiveSubCertificate(s) && s.serial > certificate.serial),
      payabilityRefusals: payabilityRefusals(certificate.supplierId, supplier),
    };
  }

  // ----- context -----------------------------------------------------------

  private async requireSubcontract(subcontractId: string): Promise<Subcontract> {
    const subcontract = await this.deps.store.findById(subcontractId);
    if (!subcontract) throw new InvalidSubCertificateError([`عقد الباطن "${subcontractId}" غير موجود`]);
    return subcontract;
  }

  /**
   * The advance actually PAID to this subcontractor and what is still owed
   * back. Read off the linked confirmed vouchers and the posted certificates,
   * never off anything a caller sends: the recovery cap is "never more than
   * what went out", and a figure derived from progress would keep recovering
   * after the advance was repaid.
   */
  private async advancePosition(
    subcontract: Subcontract,
    excludeCertificateId?: string,
  ): Promise<{ paid: Money; outstanding: Money }> {
    const paid = Money.sum(subcontract.advances.map((a) => a.amount));
    const posted = (await this.deps.store.listCertificatesBySubcontract(subcontract.id)).filter(
      (c) =>
        isLiveSubCertificate(c) &&
        c.id !== excludeCertificateId &&
        (c.status === "approved_for_payment" || c.status === "invoiced"),
    );
    const recovered = Money.sum(
      posted.map(
        (c) => c.computed.deductions.find((d) => d.key === "advanceRecovery")?.thisCertificate ?? Money.zero(),
      ),
    );
    return { paid, outstanding: Money.fromScaled(paid.scaled - recovered.scaled) };
  }

  /** What the consultant has certified to the EMPLOYER, per client BOQ line. */
  private async clientCeiling(contractId: string): Promise<ReadonlyMap<string, Qty>> {
    if (!this.deps.clientCertificates) return new Map();
    return this.deps.clientCertificates.certifiedCumulativeByBoqLine(contractId);
  }

  /**
   * What the OTHER subcontracts on the same client contract have already had
   * certified against each client BOQ line.
   *
   * INVARIANT: the employer's certified quantity is shared. Comparing one
   * sub's cumulative against the full client figure lets two subs on the same
   * line be paid for the same metre twice, which is the classic back-to-back
   * leak, so each sub's ceiling is the client figure LESS what its peers hold.
   * Only committed certificates count — a peer still at حصر is one nobody has
   * signed.
   */
  private async peerCertifiedByClientLine(
    contractId: string,
    excludeSubcontractId: string,
  ): Promise<ReadonlyMap<string, Qty>> {
    const rows = await this.deps.store.listCertificates({ contractId });
    const latestBySubcontract = new Map<string, SubCertificate>();
    for (const row of rows) {
      if (row.subcontractId === excludeSubcontractId || !isLiveSubCertificate(row)) continue;
      if (row.status !== "certified" && row.status !== "approved_for_payment" && row.status !== "invoiced") {
        continue;
      }
      const held = latestBySubcontract.get(row.subcontractId);
      if (!held || row.serial > held.serial) latestBySubcontract.set(row.subcontractId, row);
    }
    const map = new Map<string, Qty>();
    for (const certificate of latestBySubcontract.values()) {
      for (const line of certificate.workLines) {
        map.set(line.clientBoqLineId, (map.get(line.clientBoqLineId) ?? Qty.zero()).add(line.cumulativeQty));
      }
    }
    return map;
  }

  private buildWorkLines(
    certificateId: string,
    lines: readonly SubcontractLine[],
    previous: SubCertificate | null,
    inputs: readonly SubCertificateWorkLineInput[],
    ceiling: ReadonlyMap<string, Qty>,
    reasons: string[],
    stamped: readonly SubCertificateWorkLine[],
  ): SubCertificateWorkLine[] {
    const byId = new Map(inputs.map((i) => [i.subcontractLineId, i]));
    const stampedById = new Map(stamped.map((l) => [l.boqLineId, l]));
    const previousById = new Map((previous?.workLines ?? []).map((l) => [l.boqLineId, l]));
    for (const input of inputs) {
      if (!lines.some((l) => l.id === input.subcontractLineId)) {
        reasons.push(`البند "${input.subcontractLineId}" غير موجود في بنود عقد الباطن`);
      }
    }
    return lines.map((line, index) => {
      const input = byId.get(line.id);
      const thisPeriodQty = qtyOf(reasons, `كمية البند "${line.code}"`, input?.thisPeriodQty);
      const prior = previousById.get(line.id);
      const previousCumulativeQty = prior?.cumulativeQty ?? Qty.zero();
      const previousCumulativeValue = prior?.cumulativeValue ?? Money.zero();
      const cumulativeQty = previousCumulativeQty.add(thisPeriodQty);
      // The rate is stamped ONCE, when the certificate is created — re-reading
      // it from the subcontract later would restate a certificate that was signed.
      const unitRate = stampedById.get(line.id)?.unitRate ?? line.unitRate;
      const cumulativeValue = extendQty(cumulativeQty, unitRate);
      return {
        id: `${certificateId}-W${index + 1}`,
        boqLineId: line.id,
        clientBoqLineId: line.clientBoqLineId,
        clientCertifiedCumulativeQty: ceiling.get(line.clientBoqLineId) ?? Qty.zero(),
        code: line.code,
        descriptionAr: line.descriptionAr,
        unit: line.unit,
        unitRate,
        thisPeriodQty,
        previousCumulativeQty,
        cumulativeQty,
        contractedQty: line.qty,
        completionPercent: completionPercentOf(cumulativeQty, line.qty),
        previousCumulativeValue,
        cumulativeValue,
        thisPeriodValue: subtract(cumulativeValue, previousCumulativeValue),
        sortOrder: line.sortOrder,
      };
    });
  }

  /**
   * THE control this slice exists for (design §03 "THE MIRROR"): a sub line may
   * never be certified beyond what the consultant certified to the employer on
   * the client line it sits under. Both figures are named, because the argument
   * on site is always about which of the two is wrong.
   */
  private quantityRefusals(
    workLines: readonly SubCertificateWorkLine[],
    peerCertified: ReadonlyMap<string, Qty>,
  ): string[] {
    const reasons: string[] = [];
    for (const line of workLines) {
      if (line.cumulativeQty.isNegative()) {
        reasons.push(`الكمية التراكمية للبند "${line.code} — ${line.descriptionAr}" سالبة.`);
        continue;
      }
      if (line.cumulativeQty.compare(line.contractedQty) > 0) {
        reasons.push(
          `البند "${line.code} — ${line.descriptionAr}": الكمية التراكمية ${qtyText(line.cumulativeQty)} تتجاوز كمية عقد الباطن ${qtyText(line.contractedQty)}.`,
        );
        continue;
      }
      const peer = peerCertified.get(line.clientBoqLineId) ?? Qty.zero();
      const available = Qty.fromScaled(line.clientCertifiedCumulativeQty.scaled - peer.scaled);
      if (line.cumulativeQty.compare(available) > 0) {
        reasons.push(
          peer.isZero()
            ? `لا يجوز اعتماد كمية للمقاول تتجاوز ما اعتمده الاستشاري على البند "${line.code} — ${line.descriptionAr}": الكمية التراكمية للباطن ${qtyText(line.cumulativeQty)} والمعتمد للعميل ${qtyText(line.clientCertifiedCumulativeQty)}.`
            : `لا يجوز اعتماد كمية للمقاول تتجاوز المتاح على البند "${line.code} — ${line.descriptionAr}": المعتمد للعميل ${qtyText(line.clientCertifiedCumulativeQty)}، ومعتمد لمقاولي باطن آخرين ${qtyText(peer)}، فالمتاح ${qtyText(available)} والكمية التراكمية لهذا المقاول ${qtyText(line.cumulativeQty)}.`,
        );
      }
    }
    return reasons;
  }

  private async compose(
    certificateId: string,
    subcontract: Subcontract,
    previous: SubCertificate | null,
    input: SubCertificateDraftInput,
    stamped: readonly SubCertificateWorkLine[],
  ): Promise<{
    workLines: SubCertificateWorkLine[];
    computed: CertificateComputation;
    manual: {
      penaltiesCumulative: Money;
      suspendedCumulative: Money;
      employerMaterialsCumulative: Money;
      waterElectricityCumulative: Money;
    };
    executionDate: string;
  }> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(input.periodFrom)) reasons.push("تاريخ بداية الفترة مطلوب بصيغة YYYY-MM-DD");
    if (!ISO_DATE.test(input.periodTo)) reasons.push("تاريخ نهاية الفترة مطلوب بصيغة YYYY-MM-DD");
    const executionDate = input.executionDate ?? input.periodTo;
    if (!ISO_DATE.test(executionDate)) reasons.push("تاريخ التنفيذ مطلوب بصيغة YYYY-MM-DD");
    if (ISO_DATE.test(input.periodFrom) && ISO_DATE.test(input.periodTo) && input.periodTo < input.periodFrom) {
      reasons.push("تاريخ نهاية الفترة يسبق تاريخ بدايتها");
    }
    if (reasons.length > 0) throw new InvalidSubCertificateError(reasons);

    const ceiling = await this.clientCeiling(subcontract.contractId);
    const workLines = this.buildWorkLines(
      certificateId,
      subcontract.lines,
      previous,
      input.workLines ?? [],
      ceiling,
      reasons,
      stamped,
    );
    const manual = {
      penaltiesCumulative: moneyOf(reasons, "غرامة التأخير", input.penaltiesCumulative),
      suspendedCumulative: moneyOf(reasons, "التعليات", input.suspendedCumulative),
      employerMaterialsCumulative: moneyOf(reasons, EMPLOYER_MATERIALS_LABEL_AR, input.employerMaterialsCumulative),
      waterElectricityCumulative: moneyOf(reasons, "استهلاك المياه والكهرباء", input.waterElectricityCumulative),
    };
    if (reasons.length > 0) throw new InvalidSubCertificateError(reasons);

    const advance = await this.advancePosition(subcontract, certificateId);
    const computed = relabel(
      computeCertificate({
        terms: subcontractCertificateTerms(subcontract),
        workLines,
        materialLines: [],
        manual: {
          penalties: manual.penaltiesCumulative,
          suspended: manual.suspendedCumulative,
          employerMaterials: manual.employerMaterialsCumulative,
          waterElectricity: manual.waterElectricityCumulative,
        },
        previous: previous?.computed ?? null,
        contractValueAfterVariations: Money.sum(subcontract.lines.map((l) => extendQty(l.qty, l.unitRate))),
        advanceReceived: advance.paid,
        advanceOutstanding: advance.outstanding,
      }),
    );

    return { workLines, computed, manual, executionDate };
  }

  private async previousCertificate(subcontractId: string, excludeId?: string): Promise<SubCertificate | null> {
    const rows = (await this.deps.store.listCertificatesBySubcontract(subcontractId)).filter(
      (r) => isLiveSubCertificate(r) && r.id !== excludeId,
    );
    return rows.length === 0 ? null : (rows[rows.length - 1] as SubCertificate);
  }

  private async assertNoLaterCertificate(certificate: SubCertificate): Promise<void> {
    const later = (await this.deps.store.listCertificatesBySubcontract(certificate.subcontractId)).find(
      (r) => isLiveSubCertificate(r) && r.serial > certificate.serial,
    );
    if (later) throw new LaterSubCertificateExistsError(certificate.id, later.docNo, later.serial);
  }

  /**
   * INVARIANT: the prefill is rounded to piastres, the same boundary the
   * deduction is posted and printed on. A six-decimal WAC figure offered as a
   * deduction is a number nobody can pay — and one the cap below would then
   * refuse for being a piastre larger than itself.
   */
  private async materialsPrefill(subcontractId: string): Promise<Money> {
    return toPiastres((await this.deps.consumptions?.materialsIssuedTo(subcontractId)) ?? Money.zero());
  }

  // ----- use cases ---------------------------------------------------------

  /** The live block the «مستخلص باطن جديد» screen shows. Persists nothing. */
  async preview(cmd: PreviewSubCertificateCommand): Promise<SubCertificatePreview> {
    const subcontract = await this.requireSubcontract(cmd.subcontractId);
    const existing = cmd.certificateId ? await this.deps.store.findCertificateById(cmd.certificateId) : null;
    const previous = existing
      ? existing.previousCertificateId
        ? await this.deps.store.findCertificateById(existing.previousCertificateId)
        : null
      : await this.previousCertificate(subcontract.id);
    const composed = await this.compose(
      existing?.id ?? `${subcontract.id}-PREVIEW`,
      subcontract,
      previous,
      cmd,
      existing?.workLines ?? [],
    );
    return {
      serial: existing?.serial ?? (previous?.serial ?? 0) + 1,
      executionDate: composed.executionDate,
      workLines: composed.workLines,
      computed: composed.computed,
      refusals: [
        ...this.quantityRefusals(
          composed.workLines,
          await this.peerCertifiedByClientLine(subcontract.contractId, subcontract.id),
        ),
        ...(await this.deductionRefusals(composed.computed, subcontract)),
      ],
      employerMaterialsPrefill: await this.materialsPrefill(subcontract.id),
    };
  }

  async create(cmd: CreateSubCertificateCommand, actor: SubCertificateActor): Promise<SubCertificateView> {
    const subcontract = await this.requireSubcontract(cmd.subcontractId);
    if (subcontract.status !== "active") {
      throw new InvalidSubCertificateError([
        `لا يمكن إصدار مستخلص إلا على عقد باطن ساري — حالة العقد "${subcontract.status}".`,
      ]);
    }
    const all = await this.deps.store.listCertificatesBySubcontract(subcontract.id);
    const siblings = all.filter(isLiveSubCertificate);
    const previous = siblings.length === 0 ? null : (siblings[siblings.length - 1] as SubCertificate);
    // INVARIANT: the serial is monotonic over EVERY certificate of the
    // subcontract, cancelled ones included. Reusing a cancelled serial gives
    // two documents the same «مستخلص رقم ٣» and makes the audit trail unusable.
    const serial = all.reduce((max, row) => Math.max(max, row.serial), 0) + 1;
    if (previous?.isFinal) {
      throw new InvalidSubCertificateError([
        `المستخلص الختامي رقم ${previous.serial} أقفل كميات عقد الباطن — لا يجوز إصدار مستخلص بعده.`,
      ]);
    }
    const composed = await this.compose(cmd.id, subcontract, previous, cmd, []);

    return this.deps.store.transaction(async () => {
      if (await this.deps.store.findCertificateById(cmd.id)) {
        throw new InvalidSubCertificateError([`المستخلص "${cmd.id}" موجود بالفعل`]);
      }
      const number = await this.deps.numbering.next(SUB_CERTIFICATE_SEQUENCE);
      const certificate: SubCertificate = {
        id: cmd.id,
        docNo: number.formatted,
        subcontractId: subcontract.id,
        contractId: subcontract.contractId,
        projectId: subcontract.projectId,
        supplierId: subcontract.supplierId,
        serial,
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
        cancelledBy: null,
        cancelledAt: null,
        cancelReasonAr: null,
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
        computed: composed.computed,
      };
      await this.deps.store.saveCertificate(certificate);
      return this.view(certificate);
    });
  }

  async update(
    idOrDocNo: string,
    cmd: UpdateSubCertificateCommand,
    actor: SubCertificateActor,
  ): Promise<SubCertificateView> {
    const current = await this.require(idOrDocNo);
    if (!EDITABLE_SUB_CERTIFICATE_STATUSES.includes(current.status)) {
      throw new InvalidSubCertificateError([
        `لا يمكن تعديل مستخلص حالته "${getSubCertificateStatusLabel(current.status)}" — التصحيح يكون بكمية على المستخلص التالي.`,
      ]);
    }
    await this.assertNoLaterCertificate(current);
    const subcontract = await this.requireSubcontract(current.subcontractId);
    const previous = current.previousCertificateId
      ? await this.deps.store.findCertificateById(current.previousCertificateId)
      : null;
    const composed = await this.compose(
      current.id,
      subcontract,
      previous,
      {
        periodFrom: cmd.periodFrom ?? current.periodFrom,
        periodTo: cmd.periodTo ?? current.periodTo,
        executionDate: cmd.executionDate ?? current.executionDate,
        isFinal: cmd.isFinal ?? current.isFinal,
        workLines:
          cmd.workLines ??
          current.workLines.map((l) => ({
            subcontractLineId: l.boqLineId,
            thisPeriodQty: l.thisPeriodQty.toString(),
          })),
        penaltiesCumulative: cmd.penaltiesCumulative ?? current.penaltiesCumulative.toString(),
        suspendedCumulative: cmd.suspendedCumulative ?? current.suspendedCumulative.toString(),
        employerMaterialsCumulative:
          cmd.employerMaterialsCumulative ?? current.employerMaterialsCumulative.toString(),
        waterElectricityCumulative: cmd.waterElectricityCumulative ?? current.waterElectricityCumulative.toString(),
        notes: cmd.notes !== undefined ? cmd.notes : current.notes,
      },
      current.workLines,
    );
    const next: SubCertificate = {
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
      computed: composed.computed,
    };
    await this.deps.store.saveCertificate(next);
    return this.view(next);
  }

  /** حصر معتمد — the site engineer's measurement, on the date it was actually taken. */
  async measure(
    idOrDocNo: string,
    actor: SubCertificateActor,
    measuredAt?: string | null,
  ): Promise<SubCertificateView> {
    const current = await this.moveable(idOrDocNo, "draft", "measured");
    const on = measuredAt ?? this.today();
    this.assertSignatureDate("تاريخ الحصر", on, [
      ["تاريخ نهاية الفترة", current.periodTo],
    ]);
    await this.refuseAll(current);
    const next: SubCertificate = {
      ...current,
      status: "measured",
      measuredBy: actor.userId,
      measuredAt: on,
    };
    await this.deps.store.saveCertificate(next);
    await this.audit(next, "MEASURE", actor, { measuredAt: on, periodTo: next.periodTo });
    return this.view(next);
  }

  /** معتمد فنيًا — the technical office signs the quantities off. Nothing changes after this. */
  async certify(
    idOrDocNo: string,
    actor: SubCertificateActor,
    certifiedAt?: string | null,
  ): Promise<SubCertificateView> {
    const current = await this.moveable(idOrDocNo, "measured", "certified");
    const on = certifiedAt ?? this.today();
    this.assertSignatureDate("تاريخ الاعتماد الفني", on, [
      ["تاريخ نهاية الفترة", current.periodTo],
      ["تاريخ الحصر", current.measuredAt],
    ]);
    if (!(await this.waived(actor)) && current.preparedBy !== null && current.preparedBy === actor.userId) {
      throw new SubCertificateSegregationError(
        actor.userId,
        "لا يجوز اعتماد مستخلص الباطن من نفس الشخص الذي أعدّه. إذا كانت المنشأة شخصًا واحدًا، فعّل «وضع المشغّل الواحد» من الإعدادات العامة ← المقاولات.",
      );
    }
    await this.refuseAll(current);
    const next: SubCertificate = {
      ...current,
      status: "certified",
      certifiedBy: actor.userId,
      certifiedAt: on,
    };
    await this.deps.store.saveCertificate(next);
    await this.audit(next, "CERTIFY", actor, { certifiedAt: on, measuredBy: next.measuredBy });
    return this.view(next);
  }

  /**
   * معتمد للصرف. Generates and confirms the PURCHASE invoice and posts the
   * deductions entry inside ONE transaction: the certificate passes through
   * `approved_for_payment` and comes to rest at `invoiced`.
   */
  async approve(idOrDocNo: string, approvedAt: string, actor: SubCertificateActor): Promise<SubCertificateView> {
    const current = await this.moveable(idOrDocNo, "certified", "approved_for_payment");
    this.assertSignatureDate("تاريخ الاعتماد للصرف", approvedAt, [
      ["تاريخ نهاية الفترة", current.periodTo],
      ["تاريخ الحصر", current.measuredAt],
      ["تاريخ الاعتماد الفني", current.certifiedAt],
    ]);
    if (!(await this.waived(actor))) {
      if (current.preparedBy !== null && current.preparedBy === actor.userId) {
        throw new SubCertificateSegregationError(
          actor.userId,
          "لا يجوز اعتماد مستخلص الباطن للصرف من نفس الشخص الذي أعدّه. إذا كانت المنشأة شخصًا واحدًا، فعّل «وضع المشغّل الواحد» من الإعدادات العامة ← المقاولات.",
        );
      }
      if (current.certifiedBy !== null && current.certifiedBy === actor.userId) {
        throw new SubCertificateSegregationError(
          actor.userId,
          "لا يجوز اعتماد مستخلص الباطن للصرف من نفس الشخص الذي اعتمد الحصر فنيًا. إذا كانت المنشأة شخصًا واحدًا، فعّل «وضع المشغّل الواحد» من الإعدادات العامة ← المقاولات.",
        );
      }
    }
    const invoicing = this.deps.invoicing;
    if (!invoicing) {
      throw new InvalidSubCertificateError(["إصدار فاتورة مستخلص الباطن غير مُفعّل على هذا الخادم."]);
    }
    const subcontract = await this.requireSubcontract(current.subcontractId);
    await this.assertPayable(subcontract);
    await this.refuseAll(current);

    const computed = current.computed;
    const dueDate = addDays(approvedAt, subcontract.paymentTermDays);
    const wipAccountId = await this.routed("contracting.wip");
    /**
     * D-07: on the transitional basis the 5.04% is NOT recoverable input tax.
     * It is raised at rate zero on a cost that already carries it, so the tax
     * lands in أعمال تحت التنفيذ with the work instead of in 1400 as a claim
     * against the authority that would never be allowed.
     */
    const transitional = subcontract.vatBasis === "transitional";
    const invoiceAmount = transitional ? computed.invoiceBase.add(computed.vat) : computed.invoiceBase;
    const invoiceTaxRatePercent = transitional ? "0" : computed.vatEffectiveRatePercent;

    const saved = await this.deps.store.transaction(async () => {
      const cleared: SubCertificate = {
        ...current,
        status: "approved_for_payment",
        approvedBy: actor.userId,
        approvedAt,
        dueDate,
      };
      await this.deps.store.saveCertificate(cleared);

      const invoice = await invoicing.issue({
        certificateId: cleared.id,
        certificateDocNo: cleared.docNo,
        serial: cleared.serial,
        subcontractDocNo: subcontract.docNo,
        supplierId: subcontract.supplierId,
        projectId: cleared.projectId,
        date: approvedAt,
        dueDate,
        amount: invoiceAmount,
        taxRatePercent: invoiceTaxRatePercent,
        expenseAccountId: wipAccountId,
        lineDescriptionAr: `مستخلص مقاول باطن رقم ${cleared.serial} — ${subcontract.docNo}`,
        actor: actor.userId,
        memoAr:
          subcontract.vatBasis === "transitional"
            ? `فاتورة مستخلص مقاول باطن رقم ${cleared.serial} — أساس ضريبي انتقالي: ١٤٪ على ٣٦٪ من القيمة (قرار ٤١٨ لسنة ٢٠٢٥)، والضريبة غير قابلة للخصم فتُحمَّل على تكلفة الأعمال.`
            : `فاتورة مستخلص مقاول باطن رقم ${cleared.serial} — ${subcontract.docNo}.`,
      });

      const deductionsTotal = computed.deductionsThisCertificate;
      let journalEntryId: string | null = null;
      if (deductionsTotal.scaled !== 0n) {
        journalEntryId = `${cleared.id}-DED`;
        await this.postDeductions(journalEntryId, cleared, subcontract, approvedAt, invoice.apAccountId);
        await invoicing.settle(invoice.invoiceId, deductionsTotal, cleared.docNo);
      }

      const invoiced: SubCertificate = {
        ...cleared,
        status: "invoiced",
        invoiceId: invoice.invoiceId,
        invoiceDocNo: invoice.invoiceDocNo,
        journalEntryId,
        postedDeductionsTotal: deductionsTotal,
      };
      await this.deps.store.saveCertificate(invoiced);
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

  /**
   * الإلغاء. The reason is mandatory and the canceller is stamped: a cancelled
   * document with no named actor and no stated reason is one an auditor cannot
   * follow. `measuredBy` is NEVER back-filled here — signing a measurement is
   * not what cancelling a certificate is.
   */
  async cancel(idOrDocNo: string, reasonAr: string, actor: SubCertificateActor): Promise<SubCertificateView> {
    const current = await this.require(idOrDocNo);
    if (current.status !== "draft" && current.status !== "measured") {
      throw new InvalidSubCertificateTransitionError(current.status, "cancelled");
    }
    if (reasonAr.trim() === "") throw new InvalidSubCertificateError(["سبب إلغاء المستخلص مطلوب"]);
    await this.assertNoLaterCertificate(current);
    const next: SubCertificate = {
      ...current,
      status: "cancelled",
      cancelledBy: actor.userId,
      cancelledAt: this.today(),
      cancelReasonAr: reasonAr.trim(),
    };
    await this.deps.store.saveCertificate(next);
    await this.audit(next, "CANCEL", actor, { reasonAr: next.cancelReasonAr, from: current.status });
    return this.view(next);
  }

  /** One forensic row per transition; never allowed to fail the transition itself. */
  private async audit(
    certificate: SubCertificate,
    action: string,
    actor: SubCertificateActor,
    details: Record<string, unknown>,
  ): Promise<void> {
    await recordTransition(this.deps.audit, {
      entityType: "SUB_CERTIFICATE",
      entityId: certificate.id,
      action,
      actor: actor.userId,
      severity: action === "APPROVE" ? "WARNING" : "INFO",
      details: { docNo: certificate.docNo, subcontractId: certificate.subcontractId, ...details },
    });
  }

  /** Is this actor exempt from فصل المهام? Only when the tenant runs in single-operator mode. */
  private async waived(actor: SubCertificateActor): Promise<boolean> {
    return this.deps.segregationWaived ? this.deps.segregationWaived(actor) : false;
  }

  /**
   * The signature chain: periodTo ≤ الحصر ≤ الاعتماد الفني ≤ الاعتماد للصرف ≤
   * اليوم. A signature dated before the work it signs for, or after today, is
   * the shape every backdated approval takes.
   */
  private assertSignatureDate(
    label: string,
    value: string,
    mustNotPrecede: readonly (readonly [string, string | null])[],
  ): void {
    const reasons: string[] = [];
    if (!ISO_DATE.test(value)) {
      throw new InvalidSubCertificateError([`${label} مطلوب بصيغة YYYY-MM-DD`]);
    }
    for (const [earlierLabel, earlier] of mustNotPrecede) {
      if (earlier !== null && value < earlier) {
        reasons.push(`${label} (${value}) يسبق ${earlierLabel} (${earlier}).`);
      }
    }
    const today = this.today();
    if (value > today) reasons.push(`${label} (${value}) في المستقبل.`);
    if (reasons.length > 0) throw new InvalidSubCertificateError(reasons);
  }

  private async moveable(
    idOrDocNo: string,
    from: SubCertificateStatus,
    to: SubCertificateStatus,
  ): Promise<SubCertificate> {
    const current = await this.require(idOrDocNo);
    if (current.status !== from) throw new InvalidSubCertificateTransitionError(current.status, to);
    await this.assertNoLaterCertificate(current);
    return current;
  }

  /** Re-reads the client's certified cumulative and the sub's own lines, and reports every refusal. */
  private async refuseQuantities(certificate: SubCertificate): Promise<string[]> {
    const subcontract = await this.requireSubcontract(certificate.subcontractId);
    const ceiling = await this.clientCeiling(subcontract.contractId);
    const byLineId = new Map(subcontract.lines.map((l) => [l.id, l]));
    const lines = certificate.workLines.map((line) => ({
      ...line,
      contractedQty: byLineId.get(line.boqLineId)?.qty ?? Qty.zero(),
      clientCertifiedCumulativeQty: ceiling.get(line.clientBoqLineId) ?? Qty.zero(),
    }));
    const peer = await this.peerCertifiedByClientLine(subcontract.contractId, subcontract.id);
    return this.quantityRefusals(lines, peer);
  }

  /**
   * THE deduction control (design §03, D-05). All four cumulative figures on a
   * sub certificate are TYPED, so none may be believed: unbounded they drive
   * the net payable negative, credit WIP with material never issued and strike
   * a penalty past the ceiling the package was let at — and the purchase
   * invoice's remaining balance goes negative behind them.
   */
  private async deductionRefusals(
    computed: CertificateComputation,
    subcontract: Subcontract,
  ): Promise<string[]> {
    const reasons: string[] = [];
    if (computed.netPayableThisCertificate.scaled < 0n) {
      reasons.push(
        `إجمالي خصومات هذا المستخلص يتجاوز قيمة أعماله: صافي المستحق ${computed.netPayableThisCertificate.toString()}.`,
      );
    }
    if (this.deps.consumptions) {
      const issued = await this.materialsPrefill(subcontract.id);
      const claimed =
        computed.deductions.find((d) => d.key === "employerMaterials")?.cumulative ?? Money.zero();
      if (claimed.scaled > issued.scaled) {
        reasons.push(
          `${EMPLOYER_MATERIALS_LABEL_AR} ${claimed.toString()} يتجاوز قيمة ما صُرف فعلًا لهذا المقاول من مستودع الموقع ${issued.toString()}.`,
        );
      }
    }
    const penalties = computed.deductions.find((d) => d.key === "penalties")?.cumulative ?? Money.zero();
    const ceiling = percentOf(computed.netCertified, subcontract.penaltyCapPercent);
    if (penalties.scaled > ceiling.scaled) {
      reasons.push(
        `غرامة التأخير ${penalties.toString()} تتجاوز سقف ${subcontract.penaltyCapPercent}٪ من القيمة المعتمدة (${ceiling.toString()}).`,
      );
    }
    return reasons;
  }

  /** Both gates, run together so the screen shows every refusal at once. */
  private async refuseAll(certificate: SubCertificate): Promise<void> {
    const subcontract = await this.requireSubcontract(certificate.subcontractId);
    const quantities = await this.refuseQuantities(certificate);
    if (quantities.length > 0) throw new SubCertificateQuantityError(quantities);
    const deductions = await this.deductionRefusals(certificate.computed, subcontract);
    if (deductions.length > 0) throw new SubCertificateDeductionError(deductions);
  }

  private async assertPayable(subcontract: Subcontract): Promise<void> {
    if (!this.deps.suppliers) return;
    const supplier = await this.deps.suppliers.find(subcontract.supplierId);
    const reasons = payabilityRefusals(subcontract.supplierId, supplier).map(
      (r) => `لا يمكن اعتماد مستخلص الباطن للصرف: ${r}`,
    );
    if (reasons.length > 0) throw new InvalidSubCertificateError(reasons);
  }

  /**
   * The deductions entry — the client certificate's entry with the sign
   * reversed. Every line carries `projectId`; only the cost-side lines carry a
   * cost category, because a category on a payable is a figure nothing can
   * roll up. The DEBIT side is the invoice's OWN payable account, so the AP
   * control moves by exactly what the sub-ledger records.
   *
   * INVARIANT: التأمينات withheld from the sub is money held for NOSI under
   * the SUB's own file — a LIABILITY (2197), never a credit back to the
   * contractor's insurance expense, which would understate cost and leave the
   * amount owed to the authority unrecorded. A penalty recovers 5910 and
   * materials the contractor issued to the sub return to WIP (1230) rather
   * than being expensed twice.
   */
  private async postDeductions(
    entryId: string,
    certificate: SubCertificate,
    subcontract: Subcontract,
    date: string,
    apAccountId: string,
  ): Promise<void> {
    const [retentionAccount, advanceAccount, whtAccount, socialAccount, sundryAccount, wipAccount] =
      await Promise.all([
        this.routed("contracting.retention_payable"),
        this.routed("contracting.subcontractor_advances"),
        this.routed("contracting.wht_payable"),
        this.routed("contracting.social_insurance_withheld"),
        this.routed("contracting.late_penalty"),
        this.routed("contracting.wip"),
      ]);
    const byKey = new Map(certificate.computed.deductions.map((d) => [d.key, d.thisCertificate]));
    const spec: readonly {
      key: string;
      accountId: string;
      amount: Money;
      memo: string;
      cost: boolean;
    }[] = [
      { key: "retention", accountId: retentionAccount, amount: byKey.get("retention") ?? Money.zero(), memo: "محتجزات مقاول الباطن", cost: false },
      { key: "advanceRecovery", accountId: advanceAccount, amount: byKey.get("advanceRecovery") ?? Money.zero(), memo: "خصم الدفعة المقدمة", cost: false },
      { key: "withholdingTax", accountId: whtAccount, amount: byKey.get("withholdingTax") ?? Money.zero(), memo: "ضريبة الخصم والتحصيل المستحقة التوريد", cost: false },
      { key: "socialInsurance", accountId: socialAccount, amount: byKey.get("socialInsurance") ?? Money.zero(), memo: "التأمينات الاجتماعية المستقطعة من الباطن", cost: false },
      { key: "penalties", accountId: sundryAccount, amount: byKey.get("penalties") ?? Money.zero(), memo: "غرامة تأخير على مقاول الباطن", cost: true },
      { key: "employerMaterials", accountId: wipAccount, amount: byKey.get("employerMaterials") ?? Money.zero(), memo: EMPLOYER_MATERIALS_LABEL_AR, cost: true },
      { key: "waterElectricity", accountId: sundryAccount, amount: byKey.get("waterElectricity") ?? Money.zero(), memo: "استهلاك المياه والكهرباء", cost: true },
    ];

    const lines: JournalLineInput[] = [];
    for (const entry of spec) {
      if (entry.amount.scaled === 0n) continue;
      lines.push({
        accountId: entry.accountId,
        debit: Money.zero(),
        credit: entry.amount,
        memo: entry.memo,
        projectId: certificate.projectId,
        ...(entry.cost ? { costCategory: "subcontract" as const } : {}),
      });
    }
    if (lines.length === 0) return;
    lines.unshift({
      accountId: apAccountId,
      debit: Money.sum(lines.map((l) => l.credit)),
      credit: Money.zero(),
      memo: `خصومات مستخلص مقاول باطن رقم ${certificate.serial}`,
      projectId: certificate.projectId,
    });

    await postJournalEntry(
      {
        id: entryId,
        date,
        memo: `خصومات مستخلص الباطن ${certificate.docNo} — ${subcontract.docNo}`,
        source: "system",
        sourceDocType: SUB_CERTIFICATE_DOC_TYPE,
        sourceDocId: certificate.id,
        sourceDocNumber: certificate.docNo,
        lines,
      },
      this.deps.gl,
    );
  }
}
