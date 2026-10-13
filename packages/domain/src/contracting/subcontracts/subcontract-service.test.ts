import { insertOnly } from "../../records/test-helpers/insert-only.js";
import { describe, expect, it } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { Account } from "../../accounts/account.js";
import { InMemoryAccountRepository } from "../../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { InMemoryLedgerRepository } from "../../gl/test-helpers/in-memory-ledger-repository.js";
import { NextNumberService, type SequenceStore } from "../../numbering/index.js";
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
import { SubcontractService } from "./subcontract-service.js";
import { SubCertificateService } from "./sub-certificate-service.js";
import {
  InvalidSubCertificateError,
  InvalidSubcontractError,
  SubCertificateDeductionError,
  SubCertificateQuantityError,
  SubcontractRetentionError,
  SubcontractorNotPayableError,
} from "./errors.js";
import type {
  SubCertificate,
  SubCertificateListFilter,
  SubcontractStore,
} from "./sub-certificate.js";
import type { Subcontract, SubcontractListFilter } from "./subcontract.js";
import type {
  SubCertificateInvoiceCommand,
  SubCertificateInvoicingPort,
  SubcontractRetentionInvoicingPort,
  SubcontractRetentionReleaseInvoiceCommand,
  SubcontractorParty,
} from "./ports.js";
import { postJournalEntry } from "../../gl/index.js";

const CONTRACT_ID = "CTR-1";
const PROJECT_ID = "PRJ-1";
const SUPPLIER_ID = "SUP-1";
const SUBCONTRACT_ID = "SUB-1";

class MemoryContractStore implements WorksContractStore {
  contracts = new Map<string, WorksContract>();
  boq: BoqLine[] = [];

