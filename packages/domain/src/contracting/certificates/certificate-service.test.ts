import { beforeEach, describe, expect, it } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { Account } from "../../accounts/account.js";
import { InMemoryAccountRepository } from "../../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService, type SequenceStore } from "../../numbering/index.js";
import { InMemoryLedgerRepository } from "../../gl/test-helpers/in-memory-ledger-repository.js";
import type { PostedLine, PostedLineFilter } from "../../gl/ledger.js";
import type {
  BoqLine,
  BoqLineAdjustment,
  VariationOrder,
  VariationOrderListFilter,
  WorksContract,
  WorksContractListFilter,
  WorksContractStore,
} from "../contracts/contract.js";
import { defaultWorksContractTerms } from "../contracts/contract-service.js";
import type {
  ProgressCertificate,
  ProgressCertificateListFilter,
  ProgressCertificateStore,
} from "./certificate.js";
import {
  CertificateService,
  type CertificateInvoiceCommand,
  type CertificateInvoicingPort,
} from "./certificate-service.js";
import { CertificateQuantityError, CertificateSegregationError, LaterCertificateExistsError } from "./errors.js";

const CONTRACT_ID = "CTR-1";
const PROJECT_ID = "PRJ-1";

class MemoryContractStore implements WorksContractStore {
  contracts = new Map<string, WorksContract>();
  boq: BoqLine[] = [];
  adjustments: BoqLineAdjustment[] = [];
  orders = new Map<string, VariationOrder>();

