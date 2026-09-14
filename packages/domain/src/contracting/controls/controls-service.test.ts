import { describe, it, expect } from "vitest";
import { Money, Qty } from "../../money/index.js";
import { NextNumberService, type SequenceStore } from "../../numbering/index.js";
import type { PostedLine, PostedLineFilter } from "../../gl/ledger.js";
import type { JournalPostingDeps } from "../../gl/index.js";
import { defaultWorksContractTerms } from "../contracts/contract-service.js";
import type {
  BoqLine,
  BoqLineAdjustment,
  VariationOrder,
  VariationOrderListFilter,
  WorksContract,
  WorksContractListFilter,
  WorksContractStore,
} from "../contracts/contract.js";
import type { ProgressCertificate } from "../certificates/certificate.js";
import { ControlsService, type ControlsServiceDeps, type RetentionReleaseInvoicingPort } from "./controls-service.js";
import { RetentionReleaseExceedsBalanceError } from "./errors.js";
import type { RetentionRelease, RetentionReleaseListFilter, RetentionReleaseStore } from "./retention-release.js";

const CONTRACT_ID = "CTR-1";
const PROJECT_ID = "PRJ-1";
const AR = "1105";
const RETENTION = "1150";

const m = (v: string) => Money.fromMajor(v);
const q = (v: string) => Qty.fromMajor(v);

/** A ledger that only has to answer `listLines` — the release posts through the invoice, not through this. */
class FakeLedger {
  readonly lines: PostedLine[] = [];

  post(accountId: string, debit: Money, credit: Money, projectId: string, date: string, entryId: string): void {
    this.lines.push({
      entryId,
      entryNo: entryId,
      date,
      source: "system",
      accountId,
      branchId: null,
      costCenterId: null,
      projectId,
      costCategory: null,
      currency: null,
      fxRate: null,
      memo: null,
      debit,
      credit,
    });
  }

  async listLines(filter?: PostedLineFilter): Promise<readonly PostedLine[]> {
    return this.lines.filter(
      (l) =>
        (!filter?.accountIds || filter.accountIds.includes(l.accountId)) &&
        (!filter?.projectId || l.projectId === filter.projectId),
    );
  }

  balance(accountId: string): Money {
    let net = 0n;
    for (const line of this.lines) {
      if (line.accountId !== accountId) continue;
      net += line.debit.scaled - line.credit.scaled;
    }
    return Money.fromScaled(net);
  }
}

class MemoryContractStore implements WorksContractStore {
  readonly contracts = new Map<string, WorksContract>();
  readonly boq: BoqLine[] = [];
  readonly adjustments: BoqLineAdjustment[] = [];
  readonly orders: VariationOrder[] = [];