  async findContractById(id: string) {
    return this.contracts.get(id) ?? null;
  }
  async findContractByDocNo(docNo: string) {
    return [...this.contracts.values()].find((c) => c.docNo === docNo) ?? null;
  }
  async listContracts(filter?: WorksContractListFilter) {
    return [...this.contracts.values()].filter((c) => !filter?.status || c.status === filter.status);
  }
  async insertContract(contract: WorksContract) {
    insertOnly(this.contracts, contract.id, contract);
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
  async listAdjustments(_contractId: string): Promise<BoqLineAdjustment[]> {
    return [];
  }
  async addAdjustments(_adjustments: readonly BoqLineAdjustment[]) {}
  async listVariationOrders(_filter?: VariationOrderListFilter): Promise<VariationOrder[]> {
    return [];
  }
  async findVariationOrderById(_id: string) {
    return null;
  }
  async findVariationOrderByDocNo(_docNo: string) {
    return null;
  }
  async insertVariationOrder(_order: VariationOrder) {}
  async saveVariationOrder(_order: VariationOrder) {}
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

class MemorySubcontractStore implements SubcontractStore {
  rows = new Map<string, Subcontract>();
  certificates = new Map<string, SubCertificate>();

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByDocNo(docNo: string) {
    return [...this.rows.values()].find((r) => r.docNo === docNo) ?? null;
  }
  async list(filter?: SubcontractListFilter) {
    return [...this.rows.values()].filter((r) => !filter?.contractId || r.contractId === filter.contractId);
  }
  async insert(subcontract: Subcontract) {
    insertOnly(this.rows, subcontract.id, subcontract);
  }
  async save(subcontract: Subcontract) {
    this.rows.set(subcontract.id, subcontract);
  }
  async findCertificateById(id: string) {
    return this.certificates.get(id) ?? null;
  }
  async findCertificateByDocNo(docNo: string) {
    return [...this.certificates.values()].find((r) => r.docNo === docNo) ?? null;
  }
  async listCertificates(filter?: SubCertificateListFilter) {
    return [...this.certificates.values()].filter(
      (r) => !filter?.subcontractId || r.subcontractId === filter.subcontractId,
    );
  }
  async listCertificatesBySubcontract(subcontractId: string) {
    return [...this.certificates.values()]
      .filter((r) => r.subcontractId === subcontractId)
      .sort((a, b) => a.serial - b.serial);
  }
  async insertCertificate(certificate: SubCertificate) {
    insertOnly(this.certificates, certificate.id, certificate);
  }
  async saveCertificate(certificate: SubCertificate) {
    this.certificates.set(certificate.id, certificate);
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

function account(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"]): Account {
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
    costCategory: "subcontract",
    theoreticalQtyPerUnit: null,
    theoreticalItemId: null,
  };
}

const ADMIN = { userId: "admin", wildcardAdmin: true };
const ENGINEER = { userId: "engineer", wildcardAdmin: false };
const TECHNICAL = { userId: "technical", wildcardAdmin: false };
const FINANCE = { userId: "finance", wildcardAdmin: false };

interface Harness {
  subcontracts: SubcontractService;
  certificates: SubCertificateService;
  store: MemorySubcontractStore;
  ledger: InMemoryLedgerRepository;
  supplier: { value: SubcontractorParty | null };
  /** The cumulative quantity the consultant has certified to the EMPLOYER, per client BOQ line. */
  ceiling: Map<string, Qty>;
  issued: SubCertificateInvoiceCommand[];
  settled: { invoiceId: string; amount: Money }[];
  /** Σ of the site consumptions issued to this subcontract — the materials-deduction ceiling. */
  materialsIssued: { value: Money };
  releaseInvoices: SubcontractRetentionReleaseInvoiceCommand[];
}

async function harness(): Promise<Harness> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  for (const [id, type, natural] of [
    ["1230", "asset", "debit"],
    ["1350", "asset", "debit"],
    ["2100", "liability", "credit"],
    ["2195", "liability", "credit"],
    ["2197", "liability", "credit"],
    ["2210", "liability", "credit"],
    ["5155", "expense", "debit"],
    ["5910", "expense", "debit"],
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
    estimatedTotalCost: null,
    budgetRevisions: [],
    provisionalHandoverDate: null,
    finalHandoverDate: null,
  });
  contracts.boq = [boqLine("B1", "1", "12000", "185", 1), boqLine("B2", "2", "1450", "1980", 2)];

  const store = new MemorySubcontractStore();
  const supplier: { value: SubcontractorParty | null } = {
    value: { id: SUPPLIER_ID, nameAr: "مقاول الحفر", taxNumber: "512-874-903", bankAccount: "EG38001900050000" },
  };
  const suppliers = { find: async (id: string) => (id === SUPPLIER_ID ? supplier.value : null) };
  const ceiling = new Map<string, Qty>();
  const issued: SubCertificateInvoiceCommand[] = [];
  const settled: { invoiceId: string; amount: Money }[] = [];
  const gl = { ledger, accounts, periods, numbering };
  const invoicing: SubCertificateInvoicingPort = {
    async issue(cmd) {
      issued.push(cmd);
      return {
        invoiceId: `${cmd.certificateId}-PINV`,
        invoiceDocNo: `PI-${issued.length}`,
        apAccountId: "2100",
        total: cmd.amount,
      };
    },
    async status() {
      return null;
    },
    async settle(invoiceId, amount) {
      settled.push({ invoiceId, amount });
    },
  };

  const materialsIssued = { value: Money.zero() };
  const releaseInvoices: SubcontractRetentionReleaseInvoiceCommand[] = [];
  /**
   * The release is an AP DOCUMENT: its own posting is Dr 2195 / Cr AP, exactly
   * as the real purchase-invoice engine raises it in the composition.
   */
  const retentionInvoicing: SubcontractRetentionInvoicingPort = {
    async issue(cmd) {
      releaseInvoices.push(cmd);
      const journalEntryId = `PI-JE:${cmd.releaseId}-PINV`;
      await postJournalEntry(
        {
          id: journalEntryId,
          date: cmd.date,
          memo: cmd.memoAr,
          source: "system",
          sourceDocType: "PURCHASE_INVOICE",
          sourceDocId: `${cmd.releaseId}-PINV`,
          sourceDocNumber: `PI-RET-${releaseInvoices.length}`,
          lines: [
            {
              accountId: cmd.retentionAccountId,
              debit: cmd.amount,
              credit: Money.zero(),
              projectId: cmd.projectId,
            },
            { accountId: "2100", debit: Money.zero(), credit: cmd.amount, projectId: cmd.projectId },
          ],
        },
        gl,
        { mintedBySystem: true },
      );
      return {
        invoiceId: `${cmd.releaseId}-PINV`,
        invoiceDocNo: `PI-RET-${releaseInvoices.length}`,
        journalEntryId,
      };
    },
  };
  return {
    subcontracts: new SubcontractService({
      store,
      contracts,
      numbering,
      suppliers,
      retentionInvoicing,
      today: () => "2026-06-30",
    }),
    certificates: new SubCertificateService({
      store,
      contracts,
      numbering,
      gl,
      invoicing,
      suppliers,
      clientCertificates: { certifiedCumulativeByBoqLine: async () => ceiling },
      consumptions: { materialsIssuedTo: async () => materialsIssued.value },
      today: () => "2026-06-30",
    }),
    store,
    ledger,
    supplier,
    ceiling,
    issued,
    settled,
    materialsIssued,
    releaseInvoices,
  };
}

async function draftSubcontract(h: Harness, overrides: Record<string, unknown> = {}) {
  return h.subcontracts.create(
    {
      id: SUBCONTRACT_ID,
      contractId: CONTRACT_ID,
      supplierId: SUPPLIER_ID,
      titleAr: "عقد باطن الحفر",
      signedDate: "2026-01-02",
      startDate: "2026-01-05",
      plannedEndDate: "2026-12-31",
      retentionPercent: "5",
      advanceRecoveryPercent: "10",
      withholdingTaxPercent: "1",
      lines: [
        { clientBoqLineId: "B1", qty: "12000", unitRate: "140" },
        { clientBoqLineId: "B2", qty: "1450", unitRate: "1650" },
      ],
      ...overrides,
    } as Parameters<SubcontractService["create"]>[0],
    ADMIN,
  );
}

describe("SubcontractService", () => {
  it("stamps the client rate and the margin on every back-to-back line", async () => {
    const h = await harness();
    const view = await draftSubcontract(h);
    expect(view.subcontract.lines.map((l) => l.marginVsClient.toString())).toEqual([
      "45.000000",
      "330.000000",
    ]);
    expect(view.value.toString()).toBe("4072500.000000");
    expect(view.clientValue.toString()).toBe("5091000.000000");
  });

  it("refuses a sub line let for more quantity than the client contract carries", async () => {
    const h = await harness();
    await expect(
      draftSubcontract(h, { lines: [{ clientBoqLineId: "B1", qty: "13000", unitRate: "140" }] }),
    ).rejects.toThrow(InvalidSubcontractError);
  });

  it("refuses to activate a subcontractor with no tax number and no bank account, naming both", async () => {
    const h = await harness();
    await draftSubcontract(h);
    h.supplier.value = { id: SUPPLIER_ID, nameAr: "مقاول الحفر", taxNumber: null, bankAccount: null };
    const error = await h.subcontracts.activate(SUBCONTRACT_ID, "2026-01-05").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubcontractorNotPayableError);
    const reasons = (error as SubcontractorNotPayableError).reasons;
    expect(reasons.some((r) => r.includes("رقم ضريبي"))).toBe(true);
    expect(reasons.some((r) => r.includes("حساب بنكي"))).toBe(true);
  });

  it("persists the labour-only kind and refuses to activate it before the ETA/NOSI review is declared", async () => {
    const h = await harness();
    await draftSubcontract(h, { kind: "labour_only" });
    expect((await h.subcontracts.get(SUBCONTRACT_ID)).subcontract.kind).toBe("labour_only");
    await expect(h.subcontracts.activate(SUBCONTRACT_ID, "2026-01-05")).rejects.toThrow(InvalidSubcontractError);
    await h.subcontracts.update(SUBCONTRACT_ID, {
      disguisedEmploymentReviewed: true,
      reviewNote: "روجع التكييف.",
    });
    const activated = await h.subcontracts.activate(SUBCONTRACT_ID, "2026-01-05");
    expect(activated.subcontract.status).toBe("active");
    expect(activated.subcontract.disguisedEmploymentReviewed).toBe(true);
  });
});

async function activeWithCertificate(h: Harness, qty = "1500") {
  await draftSubcontract(h);
  await h.subcontracts.activate(SUBCONTRACT_ID, "2026-01-05");
  h.ceiling.set("B1", Qty.fromMajor("5200"));
  h.ceiling.set("B2", Qty.fromMajor("260"));
  const lines = (await h.subcontracts.get(SUBCONTRACT_ID)).subcontract.lines;
  await h.certificates.create(
    {
      id: "SMST-1",
      subcontractId: SUBCONTRACT_ID,
      periodFrom: "2026-02-01",
      periodTo: "2026-02-28",
      workLines: [
        { subcontractLineId: lines[0]!.id, thisPeriodQty: qty },
        { subcontractLineId: lines[1]!.id, thisPeriodQty: "20" },
      ],
    },
    ENGINEER,
  );
  return lines;
}

describe("SubCertificateService", () => {
  it("refuses a cumulative quantity beyond what the consultant certified to the employer, naming both figures", async () => {
    const h = await harness();
    await activeWithCertificate(h, "9000");
    const error = await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubCertificateQuantityError);
    const [reason] = (error as SubCertificateQuantityError).reasons;
    expect(reason).toContain("لا يجوز اعتماد كمية للمقاول تتجاوز ما اعتمده الاستشاري");
    expect(reason).toContain("9000");
    expect(reason).toContain("5200");
  });

  it("posts a balanced deductions entry that DEBITS payables and credits retention, WHT and the advance", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    const view = await h.certificates.approve("SMST-1", "2026-03-05", FINANCE);

    expect(view.certificate.status).toBe("invoiced");
    expect(h.issued[0]?.expenseAccountId).toBe("1230");
    expect(h.issued[0]?.amount.toString()).toBe("243000.000000");
    // Retention 12,150 + WHT 2,430. No advance was linked, so the recovery is
    // capped at nothing paid — which is the point of capping it at the vouchers.
    expect(view.certificate.postedDeductionsTotal.toString()).toBe("14580.000000");
    expect(h.settled[0]?.amount.toString()).toBe("14580.000000");

    const entry = (await h.ledger.list({ status: "posted" })).find((e) => e.id === "SMST-1-DED");
    expect(entry).toBeDefined();
    const byAccount = new Map(entry!.lines.map((l) => [l.accountId, l]));
    expect(byAccount.get("2100")!.debit.toString()).toBe("14580.000000");
    expect(byAccount.get("2195")!.credit.toString()).toBe("12150.000000");
    expect(byAccount.get("2210")!.credit.toString()).toBe("2430.000000");
    // Every line carries the project; the payable carries no cost category,
    // because a category on a payable is a figure nothing can roll up.
    expect(entry!.lines.every((l) => l.projectId === PROJECT_ID)).toBe(true);
    expect(byAccount.get("2100")!.costCategory ?? null).toBeNull();
    expect(byAccount.get("2195")!.costCategory ?? null).toBeNull();
  });