  async findContractById(id: string) {
    return this.contracts.get(id) ?? null;
  }
  async findContractByDocNo(docNo: string) {
    return [...this.contracts.values()].find((c) => c.docNo === docNo) ?? null;
  }
  async listContracts(filter?: WorksContractListFilter) {
    return [...this.contracts.values()].filter((c) => !filter?.status || c.status === filter.status);
  }
  async saveContract(contract: WorksContract) {
    this.contracts.set(contract.id, contract);
  }
  async listBoqLines(contractId: string) {
    return this.boq.filter((l) => l.contractId === contractId);
  }
  async replaceBoqLines(contractId: string, lines: readonly BoqLine[]) {
    this.boq = this.boq.filter((l) => l.contractId !== contractId).concat(lines);
  }
  async addBoqLines(lines: readonly BoqLine[]) {
    this.boq = this.boq.concat(lines);
  }
  async listAdjustments(contractId: string) {
    return this.adjustments.filter((a) => a.contractId === contractId);
  }
  async addAdjustments(adjustments: readonly BoqLineAdjustment[]) {
    this.adjustments = this.adjustments.concat(adjustments);
  }
  async listVariationOrders(filter?: VariationOrderListFilter) {
    return [...this.orders.values()].filter((o) => !filter?.contractId || o.contractId === filter.contractId);
  }
  async findVariationOrderById(id: string) {
    return this.orders.get(id) ?? null;
  }
  async findVariationOrderByDocNo(docNo: string) {
    return [...this.orders.values()].find((o) => o.docNo === docNo) ?? null;
  }
  async saveVariationOrder(order: VariationOrder) {
    this.orders.set(order.id, order);
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

class MemoryCertificateStore implements ProgressCertificateStore {
  rows = new Map<string, ProgressCertificate>();

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByDocNo(docNo: string) {
    return [...this.rows.values()].find((r) => r.docNo === docNo) ?? null;
  }
  async list(filter?: ProgressCertificateListFilter) {
    return [...this.rows.values()].filter((r) => !filter?.contractId || r.contractId === filter.contractId);
  }
  async listByContract(contractId: string) {
    return [...this.rows.values()].filter((r) => r.contractId === contractId).sort((a, b) => a.serial - b.serial);
  }
  async save(certificate: ProgressCertificate) {
    this.rows.set(certificate.id, certificate);
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

/** The in-memory ledger has no dimensional read, and the advance cap depends on one. */
class DimensionalLedger extends InMemoryLedgerRepository {
  async listLines(filter: PostedLineFilter = {}): Promise<readonly PostedLine[]> {
    const out: PostedLine[] = [];
    for (const entry of await this.list({ status: "posted" })) {
      for (const line of entry.lines) {
        if (filter.accountIds && !filter.accountIds.includes(line.accountId)) continue;
        if (filter.projectId && line.projectId !== filter.projectId) continue;
        out.push({
          entryId: entry.id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          source: entry.source ?? "manual",
          accountId: line.accountId,
          costCenterId: line.costCenterId ?? null,
          projectId: line.projectId ?? null,
          costCategory: line.costCategory ?? null,
          currency: line.currency ?? null,
          fxRate: line.fxRate ?? null,
          memo: line.memo ?? null,
          debit: line.debit,
          credit: line.credit,
        });
      }
    }
    return out;
  }
}

function account(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"] = "debit"): Account {
  return { id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

function boqLine(id: string, code: string, qty: string, rate: string, sortOrder: number): BoqLine {
  return {
    id,
    contractId: CONTRACT_ID,
    code,
    descriptionAr: `بند ${code}`,
    descriptionEn: null,
    unit: "m3",
    qty: Qty.fromMajor(qty),
    unitRate: Money.fromMajor(rate),
    estimatedUnitCost: Money.fromMajor("100"),
    section: null,
    sortOrder,
    origin: "base",
    variationOrderId: null,
    costCategory: "materials",
    theoreticalQtyPerUnit: null,
    theoreticalItemId: null,
  };
}

interface Harness {
  service: CertificateService;
  contracts: MemoryContractStore;
  certificates: MemoryCertificateStore;
  ledger: DimensionalLedger;
  issued: CertificateInvoiceCommand[];
  settled: { invoiceId: string; amount: Money }[];
}

const ADMIN = { userId: "admin", wildcardAdmin: true };
const SURVEYOR = { userId: "surveyor", wildcardAdmin: false };
const CONSULTANT = { userId: "consultant", wildcardAdmin: false };
const FINANCE = { userId: "finance", wildcardAdmin: false };

async function harness(overrides: Partial<WorksContract> = {}): Promise<Harness> {
  const ledger = new DimensionalLedger();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  for (const [id, type, natural] of [
    ["1105", "asset", "debit"],
    ["1150", "asset", "debit"],
    ["1175", "asset", "debit"],
    ["2160", "liability", "credit"],
    ["2165", "liability", "credit"],
    ["5155", "expense", "debit"],
    ["5910", "expense", "debit"],
    ["5157", "expense", "debit"],
    ["5158", "expense", "debit"],
  ] as const) {
    await accounts.create(account(id, type, natural));
  }
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, "0");
    const last = new Date(Date.UTC(2026, month, 0)).toISOString().slice(8, 10);
    await periods.create({
      id: `fp-2026-${mm}`,
      year: 2026,
      periodNumber: month,
      startDate: `2026-${mm}-01`,
      endDate: `2026-${mm}-${last}`,
      status: "open",
    });
  }

  const counters = new Map<string, number>();
  const sequences: SequenceStore = {
    async increment(code: string) {
      const next = (counters.get(code) ?? 0) + 1;
      counters.set(code, next);
      return next;
    },
  };
  const numbering = new NextNumberService(sequences);

  const contracts = new MemoryContractStore();
  contracts.contracts.set(CONTRACT_ID, {
    ...defaultWorksContractTerms("private", "2026-01-01"),
    id: CONTRACT_ID,
    docNo: "CTR-0001",
    projectId: PROJECT_ID,
    customerId: "CUST-1",
    titleAr: "عقد اختبار",
    titleEn: null,
    contractType: "private",
    signedDate: "2026-01-01",
    startDate: "2026-01-01",
    plannedEndDate: "2026-12-31",
    currency: "EGP",
    status: "active",
    activatedAt: "2026-01-01",
    completedAt: null,
    terminatedAt: null,
    notes: null,
    estimatedTotalCost: Money.fromMajor("900000"),
    budgetRevisions: [],
    provisionalHandoverDate: null,
    finalHandoverDate: null,
    tenderDiscountPercent: "4.5",
    ...overrides,
  });
  contracts.boq = [boqLine("B1", "1", "12000", "185", 1)];

  const certificates = new MemoryCertificateStore();
  const issued: CertificateInvoiceCommand[] = [];
  const settled: { invoiceId: string; amount: Money }[] = [];
  const invoicing: CertificateInvoicingPort = {
    async issue(cmd) {
      issued.push(cmd);
      return {
        invoiceId: `${cmd.certificateId}-INV`,
        invoiceDocNo: `INV-${cmd.serial}`,
        arAccountId: "1105",
        total: Money.fromScaled(cmd.amount.scaled),
      };
    },
    async status(invoiceId) {
      const total = issued.find((i) => `${i.certificateId}-INV` === invoiceId)?.amount ?? Money.zero();
      const paid = Money.sum(settled.filter((s) => s.invoiceId === invoiceId).map((s) => s.amount));
      return {
        invoiceId,
        docNo: invoiceId,
        total,
        amountPaid: paid,
        remainingBalance: Money.fromScaled(total.scaled - paid.scaled),
        dueDate: null,
        status: "confirmed",
      };
    },
    async settle(invoiceId, amount) {
      settled.push({ invoiceId, amount });
    },
  };

  const service = new CertificateService({
    store: certificates,
    contracts,
    numbering,
    gl: { ledger, accounts, periods, numbering },
    invoicing,
    accounts,
    today: () => "2026-09-13",
  });
  return { service, contracts, certificates, ledger, issued, settled };
}

/** The customer's advance, as the ledger records it: a credit to 2160 with the project dimension. */
async function postAdvance(h: Harness, amount: string): Promise<void> {
  await h.ledger.save({
    id: "JE-ADV",
    entryNo: "JE-0001",
    date: "2026-01-15",
    memo: "دفعة مقدمة",
    status: "posted",
    source: "system",
    sourceDocType: "VOUCHER",
    sourceDocId: "VCH-1",
    sourceDocNumber: "VCH-0001",
    createdAt: "2026-01-15T00:00:00.000Z",
    postedAt: "2026-01-15T00:00:00.000Z",
    reversedByEntryId: null,
    lines: [
      { accountId: "1105", debit: Money.fromMajor(amount), credit: Money.zero(), memo: null, costCenterId: null, currency: null, fxRate: null, taxRatePercent: null, projectId: PROJECT_ID, costCategory: null },
      { accountId: "2160", debit: Money.zero(), credit: Money.fromMajor(amount), memo: null, costCenterId: null, currency: null, fxRate: null, taxRatePercent: null, projectId: PROJECT_ID, costCategory: null },
    ],
  });
}

async function draft(
  h: Harness,
  id: string,
  qty: string,
  period: { from: string; to: string },
  actor = SURVEYOR,
): Promise<void> {
  await h.service.create(
    {
      id,
      contractId: CONTRACT_ID,
      periodFrom: period.from,
      periodTo: period.to,
      workLines: [{ boqLineId: "B1", thisPeriodQty: qty }],
    },
    actor,
  );
}

async function fullyApprove(h: Harness, id: string, approvedAt: string): Promise<void> {
  await h.service.measure(id, SURVEYOR);
  await h.service.certify(id, CONSULTANT);
  await h.service.approve(id, approvedAt, FINANCE);
}

describe("CertificateService", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("assigns a strictly increasing serial and hard-links the previous certificate", async () => {
    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await draft(h, "C2", "500", { from: "2026-02-01", to: "2026-02-28" });
    const first = await h.certificates.findById("C1");
    const second = await h.certificates.findById("C2");
    expect(first?.serial).toBe(1);
    expect(first?.previousCertificateId).toBeNull();
    expect(second?.serial).toBe(2);
    expect(second?.previousCertificateId).toBe("C1");
    // The period figure is a subtraction, never an input.
    expect(second?.workLines[0]?.previousCumulativeQty.toString()).toBe("1000.000000");
    expect(second?.workLines[0]?.cumulativeQty.toString()).toBe("1500.000000");
  });

  it("refuses a cumulative quantity beyond what the contract carries", async () => {
    await draft(h, "C1", "13000", { from: "2026-01-01", to: "2026-01-31" });
    await expect(h.service.measure("C1", SURVEYOR)).rejects.toBeInstanceOf(CertificateQuantityError);
    await expect(h.service.measure("C1", SURVEYOR)).rejects.toThrow(/تتجاوز الكمية التعاقدية/);
  });

  it("refuses a line whose quantity depends on a variation order approved after the execution date", async () => {
    h.contracts.boq.push({
      ...boqLine("B2", "2", "500", "300", 2),
      origin: "variation",
      variationOrderId: "VO-1",
    });
    h.contracts.orders.set("VO-1", {
      id: "VO-1",
      docNo: "VO-0001",
      contractId: CONTRACT_ID,
      date: "2026-02-01",
      titleAr: "أمر تغيير",
      reason: "سبب",
      requestedBy: "employer",
      status: "approved",
      approvedAt: "2026-03-10",
      approvedBy: "admin",
      rejectedReason: null,
      createdBy: "admin",
      lines: [],
    });
    await h.service.create(
      {
        id: "C1",
        contractId: CONTRACT_ID,
        periodFrom: "2026-01-01",
        periodTo: "2026-01-31",
        workLines: [{ boqLineId: "B2", thisPeriodQty: "10" }],
      },
      SURVEYOR,
    );
    await expect(h.service.measure("C1", SURVEYOR)).rejects.toThrow(/اعتُمد بعد هذا التاريخ/);
  });

  it("holds preparer ≠ certifier ≠ approver by userId, and lets the wildcard admin through", async () => {
    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await h.service.measure("C1", SURVEYOR);
    await expect(h.service.certify("C1", SURVEYOR)).rejects.toBeInstanceOf(CertificateSegregationError);
    await h.service.certify("C1", CONSULTANT);
    await expect(h.service.approve("C1", "2026-02-05", CONSULTANT)).rejects.toBeInstanceOf(CertificateSegregationError);

    // A single-operator install has nobody else to sign, so the tenant admin
    // whose grant is "*" is exempt — deliberately, and stated here.
    const solo = await harness();
    await draft(solo, "S1", "1000", { from: "2026-01-01", to: "2026-01-31" }, ADMIN);
    await solo.service.measure("S1", ADMIN);
    await solo.service.certify("S1", ADMIN);
    await solo.service.approve("S1", "2026-02-05", ADMIN);
    expect((await solo.certificates.findById("S1"))?.status).toBe("invoiced");
  });

  it("refuses every transition while a later certificate exists", async () => {
    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await draft(h, "C2", "500", { from: "2026-02-01", to: "2026-02-28" });
    await expect(h.service.measure("C1", SURVEYOR)).rejects.toBeInstanceOf(LaterCertificateExistsError);
    await expect(h.service.cancel("C1", SURVEYOR)).rejects.toBeInstanceOf(LaterCertificateExistsError);
  });

  it("posts a balanced deductions entry carrying the project on every line", async () => {
    await postAdvance(h, "60000");
    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await fullyApprove(h, "C1", "2026-02-05");

    const entry = await h.ledger.findById("C1-DED");
    expect(entry).not.toBeNull();
    const debit = Money.sum(entry!.lines.map((l) => l.debit));
    const credit = Money.sum(entry!.lines.map((l) => l.credit));
    expect(debit.toString()).toBe(credit.toString());
    expect(entry!.lines.every((l) => l.projectId === PROJECT_ID)).toBe(true);
    // A cost category belongs only on a cost line — never on the receivable,
    // the retention or the advance.
    for (const line of entry!.lines) {
      if (["1105", "1150", "2160", "1175"].includes(line.accountId)) expect(line.costCategory).toBeNull();
      if (line.accountId === "5155") expect(line.costCategory).toBe("indirect");
    }
  });

  it("posts employer-supplied materials and stamp duty to their own accounts, not to 5910 late-penalty", async () => {
    const withStampDuty = await harness({ stampDutyPercent: "1" });
    await postAdvance(withStampDuty, "60000");
    await withStampDuty.service.create(
      {
        id: "C1",
        contractId: CONTRACT_ID,
        periodFrom: "2026-01-01",
        periodTo: "2026-01-31",
        workLines: [{ boqLineId: "B1", thisPeriodQty: "1000" }],
        employerMaterialsCumulative: "5000",
      },
      SURVEYOR,
    );
    await fullyApprove(withStampDuty, "C1", "2026-02-05");

    const entry = await withStampDuty.ledger.findById("C1-DED");
    expect(entry).not.toBeNull();
    const employerMaterialsLine = entry!.lines.find((l) => l.accountId === "5157");
    const stampDutyLine = entry!.lines.find((l) => l.accountId === "5158");
    expect(employerMaterialsLine?.debit.toString()).toBe("5000.000000");
    expect(employerMaterialsLine?.costCategory).toBe("indirect");
    expect(stampDutyLine?.debit.scaled).toBeGreaterThan(0n);
    expect(stampDutyLine?.costCategory).toBe("indirect");
    // Neither deduction lands on the late-penalty account they used to share.
    expect(entry!.lines.some((l) => l.accountId === "5910")).toBe(false);
  });

  it("leaves the generated invoice owing exactly the net payable", async () => {
    await postAdvance(h, "60000");
    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await fullyApprove(h, "C1", "2026-02-05");

    const view = await h.service.get("C1");
    const computed = view.certificate.computed;
    const invoiceTotal = computed.invoiceBase.add(computed.vat);
    const owing = Money.fromScaled(invoiceTotal.scaled - computed.deductionsThisCertificate.scaled);
    expect(owing.toString()).toBe(computed.netPayableThisCertificate.toString());
    expect(h.settled[0]?.amount.toString()).toBe(computed.deductionsThisCertificate.toString());
    expect(view.certificate.postedDeductionsTotal.toString()).toBe(computed.deductionsThisCertificate.toString());
  });

  it("reads the advance ceiling off the posted ledger, not off progress", async () => {
    await postAdvance(h, "60000");
    await draft(h, "C1", "8000", { from: "2026-01-01", to: "2026-01-31" });
    const stored = await h.certificates.findById("C1");
    const recovery = stored!.computed.deductions.find((d) => d.key === "advanceRecovery")!;
    expect(stored!.computed.advanceReceived.toString()).toBe("60000.000000");
    expect(recovery.capped).toBe(true);
    expect(recovery.cumulative.toString()).toBe("60000.000000");
  });

  it("closes the contract's quantities on a final certificate and guards completion", async () => {
    expect(await h.service.completionRefusal(CONTRACT_ID)).toBeNull();

    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    expect(await h.service.completionRefusal(CONTRACT_ID)).toMatch(/قيد الاعتماد/);
    await fullyApprove(h, "C1", "2026-02-05");
    expect(await h.service.completionRefusal(CONTRACT_ID)).toMatch(/المستخلص الختامي/);

    await h.service.create(
      {
        id: "C2",
        contractId: CONTRACT_ID,
        periodFrom: "2026-02-01",
        periodTo: "2026-02-28",
        isFinal: true,
        workLines: [{ boqLineId: "B1", thisPeriodQty: "500" }],
      },
      SURVEYOR,
    );
    await fullyApprove(h, "C2", "2026-03-05");
    expect(await h.service.completionRefusal(CONTRACT_ID)).toBeNull();

    await expect(
      h.service.create(
        {
          id: "C3",
          contractId: CONTRACT_ID,
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          workLines: [{ boqLineId: "B1", thisPeriodQty: "10" }],
        },
        SURVEYOR,
      ),
    ).rejects.toThrow(/المستخلص الختامي/);
  });

  it("raises the invoice at the transitional effective rate and says so in the memo", async () => {
    const transitional = await harness({ vatBasis: "transitional" });
    await draft(transitional, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await fullyApprove(transitional, "C1", "2026-02-05");
    const cmd = transitional.issued[0]!;
    expect(cmd.taxRatePercent).toBe("5.040000");
    expect(cmd.memoAr).toMatch(/انتقالي/);
    // cost_to_cost bills, it does not recognise: the credit is 2165, not revenue.
    expect(cmd.revenueAccountId).toBe("2165");
  });

  it("bills a certified_value contract to revenue instead of to billings (D-03's switch)", async () => {
    const certified = await harness({ recognitionPolicy: "certified_value" });
    await draft(certified, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    await fullyApprove(certified, "C1", "2026-02-05");
    expect(certified.issued[0]?.revenueAccountId).toBe("4150");
  });

  it("reports the مستخلص تنفيذي at the latest certificate's cumulative quantities", async () => {
    await draft(h, "C1", "1000", { from: "2026-01-01", to: "2026-01-31" });
    const report = await h.service.internalCertificate(CONTRACT_ID);
    expect(report.asOfSerial).toBe(1);
    expect(report.rows[0]?.estimatedCost.toString()).toBe("100000.000000");
    expect(report.rows[0]?.sellingValue.toString()).toBe("185000.000000");
    expect(report.totals.margin.toString()).toBe("85000.000000");
    expect(report.actualCostNoteAr).toMatch(/على مستوى المشروع/);
  });
});