  async findContractById(id: string) {
    return this.contracts.get(id) ?? null;
  }
  async findContractByDocNo(docNo: string) {
    return [...this.contracts.values()].find((c) => c.docNo === docNo) ?? null;
  }
  async listContracts(filter?: WorksContractListFilter) {
    return [...this.contracts.values()].filter((c) => !filter?.projectId || c.projectId === filter.projectId);
  }
  async saveContract(contract: WorksContract) {
    this.contracts.set(contract.id, contract);
  }
  async listBoqLines(contractId: string) {
    return this.boq.filter((l) => l.contractId === contractId);
  }
  async replaceBoqLines(contractId: string, lines: readonly BoqLine[]) {
    this.boq.splice(0, this.boq.length, ...this.boq.filter((l) => l.contractId !== contractId), ...lines);
  }
  async addBoqLines(lines: readonly BoqLine[]) {
    for (const line of lines) {
      const index = this.boq.findIndex((l) => l.id === line.id);
      if (index === -1) this.boq.push(line);
      else this.boq[index] = line;
    }
  }
  async listAdjustments(contractId: string) {
    return this.adjustments.filter((a) => a.contractId === contractId);
  }
  async addAdjustments(rows: readonly BoqLineAdjustment[]) {
    this.adjustments.push(...rows);
  }
  async listVariationOrders(filter?: VariationOrderListFilter) {
    return this.orders.filter((o) => !filter?.contractId || o.contractId === filter.contractId);
  }
  async findVariationOrderById(id: string) {
    return this.orders.find((o) => o.id === id) ?? null;
  }
  async findVariationOrderByDocNo(docNo: string) {
    return this.orders.find((o) => o.docNo === docNo) ?? null;
  }
  async saveVariationOrder(order: VariationOrder) {
    this.orders.push(order);
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

class MemoryReleaseStore implements RetentionReleaseStore {
  readonly rows = new Map<string, RetentionRelease>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByDocNo(docNo: string) {
    return [...this.rows.values()].find((r) => r.docNo === docNo) ?? null;
  }
  async list(filter?: RetentionReleaseListFilter) {
    return [...this.rows.values()].filter(
      (r) =>
        (!filter?.contractId || r.contractId === filter.contractId) &&
        (!filter?.projectId || r.projectId === filter.projectId) &&
        (!filter?.status || r.status === filter.status),
    );
  }
  async save(release: RetentionRelease) {
    this.rows.set(release.id, release);
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

function boqLine(over: Partial<BoqLine> = {}): BoqLine {
  return {
    id: "B1",
    contractId: CONTRACT_ID,
    code: "1",
    descriptionAr: "الخرسانة العادية",
    descriptionEn: null,
    unit: "m3",
    qty: q("1450"),
    unitRate: m("1980"),
    estimatedUnitCost: null,
    section: null,
    sortOrder: 1,
    origin: "base",
    variationOrderId: null,
    costCategory: "materials",
    theoreticalQtyPerUnit: null,
    theoreticalItemId: null,
    ...over,
  };
}

function certificate(over: Partial<ProgressCertificate> = {}): ProgressCertificate {
  const computed = {
    grossWorks: Money.zero(),
    materialsOnSite: Money.zero(),
    certificateTotal: Money.zero(),
    tenderDiscountPercent: "0",
    tenderDiscount: Money.zero(),
    netCertified: Money.zero(),
    previousNetCertified: Money.zero(),
    thisCertificateNetCertified: Money.zero(),
    deductions: [],
    deductionsThisCertificate: Money.zero(),
    deductionsCumulative: Money.zero(),
    suspendedBalance: Money.zero(),
    invoiceBase: Money.zero(),
    vatBasis: "standard" as const,
    vatStatutoryRatePercent: "14",
    vatEffectiveRatePercent: "14",
    vat: Money.zero(),
    previousPayments: Money.zero(),
    netPayableThisCertificate: Money.zero(),
    cumulativeNetPayable: Money.zero(),
    contractValueAfterVariations: Money.zero(),
    completionPercent: "0.0",
    retentionHeldCumulative: Money.zero(),
    advanceReceived: Money.zero(),
    advanceOutstanding: Money.zero(),
  };
  return {
    id: "MST-1",
    docNo: "MST-000001",
    contractId: CONTRACT_ID,
    projectId: PROJECT_ID,
    serial: 1,
    previousCertificateId: null,
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    executionDate: "2026-08-31",
    isFinal: false,
    status: "invoiced",
    preparedBy: null,
    preparedAt: null,
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
    penaltiesCumulative: Money.zero(),
    suspendedCumulative: Money.zero(),
    employerMaterialsCumulative: Money.zero(),
    waterElectricityCumulative: Money.zero(),
    notes: null,
    workLines: [],
    materialLines: [],
    computed,
    ...over,
  };
}

interface Harness {
  service: ControlsService;
  deps: ControlsServiceDeps;
  contracts: MemoryContractStore;
  releases: MemoryReleaseStore;
  ledger: FakeLedger;
  certificates: ProgressCertificate[];
  /** The AR sub-ledger the generated invoices land in, as {invoiceId → outstanding}. */
  subLedger: Map<string, Money>;
}

function harness(options: {
  heldRetention?: string;
  contract?: Partial<WorksContract>;
  performanceGuarantees?: readonly { id: string; docNo: string | null; currentValue: string; expiryDate: string }[];
} = {}): Harness {
  const ledger = new FakeLedger();
  const contracts = new MemoryContractStore();
  const releases = new MemoryReleaseStore();
  const certificates: ProgressCertificate[] = [];
  const subLedger = new Map<string, Money>();

  contracts.contracts.set(CONTRACT_ID, {
    ...defaultWorksContractTerms("private", "2026-02-15"),
    id: CONTRACT_ID,
    docNo: "CTR-0001",
    projectId: PROJECT_ID,
    customerId: "CUST-1",
    titleAr: "عقد إنشاء برج الأمل",
    titleEn: null,
    contractType: "private",
    signedDate: "2026-02-15",
    startDate: "2026-03-01",
    plannedEndDate: "2027-02-28",
    currency: "EGP",
    status: "active",
    activatedAt: "2026-03-01",
    completedAt: null,
    terminatedAt: null,
    notes: null,
    estimatedTotalCost: null,
    budgetRevisions: [],
    provisionalHandoverDate: "2027-03-31",
    finalHandoverDate: null,
    ...options.contract,
  });
  contracts.boq.push(boqLine());

  if (options.heldRetention) {
    ledger.post(RETENTION, m(options.heldRetention), Money.zero(), PROJECT_ID, "2026-08-06", "MST-1-DED");
    ledger.post(AR, Money.zero(), m(options.heldRetention), PROJECT_ID, "2026-08-06", "MST-1-DED");
  }

  const counters = new Map<string, number>();
  const sequences: SequenceStore = {
    async increment(code: string) {
      const next = (counters.get(code) ?? 0) + 1;
      counters.set(code, next);
      return next;
    },
  };

  /**
   * Stands in for the sales-invoice engine: ONE line crediting the retention
   * account, so Dr AR / Cr 1150 is the invoice's own posting and the AR
   * sub-ledger records exactly what the control account moved.
   */
  const invoicing: RetentionReleaseInvoicingPort = {
    async issue(cmd) {
      const invoiceId = `${cmd.releaseId}-INV`;
      ledger.post(AR, cmd.amount, Money.zero(), cmd.projectId, cmd.date, invoiceId);
      ledger.post(cmd.retentionAccountId, Money.zero(), cmd.amount, cmd.projectId, cmd.date, invoiceId);
      subLedger.set(invoiceId, cmd.amount);
      return { invoiceId, invoiceDocNo: `INV-${cmd.releaseDocNo}`, arAccountId: AR, total: cmd.amount };
    },
    async status(invoiceId) {
      const total = subLedger.get(invoiceId);
      if (!total) return null;
      return {
        invoiceId,
        docNo: invoiceId,
        total,
        amountPaid: Money.zero(),
        remainingBalance: total,
        dueDate: null,
        status: "confirmed",
      };
    },
  };

  const gl = { ledger } as unknown as JournalPostingDeps;
  const deps: ControlsServiceDeps = {
    releases,
    contracts,
    certificates: { listByContract: async (contractId: string) => certificates.filter((c) => c.contractId === contractId) },
    gl,
    numbering: new NextNumberService(sequences),
    invoicing,
    guarantees: options.performanceGuarantees
      ? {
          listPerformanceGuarantees: async () =>
            (options.performanceGuarantees ?? []).map((g) => ({ ...g, currentValue: m(g.currentValue) })),
        }
      : undefined,
    today: () => "2026-09-13",
  };
  const service = new ControlsService(deps);
  return { service, deps, contracts, releases, ledger, certificates, subLedger };
}

describe("تقويم المحتجزات — a public contract secured by a letter", () => {
  // 1,450 × 1,980 = 2,871,000; 5% of it is 143,550.
  const PUBLIC = {
    contractType: "public" as const,
    finalSecurityPercent: "5",
    provisionalHandoverDate: null,
    finalHandoverDate: null,
  };

  it("lists the contract with the letter's expiry as its release event, though nothing is held", async () => {
    const h = harness({
      contract: PUBLIC,
      performanceGuarantees: [{ id: "LG-5", docNo: "LG-0005", currentValue: "143550", expiryDate: "2026-11-12" }],
    });
    const calendar = await h.service.calendar("2026-09-13");
    expect(calendar.receivable).toHaveLength(1);
    const row = calendar.receivable[0]!;
    expect(row.held.toString()).toBe("0.000000");
    expect(row.balance.toString()).toBe("0.000000");
    expect(row.finalSecurity?.required.toString()).toBe("143550.000000");
    expect(row.finalSecurity?.covered.toString()).toBe("143550.000000");
    expect(row.finalSecurity?.shortfall.toString()).toBe("0.000000");
    expect(row.finalSecurity?.guaranteeDocNo).toBe("LG-0005");
    // The release event is the LETTER's expiry, not a handover date the contract does not have.
    expect(row.event.date).toBe("2026-11-12");
    expect(row.event.kind).toBeNull();
    expect(row.event.daysToEvent).toBe(60);
    expect(row.event.due).toBe(false);
  });

  it("ages a public contract from the day the letter expired, and reports an uncovered one", async () => {
    const h = harness({
      contract: PUBLIC,
      performanceGuarantees: [{ id: "LG-5", docNo: "LG-0005", currentValue: "100000", expiryDate: "2026-08-14" }],
    });
    const row = (await h.service.calendar("2026-09-13")).receivable[0]!;
    expect(row.event.due).toBe(true);
    expect(row.event.ageDays).toBe(30);
    expect(row.finalSecurity?.shortfall.toString()).toBe("43550.000000");
  });

  it("leaves a PRIVATE contract with nothing held off the calendar entirely", async () => {
    const h = harness();
    expect((await h.service.calendar("2026-09-13")).receivable).toHaveLength(0);
  });
});

describe("الإفراج عن المحتجزات", () => {
  it("derives the release event and flags an early release without refusing it", async () => {
    const h = harness({ heldRetention: "53269.90" });
    const view = await h.service.createRelease({
      id: "RET-1",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2026-09-01",
      amount: "5000",
    });
    expect(view.release.docNo).toBe("RET-000001");
    expect(view.release.releaseEventDate).toBe("2027-03-31");
    expect(view.release.earlyRelease).toBe(true);
    expect(view.position.held.toString()).toBe("53269.900000");
    expect(view.position.balance.toString()).toBe("53269.900000");
  });

  it("refuses more than the provisional percentage of what was held", async () => {
    const h = harness({ heldRetention: "100000" });
    await expect(
      h.service.createRelease({
        id: "RET-1",
        contractId: CONTRACT_ID,
        kind: "provisional",
        date: "2027-03-31",
        amount: "60000",
      }),
    ).rejects.toBeInstanceOf(RetentionReleaseExceedsBalanceError);
  });

  it("refuses more than the balance on a final release", async () => {
    const h = harness({ heldRetention: "10000" });
    await expect(
      h.service.createRelease({
        id: "RET-1",
        contractId: CONTRACT_ID,
        kind: "final",
        date: "2027-03-31",
        amount: "10000.01",
      }),
    ).rejects.toBeInstanceOf(RetentionReleaseExceedsBalanceError);
  });

  it("keeps the AR sub-ledger equal to the GL control after a release", async () => {
    const h = harness({ heldRetention: "53269.90" });
    await h.service.createRelease({
      id: "RET-1",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2026-09-01",
      amount: "5000",
    });
    const released = await h.service.release("RET-1", { userId: "USER-FINANCE", wildcardAdmin: false }, { approvedBy: "USER-CFO" });

    expect(released.release.status).toBe("released");
    expect(released.release.invoiceId).toBe("RET-1-INV");
    // The retention account fell by exactly what the receivable rose by…
    expect(h.ledger.balance(RETENTION).toString()).toBe("48269.900000");
    // …and the sub-ledger carries the same movement, so the two cannot drift.
    const subLedgerTotal = Money.sum([...h.subLedger.values()]);
    expect(subLedgerTotal.toString()).toBe("5000.000000");
    expect(h.ledger.balance(AR).toString()).toBe("-48269.900000");

    const position = await h.service.retentionPosition(PROJECT_ID);
    expect(position.released.toString()).toBe("5000.000000");
    expect(position.balance.toString()).toBe("48269.900000");
  });

  it("counts a released provisional tranche against the ceiling on the next one", async () => {
    const h = harness({ heldRetention: "100000" });
    await h.service.createRelease({
      id: "RET-1",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2027-03-31",
      amount: "40000",
    });
    await h.service.release("RET-1", { userId: "USER-FINANCE", wildcardAdmin: false }, { approvedBy: "USER-CFO" });
    await expect(
      h.service.createRelease({
        id: "RET-2",
        contractId: CONTRACT_ID,
        kind: "provisional",
        date: "2027-04-30",
        amount: "20000",
      }),
    ).rejects.toBeInstanceOf(RetentionReleaseExceedsBalanceError);
    const ok = await h.service.createRelease({
      id: "RET-3",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2027-04-30",
      amount: "10000",
    });
    expect(ok.release.amount.toString()).toBe("10000.000000");
  });

  it("records a handover on a COMPLETED contract — the event the calendar hangs on happens at the end", async () => {
    const h = harness({ heldRetention: "10000", contract: { status: "completed", completedAt: "2026-07-15", provisionalHandoverDate: null } });
    const contract = await h.service.recordHandover(CONTRACT_ID, { provisionalHandoverDate: "2026-09-15" });
    expect(contract.provisionalHandoverDate).toBe("2026-09-15");
  });
});

describe("تقويم المحتجزات", () => {
  it("lists the receivable side with its next event and no ageing before it", async () => {
    const h = harness({ heldRetention: "53269.90" });
    const calendar = await h.service.calendar("2026-09-13");
    expect(calendar.receivable).toHaveLength(1);
    const row = calendar.receivable[0];
    expect(row?.balance.toString()).toBe("53269.900000");
    expect(row?.event.kind).toBe("provisional");
    expect(row?.event.date).toBe("2027-03-31");
    expect(row?.event.due).toBe(false);
    expect(row?.event.ageDays).toBeNull();
  });

  it("ages a due balance from the release event, never from the certificate that withheld it", async () => {
    const h = harness({ heldRetention: "53269.90", contract: { provisionalHandoverDate: "2026-07-15" } });
    const calendar = await h.service.calendar("2026-09-13");
    expect(calendar.receivable[0]?.event.due).toBe(true);
    expect(calendar.receivable[0]?.event.ageDays).toBe(60);
  });

  it("lists the payable side from the LEDGER, so slice 3's retention shows without importing it", async () => {
    const h = harness({ heldRetention: "1000" });
    h.ledger.post("2195", Money.zero(), m("7500"), PROJECT_ID, "2026-08-20", "SUBC-1");
    h.ledger.post("2195", m("2500"), Money.zero(), PROJECT_ID, "2026-09-01", "SUBR-1");
    const calendar = await h.service.calendar("2026-09-13");
    expect(calendar.payable).toHaveLength(1);
    expect(calendar.payable[0]?.held.toString()).toBe("7500.000000");
    expect(calendar.payable[0]?.released.toString()).toBe("2500.000000");
    expect(calendar.payable[0]?.balance.toString()).toBe("5000.000000");
  });
});

describe("تقارير الاستثناءات", () => {
  it("reports the early release it created, and only after it is released", async () => {
    const h = harness({ heldRetention: "53269.90" });
    await h.service.createRelease({
      id: "RET-1",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2026-09-01",
      amount: "5000",
    });
    expect((await h.service.earlyRetentionReleases({ asOfDate: "2026-09-13" })).rows).toEqual([]);
    await h.service.release("RET-1", { userId: "USER-FINANCE", wildcardAdmin: false }, { approvedBy: "USER-CFO" });
    const report = await h.service.earlyRetentionReleases({ asOfDate: "2026-09-13" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.daysEarly).toBe(211);
    expect(report.ruleAr).toContain("يسبق ميعاد الاستحقاق");
  });

  it("finds the quantity overrun a certificate carries", async () => {
    const h = harness();
    h.certificates.push(
      certificate({
        workLines: [
          {
            id: "MST-1-W1",
            boqLineId: "B1",
            code: "1",
            descriptionAr: "الخرسانة العادية",
            unit: "m3",
            unitRate: m("1980"),
            thisPeriodQty: q("1500"),
            previousCumulativeQty: q("0"),
            cumulativeQty: q("1500"),
            contractedQty: q("1450"),
            completionPercent: "103.4",
            previousCumulativeValue: Money.zero(),
            cumulativeValue: m("2970000"),
            thisPeriodValue: m("2970000"),
            sortOrder: 1,
          },
        ],
      }),
    );
    const report = await h.service.boqOverruns({ asOfDate: "2026-09-13" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.excessQty.toString()).toBe("50.000000");
  });

  it("counts every report in the dashboard summary", async () => {
    const h = harness({ heldRetention: "53269.90" });
    const summary = await h.service.summary("2026-09-13");
    expect(summary.reports).toHaveLength(7);
    expect(summary.total).toBe(0);
  });

  it("sets the theoretical quantity on a line of an ACTIVE contract — it is reporting metadata, not a quantity", async () => {
    const h = harness();
    const lines = await h.service.setTheoreticalQuantities(CONTRACT_ID, [
      { boqLineId: "B1", theoreticalQtyPerUnit: "7", theoreticalItemId: "ITEM-1" },
    ]);
    expect(lines[0]?.theoreticalQtyPerUnit?.toString()).toBe("7.000000");
    expect(lines[0]?.theoreticalItemId).toBe("ITEM-1");
    expect(lines[0]?.qty.toString()).toBe("1450.000000");
  });
});

describe("الإفراج عن المحتجزات — فصل المهام", () => {
  it("refuses the author of the release as its releaser", async () => {
    const h = harness({ heldRetention: "53269.90" });
    await h.service.createRelease({
      id: "RET-SOD",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2027-03-31",
      amount: "5000",
      createdBy: "USER-FINANCE",
    });
    await expect(
      h.service.release("RET-SOD", { userId: "USER-FINANCE", wildcardAdmin: false }),
    ).rejects.toThrow(/لا يمكن لمن أنشأ مستند الإفراج أن يفرج عنه/);

    const released = await h.service.release("RET-SOD", { userId: "USER-TREASURER", wildcardAdmin: false });
    expect(released.release.status).toBe("released");
    expect(released.release.earlyRelease).toBe(false);
    expect(released.release.approvedBy).toBeNull();
  });

  it("demands a second approver on an early release, and refuses one who already signed", async () => {
    const h = harness({ heldRetention: "53269.90" });
    await h.service.createRelease({
      id: "RET-EARLY",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2026-09-01",
      amount: "5000",
      createdBy: "USER-FINANCE",
    });
    const actor = { userId: "USER-TREASURER", wildcardAdmin: false };
    await expect(h.service.release("RET-EARLY", actor)).rejects.toThrow(/اعتماد مستخدم ثانٍ/);
    await expect(
      h.service.release("RET-EARLY", actor, { approvedBy: "USER-FINANCE" }),
    ).rejects.toThrow(/غير مُنشئ المستند وغير المُفرِج/);
    await expect(
      h.service.release("RET-EARLY", actor, { approvedBy: "USER-TREASURER" }),
    ).rejects.toThrow(/غير مُنشئ المستند وغير المُفرِج/);

    const released = await h.service.release("RET-EARLY", actor, { approvedBy: "USER-CFO" });
    expect(released.release.earlyRelease).toBe(true);
    expect(released.release.approvedBy).toBe("USER-CFO");
  });

  it("waives both only for a wildcard admin in «وضع المشغّل الواحد»", async () => {
    const h = harness({ heldRetention: "53269.90" });
    const solo = new ControlsService({ ...h.deps, segregationWaived: async () => true });
    await solo.createRelease({
      id: "RET-SOLO",
      contractId: CONTRACT_ID,
      kind: "provisional",
      date: "2026-09-01",
      amount: "5000",
      createdBy: "USER-ADMIN",
    });
    const released = await solo.release("RET-SOLO", { userId: "USER-ADMIN", wildcardAdmin: true });
    expect(released.release.status).toBe("released");
  });
});