  it("returns materials issued to the sub from WIP under the subcontract cost category", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    h.materialsIssued.value = Money.fromMajor("400");
    await h.certificates.update("SMST-1", { employerMaterialsCumulative: "260.12" }, ENGINEER);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    await h.certificates.approve("SMST-1", "2026-03-05", FINANCE);

    const entry = (await h.ledger.list({ status: "posted" })).find((e) => e.id === "SMST-1-DED");
    const wip = entry!.lines.find((l) => l.accountId === "1230");
    expect(wip?.credit.toString()).toBe("260.120000");
    expect(wip?.costCategory).toBe("subcontract");
    expect(wip?.projectId).toBe(PROJECT_ID);
  });

  it("refuses the certify and the approve signatures to the person who prepared it", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await expect(h.certificates.certify("SMST-1", ENGINEER, "2026-03-03")).rejects.toThrow(/نفس الشخص الذي أعدّه/);
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    await expect(h.certificates.approve("SMST-1", "2026-03-05", TECHNICAL)).rejects.toThrow(
      /اعتمد الحصر فنيًا/,
    );
  });

  it("refuses to approve for payment once the subcontractor's bank account has been removed", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    h.supplier.value = { id: SUPPLIER_ID, nameAr: "مقاول الحفر", taxNumber: "512", bankAccount: null };
    await expect(h.certificates.approve("SMST-1", "2026-03-05", FINANCE)).rejects.toThrow(
      InvalidSubCertificateError,
    );
  });
});

describe("subcontract retention", () => {
  it("releases against the balance actually held and posts Dr 2195 / Cr AP", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    await h.certificates.approve("SMST-1", "2026-03-05", FINANCE);

    const held = await h.subcontracts.retentionPosition(SUBCONTRACT_ID);
    expect(held.held.toString()).toBe("12150.000000");
    expect(held.balance.toString()).toBe("12150.000000");

    await expect(
      h.subcontracts.releaseRetention(SUBCONTRACT_ID, { amount: "20000", date: "2026-04-01" }, ADMIN),
    ).rejects.toThrow(SubcontractRetentionError);

    const after = await h.subcontracts.releaseRetention(
      SUBCONTRACT_ID,
      { amount: "5000", date: "2026-04-01" },
      ADMIN,
    );
    expect(after.retention.released.toString()).toBe("5000.000000");
    expect(after.retention.balance.toString()).toBe("7150.000000");

    const entry = (await h.ledger.list({ status: "posted" })).find(
      (e) => e.id === `PI-JE:${SUBCONTRACT_ID}-RET-1-PINV`,
    );
    const byAccount = new Map(entry!.lines.map((l) => [l.accountId, l]));
    expect(byAccount.get("2195")!.debit.toString()).toBe("5000.000000");
    expect(byAccount.get("2100")!.credit.toString()).toBe("5000.000000");
    expect(entry!.lines.every((l) => l.projectId === PROJECT_ID)).toBe(true);
  });
});

describe("sub certificate deduction bounds", () => {
  it("refuses a block whose deductions drive the net payable below zero", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await h.certificates.update("SMST-1", { penaltiesCumulative: "400000" }, ENGINEER);
    const error = await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubCertificateDeductionError);
    expect((error as SubCertificateDeductionError).reasons.join("، ")).toContain("صافي المستحق");
  });

  it("caps the materials deduction at what the site store actually issued to this subcontract", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    h.materialsIssued.value = Money.fromMajor("1000");
    await h.certificates.update("SMST-1", { employerMaterialsCumulative: "1500" }, ENGINEER);
    const error = await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubCertificateDeductionError);
    expect((error as SubCertificateDeductionError).reasons.join("، ")).toContain("1000");

    await h.certificates.update("SMST-1", { employerMaterialsCumulative: "900" }, ENGINEER);
    expect((await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01")).certificate.status).toBe("measured");
  });

  it("refuses a penalty past the cap the package was let at, naming the ceiling", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    // 30,000 on 243,000 certified — well inside the net payable, and past the
    // 10% ceiling the package was let at.
    await h.certificates.update("SMST-1", { penaltiesCumulative: "30000" }, ENGINEER);
    const error = await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubCertificateDeductionError);
    const reasons = (error as SubCertificateDeductionError).reasons.join("، ");
    expect(reasons).toContain("غرامة التأخير");
    expect(reasons).toContain("24300");
  });
});

describe("back-to-back ceiling across two subcontracts", () => {
  it("nets the other subcontracts' certified quantity out of the client's certified figure", async () => {
    const h = await harness();
    const lines = await activeWithCertificate(h, "2800");
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");

    // A SECOND package on the same client BOQ line B1.
    await h.subcontracts.create(
      {
        id: "SUB-2",
        contractId: CONTRACT_ID,
        supplierId: SUPPLIER_ID,
        titleAr: "عقد باطن ثانٍ على نفس البند",
        signedDate: "2026-01-02",
        startDate: "2026-01-05",
        plannedEndDate: "2026-12-31",
        retentionPercent: "5",
        withholdingTaxPercent: "1",
        lines: [{ clientBoqLineId: "B1", qty: "5000", unitRate: "130" }],
      },
      ADMIN,
    );
    await h.subcontracts.activate("SUB-2", "2026-01-05");
    const secondLines = (await h.subcontracts.get("SUB-2")).subcontract.lines;
    await h.certificates.create(
      {
        id: "SMST-2",
        subcontractId: "SUB-2",
        periodFrom: "2026-02-01",
        periodTo: "2026-02-28",
        workLines: [{ subcontractLineId: secondLines[0]!.id, thisPeriodQty: "2500" }],
      },
      ENGINEER,
    );

    // 2,800 + 2,500 = 5,300 against a client figure of 5,200: under the old
    // per-subcontract rule both passed and the same 100 m³ was paid twice.
    const error = await h.certificates.measure("SMST-2", ENGINEER, "2026-03-01").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubCertificateQuantityError);
    const reason = (error as SubCertificateQuantityError).reasons.join("، ");
    expect(reason).toContain("معتمد لمقاولي باطن آخرين");
    expect(reason).toContain("2400");

    await h.certificates.update("SMST-2", {
      workLines: [{ subcontractLineId: secondLines[0]!.id, thisPeriodQty: "2400" }],
    }, ENGINEER);
    expect((await h.certificates.measure("SMST-2", ENGINEER, "2026-03-01")).certificate.status).toBe("measured");
    expect(lines).toHaveLength(2);
  });
});

describe("sub certificate posting details", () => {
  it("credits social insurance withheld from the sub to the liability 2197, never to insurance expense", async () => {
    const h = await harness();
    await draftSubcontract(h, {
      withholdSocialInsurance: true,
      deemedWagePercent: "100",
      socialInsuranceRatePercent: "18.75",
    });
    await h.subcontracts.activate(SUBCONTRACT_ID, "2026-01-05");
    h.ceiling.set("B1", Qty.fromMajor("5200"));
    h.ceiling.set("B2", Qty.fromMajor("260"));
    const lines = (await h.subcontracts.get(SUBCONTRACT_ID)).subcontract.lines;
    await h.certificates.create(
      {
        id: "SMST-1",
        subcontractId: SUBCONTRACT_ID,
        periodFrom: "2026-02-01",
        periodTo: "2026-02-28",
        workLines: [{ subcontractLineId: lines[0]!.id, thisPeriodQty: "1000" }],
      },
      ENGINEER,
    );
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    await h.certificates.approve("SMST-1", "2026-03-05", FINANCE);

    const entry = (await h.ledger.list({ status: "posted" })).find((e) => e.id === "SMST-1-DED");
    const byAccount = new Map(entry!.lines.map((l) => [l.accountId, l]));
    // 140,000 × 100% × 18.75%
    expect(byAccount.get("2197")!.credit.toString()).toBe("26250.000000");
    expect(byAccount.has("5155")).toBe(false);
    expect(byAccount.get("2197")!.costCategory ?? null).toBeNull();
  });

  it("puts the transitional-basis tax on the cost of the work instead of claiming it as input VAT", async () => {
    const h = await harness();
    await draftSubcontract(h, { vatBasis: "transitional" });
    await h.subcontracts.activate(SUBCONTRACT_ID, "2026-01-05");
    h.ceiling.set("B1", Qty.fromMajor("5200"));
    const lines = (await h.subcontracts.get(SUBCONTRACT_ID)).subcontract.lines;
    await h.certificates.create(
      {
        id: "SMST-1",
        subcontractId: SUBCONTRACT_ID,
        periodFrom: "2026-02-01",
        periodTo: "2026-02-28",
        workLines: [{ subcontractLineId: lines[0]!.id, thisPeriodQty: "1000" }],
      },
      ENGINEER,
    );
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    const view = await h.certificates.approve("SMST-1", "2026-03-05", FINANCE);

    const cmd = h.issued.at(-1)!;
    // D-07: the 5.04% is not recoverable, so the invoice is raised at zero and
    // the tax rides on the WIP line with the work it belongs to.
    expect(cmd.taxRatePercent).toBe("0");
    expect(cmd.amount.toString()).toBe(
      Money.fromScaled(
        view.certificate.computed.invoiceBase.scaled + view.certificate.computed.vat.scaled,
      ).toString(),
    );
    expect(view.certificate.computed.vatEffectiveRatePercent).toBe("5.040000");
  });
});

describe("sub retention release as an AP document", () => {
  it("raises a purchase invoice due on the release event and flags an early release", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    await h.certificates.approve("SMST-1", "2026-03-05", FINANCE);
    await h.subcontracts.complete(SUBCONTRACT_ID, "2026-04-30");

    const after = await h.subcontracts.releaseRetention(
      SUBCONTRACT_ID,
      { amount: "5000", date: "2026-05-10", kind: "final" },
      ADMIN,
    );
    const release = after.retention.releases.at(-1)!;
    // 12 months of defects liability from the completion date.
    expect(release.releaseEventDate).toBe("2027-04-30");
    expect(release.earlyRelease).toBe(true);
    expect(release.invoiceId).toBe(`${SUBCONTRACT_ID}-RET-1-PINV`);
    expect(h.releaseInvoices.at(-1)!.dueDate).toBe("2027-04-30");
    expect(h.releaseInvoices.at(-1)!.retentionAccountId).toBe("2195");

    const provisional = await h.subcontracts.releaseRetention(
      SUBCONTRACT_ID,
      { amount: "1000", date: "2026-05-10", kind: "provisional" },
      ADMIN,
    );
    expect(provisional.retention.releases.at(-1)!.earlyRelease).toBe(false);
    expect(provisional.retention.completionDate).toBe("2026-04-30");
  });
});

describe("sub certificate cancellation and the signature dates", () => {
  it("stamps the canceller and the reason, never back-fills measuredBy, and keeps the serial monotonic", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await expect(h.certificates.cancel("SMST-1", "   ", ENGINEER)).rejects.toThrow(InvalidSubCertificateError);

    const cancelled = await h.certificates.cancel("SMST-1", "خطأ في الحصر", TECHNICAL);
    expect(cancelled.certificate.status).toBe("cancelled");
    expect(cancelled.certificate.cancelledBy).toBe("technical");
    expect(cancelled.certificate.cancelReasonAr).toBe("خطأ في الحصر");
    expect(cancelled.certificate.measuredBy).toBeNull();

    const lines = (await h.subcontracts.get(SUBCONTRACT_ID)).subcontract.lines;
    const next = await h.certificates.create(
      {
        id: "SMST-2",
        subcontractId: SUBCONTRACT_ID,
        periodFrom: "2026-03-01",
        periodTo: "2026-03-31",
        workLines: [{ subcontractLineId: lines[0]!.id, thisPeriodQty: "100" }],
      },
      ENGINEER,
    );
    expect(next.certificate.serial).toBe(2);
  });

  it("refuses a signature dated before the work it signs for or after today", async () => {
    const h = await harness();
    await activeWithCertificate(h);
    await expect(h.certificates.measure("SMST-1", ENGINEER, "2026-02-01")).rejects.toThrow(
      /يسبق تاريخ نهاية الفترة/,
    );
    await expect(h.certificates.measure("SMST-1", ENGINEER, "2026-12-31")).rejects.toThrow(/في المستقبل/);
    await h.certificates.measure("SMST-1", ENGINEER, "2026-03-01");
    await expect(h.certificates.certify("SMST-1", TECHNICAL, "2026-02-28")).rejects.toThrow(
      /يسبق تاريخ الحصر/,
    );
    await h.certificates.certify("SMST-1", TECHNICAL, "2026-03-03");
    await expect(h.certificates.approve("SMST-1", "2026-03-02", FINANCE)).rejects.toThrow(
      /يسبق تاريخ الاعتماد الفني/,
    );
  });
});
