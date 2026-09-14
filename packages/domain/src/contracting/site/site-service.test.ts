import { describe, it, expect, beforeEach } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { Account } from "../../accounts/account.js";
import { InMemoryAccountRepository } from "../../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
} from "../../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryProjectRepository } from "../../projects/test-helpers/in-memory-project-repository.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../../inventory/test-helpers/in-memory-stores.js";
import { StockLedgerService } from "../../inventory/stock-ledger-service.js";
import { NextNumberService } from "../../numbering/index.js";
import { createWarehouse, type Warehouse } from "../../settings/warehouse.js";
import type { WarehouseRepository } from "../../settings/ports.js";
import type { Asset, AssetRepository } from "../../fixed-assets/asset.js";
import { InvalidSiteDocumentError, SiteReceiptSelfReceiptError } from "./errors.js";
import { SiteService } from "./site-service.js";
import type {
  CustodyItem,
  EquipmentLog,
  MaterialConsumption,
  SiteIssue,
  SiteReceipt,
} from "./site-documents.js";
import type {
  CustodyRepository,
  EquipmentLogRepository,
  MaterialConsumptionRepository,
  SiteIssueRepository,
  SiteReceiptRepository,
} from "./ports.js";

const MAIN = "WH-MAIN";
const SITE = "WH-SITE";
const PROJECT = "PRJ-1";
const STOREKEEPER = "user-storekeeper";
const SUPERVISOR = "user-supervisor";
const ITEM = "ITEM-1";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

class InMemoryWarehouses implements WarehouseRepository {
  readonly rows = new Map<string, Warehouse>();
  async findAll() {
    return [...this.rows.values()];
  }
  async findByBranch(branchId: string) {
    return [...this.rows.values()].filter((w) => w.branchId === branchId);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async save(warehouse: Warehouse) {
    this.rows.set(warehouse.id, warehouse);
  }
}

function map<T extends { id: string }>() {
  return new Map<string, T>();
}

function issueRepo(rows: Map<string, SiteIssue>): SiteIssueRepository {
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByDocNo(docNo) {
      return [...rows.values()].find((r) => r.docNo === docNo) ?? null;
    },
    async list(filter = {}) {
      return [...rows.values()].filter(
        (r) => (!filter.projectId || r.projectId === filter.projectId) && (!filter.status || r.status === filter.status),
      );
    },
    async save(row) {
      rows.set(row.id, row);
    },
  };
}

function receiptRepo(rows: Map<string, SiteReceipt>): SiteReceiptRepository {
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByDocNo(docNo) {
      return [...rows.values()].find((r) => r.docNo === docNo) ?? null;
    },
    async list(filter = {}) {
      return [...rows.values()].filter(
        (r) => (!filter.projectId || r.projectId === filter.projectId) && (!filter.issueId || r.issueId === filter.issueId),
      );
    },
    async save(row) {
      rows.set(row.id, row);
    },
  };
}

function consumptionRepo(rows: Map<string, MaterialConsumption>): MaterialConsumptionRepository {
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByDocNo(docNo) {
      return [...rows.values()].find((r) => r.docNo === docNo) ?? null;
    },
    async list(filter = {}) {
      return [...rows.values()].filter(
        (r) => (!filter.projectId || r.projectId === filter.projectId) && (!filter.status || r.status === filter.status),
      );
    },
    async save(row) {
      rows.set(row.id, row);
    },
  };
}

function custodyRepo(rows: Map<string, CustodyItem>): CustodyRepository {
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async save(row) {
      rows.set(row.id, row);
    },
  };
}

function equipmentRepo(rows: Map<string, EquipmentLog>): EquipmentLogRepository {
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByDocNo(docNo) {
      return [...rows.values()].find((r) => r.docNo === docNo) ?? null;
    },
    async list(filter = {}) {
      return [...rows.values()].filter(
        (r) => (!filter.projectId || r.projectId === filter.projectId) && (!filter.status || r.status === filter.status),
      );
    },
    async save(row) {
      rows.set(row.id, row);
    },
  };
}

function assetRepo(rows: Map<string, Asset>): Pick<AssetRepository, "findById"> {
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}

interface Harness {
  service: SiteService;
  stock: StockLedgerService;
  ledger: InMemoryLedgerRepository;
  warehouses: InMemoryWarehouses;
  assets: Map<string, Asset>;
  setActiveContract: (value: boolean) => void;
}

async function harness(): Promise<Harness> {
  const warehouses = new InMemoryWarehouses();
  await warehouses.save(createWarehouse({ id: MAIN, code: "WH-MAIN", name: "الرئيسي", branchId: "BR-1" }));
  await warehouses.save(
    createWarehouse({
      id: SITE,
      code: "WH-SITE",
      name: "مستودع الموقع",
      branchId: "BR-1",
      type: "SITE",
      projectId: PROJECT,
      custodianUserId: STOREKEEPER,
    }),
  );

  const projects = new InMemoryProjectRepository();
  await projects.create({
    id: PROJECT,
    code: "P1",
    nameAr: "برج الأمل",
    nameEn: null,
    status: "active",
    customerId: null,
    managerId: null,
    startDate: null,
    endDate: null,
    budget: Money.zero(),
    siteAddress: null,
    notes: null,
    costCenterId: "cc-1",
  });

  const accounts = new InMemoryAccountRepository();
  for (const id of ["1200", "1230"]) await accounts.create(account(id));
  await accounts.create(account("5160", { type: "expense" }));

  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const ledger = new InMemoryLedgerRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const stock = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
  });

  const assets = map<Asset>();
  let activeContract = false;
  const service = new SiteService({
    issues: issueRepo(map<SiteIssue>()),
    receipts: receiptRepo(map<SiteReceipt>()),
    consumptions: consumptionRepo(map<MaterialConsumption>()),
    custody: custodyRepo(map<CustodyItem>()),
    equipmentLogs: equipmentRepo(map<EquipmentLog>()),
    warehouses,
    projects,
    assets: assetRepo(assets),
    stockLedger: stock,
    gl: { ledger, accounts, periods, numbering, projects },
    numbering,
    worksContracts: { hasActiveContract: async () => activeContract },
    now: () => "2026-08-30T09:00:00.000Z",
    today: () => "2026-08-30",
  });

  return {
    service,
    stock,
    ledger,
    warehouses,
    assets,
    setActiveContract: (value: boolean) => {
      activeContract = value;
    },
  };
}

/** 100 units into the main store at 10.00 each, so every issue below has a known WAC. */
async function stockMain(stock: StockLedgerService, qty: string, unitCost: string): Promise<void> {
  await stock.recordOpeningBalance({
    adjustmentId: `open-${qty}-${unitCost}`,
    warehouseId: MAIN,
    lines: [{ itemId: ITEM, qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }],
    occurredAt: "2026-08-01T00:00:00.000Z",
  });
}

async function issueAndReceive(h: Harness, issuedQty: string, receivedQty: string): Promise<void> {
  await h.service.createIssueDraft({
    id: "iss-1",
    date: "2026-08-10",
    fromWarehouseId: MAIN,
    toWarehouseId: SITE,
    issuedByUserId: STOREKEEPER,
    lines: [{ itemId: ITEM, qty: Qty.fromMajor(issuedQty) }],
  });
  await h.service.confirmIssue("iss-1");
  await h.service.createReceiptDraft({
    id: "rec-1",
    issueId: "iss-1",
    date: "2026-08-11",
    receivedByUserId: SUPERVISOR,
    lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor(receivedQty) }],
  });
  await h.service.confirmReceipt("rec-1");
}

describe("SiteService — الصرف والاستلام بالموقع", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await stockMain(h.stock, "100", "10.00");
  });

  it("moves the issued stock to the branch transit store and posts NOTHING to the GL", async () => {
    await h.service.createIssueDraft({
      id: "iss-1",
      date: "2026-08-10",
      fromWarehouseId: MAIN,
      toWarehouseId: SITE,
      issuedByUserId: STOREKEEPER,
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("30") }],
    });
    const issued = await h.service.confirmIssue("iss-1");

    expect(issued.docNo).toBe("ISS-000001");
    expect(issued.status).toBe("issued");
    expect(issued.transitWarehouseId).toBe("WH-TRANSIT-BR-1");
    expect((await h.stock.getBalance(ITEM, MAIN)).toString()).toBe("70.000000");
    expect((await h.stock.getBalance(ITEM, "WH-TRANSIT-BR-1")).toString()).toBe("30.000000");
    expect((await h.stock.getBalance(ITEM, SITE)).toString()).toBe("0.000000");
    expect(await h.ledger.list()).toHaveLength(0);
  });

  it("refuses a receipt signed by the person who issued it", async () => {
    await h.service.createIssueDraft({
      id: "iss-1",
      date: "2026-08-10",
      fromWarehouseId: MAIN,
      toWarehouseId: SITE,
      issuedByUserId: STOREKEEPER,
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("30") }],
    });
    await h.service.confirmIssue("iss-1");

    await expect(
      h.service.createReceiptDraft({
        id: "rec-1",
        issueId: "iss-1",
        date: "2026-08-11",
        receivedByUserId: STOREKEEPER,
        lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor("30") }],
      }),
    ).rejects.toBeInstanceOf(SiteReceiptSelfReceiptError);
  });

  it("caps a receipt at issued minus already received, derived from confirmed receipts", async () => {
    await issueAndReceive(h, "30", "24");

    await expect(
      h.service.createReceiptDraft({
        id: "rec-2",
        issueId: "iss-1",
        date: "2026-08-12",
        receivedByUserId: SUPERVISOR,
        lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor("7") }],
      }),
    ).rejects.toBeInstanceOf(InvalidSiteDocumentError);

    const within = await h.service.createReceiptDraft({
      id: "rec-3",
      issueId: "iss-1",
      date: "2026-08-12",
      receivedByUserId: SUPERVISOR,
      lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor("6") }],
    });
    expect(within.status).toBe("draft");
  });

  it("leaves the shortfall standing in transit and reports it as an exception", async () => {
    await issueAndReceive(h, "30", "24");

    expect((await h.stock.getBalance(ITEM, "WH-TRANSIT-BR-1")).toString()).toBe("6.000000");
    expect((await h.stock.getBalance(ITEM, SITE)).toString()).toBe("24.000000");
    const issue = await h.service.getIssue("iss-1");
    expect(issue?.status).toBe("partially_received");

    const rows = await h.service.listUnreceived({ asOf: "2026-08-20" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qtyOutstanding.toString()).toBe("6.000000");
    expect(rows[0]?.ageDays).toBe(10);
    // The same issue is invisible to a 30-day filter — an exception report that
    // fires on everything is an exception report nobody reads.
    expect(await h.service.listUnreceived({ olderThanDays: 30, asOf: "2026-08-20" })).toHaveLength(0);
  });

  it("marks the issue fully received when the last outstanding unit arrives", async () => {
    await issueAndReceive(h, "30", "24");
    await h.service.createReceiptDraft({
      id: "rec-2",
      issueId: "iss-1",
      date: "2026-08-12",
      receivedByUserId: SUPERVISOR,
      lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor("6") }],
    });
    await h.service.confirmReceipt("rec-2");

    expect((await h.service.getIssue("iss-1"))?.status).toBe("received");
    expect((await h.stock.getBalance(ITEM, "WH-TRANSIT-BR-1")).toString()).toBe("0.000000");
  });
});

describe("SiteService — استهلاك المواد", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await stockMain(h.stock, "100", "10.00");
    await issueAndReceive(h, "40", "40");
  });

  it("posts Dr WIP / Cr inventory for exactly the value the stock ledger moved, with both dimensions", async () => {
    await h.service.createConsumptionDraft({
      id: "con-1",
      date: "2026-08-20",
      warehouseId: SITE,
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("25") }],
    });
    const confirmed = await h.service.confirmConsumption("con-1");

    expect(confirmed.docNo).toBe("CON-000001");
    expect(confirmed.projectId).toBe(PROJECT);
    // 25 × the site store's WAC of 10.00 — the ledger's figure, not the document's.
    expect(confirmed.totalCost.toString()).toBe("250.000000");
    expect((await h.stock.getBalance(ITEM, SITE)).toString()).toBe("15.000000");

    const entry = await h.ledger.findById("con-1");
    expect(entry).not.toBeNull();
    const debit = entry?.lines.find((l) => l.debit.scaled > 0n);
    const credit = entry?.lines.find((l) => l.credit.scaled > 0n);
    // WIP, never COGS: WIP is relieved to cost of contract revenue monthly (D-12).
    expect(debit?.accountId).toBe("1230");
    expect(debit?.debit.toString()).toBe("250.000000");
    expect(debit?.projectId).toBe(PROJECT);
    expect(debit?.costCategory).toBe("materials");
    expect(credit?.accountId).toBe("1200");
    expect(credit?.credit.toString()).toBe("250.000000");
    expect(credit?.projectId).toBe(PROJECT);
    // فئة التكلفة belongs on the cost side only.
    expect(credit?.costCategory).toBeNull();
  });

  it("credits the moving average the SITE store actually holds, not the main store's", async () => {
    // A second, dearer receipt into the main store after the transfer: the site
    // position must keep its own average, or the credit would be a figure no
    // position ever held.
    await stockMain(h.stock, "100", "40.00");
    await h.service.createConsumptionDraft({
      id: "con-1",
      date: "2026-08-20",
      warehouseId: SITE,
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("10") }],
    });
    const confirmed = await h.service.confirmConsumption("con-1");
    expect(confirmed.totalCost.toString()).toBe("100.000000");
  });

  it("refuses a consumption out of a store that is not a site store", async () => {
    await expect(
      h.service.createConsumptionDraft({
        id: "con-2",
        date: "2026-08-20",
        warehouseId: MAIN,
        lines: [{ itemId: ITEM, qty: Qty.fromMajor("1") }],
      }),
    ).rejects.toBeInstanceOf(InvalidSiteDocumentError);
  });

  it("groups confirmed consumption by BOQ line, splitting the ledger's value without losing a unit", async () => {
    await h.service.createConsumptionDraft({
      id: "con-1",
      date: "2026-08-20",
      warehouseId: SITE,
      boqLineId: "BOQ-1",
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("25") }],
    });
    await h.service.confirmConsumption("con-1");

    const rows = await h.service.consumptionByBoqLine(PROJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.boqLineId).toBe("BOQ-1");
    expect(rows[0]?.qty.toString()).toBe("25.000000");
    expect(rows[0]?.cost.toString()).toBe("250.000000");
  });
});

describe("SiteService — العهدة وتشغيل المعدات", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    h.assets.set("AST-1", {
      id: "AST-1",
      code: "AST-1",
      nameAr: "خلاطة",
      nameEn: null,
      categoryId: "cat-1",
      scope: "general",
      branchId: null,
      warehouseId: null,
      acquisitionDate: "2025-01-01",
      acquisitionCost: Money.fromMajor("900000"),
      depreciationStartDate: "2025-01-01",
      depreciationMethod: "straight_line",
      usefulLifeMonths: 120,
      salvageValue: Money.zero(),
      accumulatedDepreciation: Money.zero(),
      status: "active",
      assetAccountId: null,
      depreciationExpenseAccountId: null,
      accumulatedDepreciationAccountId: null,
      notes: null,
      projectId: null,
      internalHourlyRate: Money.fromMajor("450"),
    });
  });

  it("posts Dr WIP (equipment) / Cr plant recovery for hours × the asset's internal rate", async () => {
    const draft = await h.service.createEquipmentLogDraft({
      id: "eql-1",
      projectId: PROJECT,
      assetId: "AST-1",
      date: "2026-08-27",
      hours: Qty.fromMajor("62"),
      boqLineId: "BOQ-1",
    });
    expect(draft.hourlyRate.toString()).toBe("450.000000");
    expect(draft.amount.toString()).toBe("27900.000000");

    const confirmed = await h.service.confirmEquipmentLog("eql-1");
    expect(confirmed.docNo).toBe("EQL-000001");

    const entry = await h.ledger.findById("eql-1");
    const debit = entry?.lines.find((l) => l.debit.scaled > 0n);
    const credit = entry?.lines.find((l) => l.credit.scaled > 0n);
    expect(debit?.accountId).toBe("1230");
    expect(debit?.debit.toString()).toBe("27900.000000");
    expect(debit?.projectId).toBe(PROJECT);
    expect(debit?.costCategory).toBe("equipment");
    expect(credit?.accountId).toBe("5160");
    expect(credit?.credit.toString()).toBe("27900.000000");
    expect(credit?.costCategory).toBeNull();

    const hours = await h.service.equipmentHours(PROJECT);
    expect(hours).toEqual([
      { boqLineId: "BOQ-1", hours: Qty.fromMajor("62"), amount: Money.fromMajor("27900") },
    ]);
  });

  it("refuses a log on plant with no internal hourly rate and no rate of its own", async () => {
    const asset = h.assets.get("AST-1") as Asset;
    h.assets.set("AST-1", { ...asset, internalHourlyRate: null });
    await expect(
      h.service.createEquipmentLogDraft({
        id: "eql-2",
        projectId: PROJECT,
        assetId: "AST-1",
        date: "2026-08-27",
        hours: Qty.fromMajor("5"),
      }),
    ).rejects.toBeInstanceOf(InvalidSiteDocumentError);
  });

  it("keeps the custody register out of the ledger entirely and caps a return at what went out", async () => {
    await h.service.issueCustody({
      id: "cust-1",
      warehouseId: SITE,
      descriptionAr: "شدة معدنية",
      qtyOut: Qty.fromMajor("120"),
      issuedDate: "2026-08-01",
    });
    const returned = await h.service.returnCustody("cust-1", { qty: Qty.fromMajor("40"), date: "2026-08-20" });
    expect(returned.qtyReturned.toString()).toBe("40.000000");
    expect(returned.custodianUserId).toBe(STOREKEEPER);

    await expect(
      h.service.returnCustody("cust-1", { qty: Qty.fromMajor("81"), date: "2026-08-21" }),
    ).rejects.toBeInstanceOf(InvalidSiteDocumentError);

    // No valuation, no movement, no posting — the register is a register (D-11).
    expect(await h.ledger.list()).toHaveLength(0);
    expect((await h.stock.getBalance(ITEM, SITE)).toString()).toBe("0.000000");
  });
});

describe("حدود تواريخ الاستلام وبند جدول الكميات", () => {
  it("refuses a receipt dated before the issue it closes, and one dated in the future", async () => {
    const h = await harness();
    await stockMain(h.stock, "100", "10");
    await h.service.createIssueDraft({
      id: "iss-b",
      date: "2026-08-10",
      fromWarehouseId: MAIN,
      toWarehouseId: SITE,
      issuedByUserId: STOREKEEPER,
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("30") }],
    });
    await h.service.confirmIssue("iss-b");

    await expect(
      h.service.createReceiptDraft({
        id: "rcp-early",
        issueId: "iss-b",
        date: "2026-08-09",
        receivedByUserId: SUPERVISOR,
        lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor("30") }],
      }),
    ).rejects.toThrow(/يسبق تاريخ إذن الصرف/);

    await expect(
      h.service.createReceiptDraft({
        id: "rcp-future",
        issueId: "iss-b",
        date: "2026-09-30",
        receivedByUserId: SUPERVISOR,
        lines: [{ itemId: ITEM, qtyReceived: Qty.fromMajor("30") }],
      }),
    ).rejects.toThrow(/بعد تاريخ اليوم/);
  });

  it("refuses a consumption with no BOQ line on a project running under a live contract", async () => {
    const h = await harness();
    h.setActiveContract(true);
    await stockMain(h.stock, "100", "10");
    await expect(
      h.service.createConsumptionDraft({
        id: "con-x",
        date: "2026-08-27",
        warehouseId: SITE,
        lines: [{ itemId: ITEM, qty: Qty.fromMajor("5") }],
      }),
    ).rejects.toThrow(/بند جدول الكميات مطلوب/);

    // …and allows it on a project with no live contract, which has no bill to name.
    h.setActiveContract(false);
    const draft = await h.service.createConsumptionDraft({
      id: "con-y",
      date: "2026-08-27",
      warehouseId: SITE,
      lines: [{ itemId: ITEM, qty: Qty.fromMajor("5") }],
    });
    expect(draft.boqLineId).toBeNull();
  });

  it("refuses a per-log rate override: the plant rate is the asset's and nothing else", async () => {
    const h = await harness();
    h.assets.set("AST-RATE", {
      id: "AST-RATE",
      code: "AST-2",
      nameAr: "حفار",
      nameEn: null,
      categoryId: "cat-1",
      scope: "general",
      branchId: null,
      warehouseId: null,
      acquisitionDate: "2025-01-01",
      acquisitionCost: Money.fromMajor("500000"),
      depreciationStartDate: "2025-01-01",
      depreciationMethod: "straight_line",
      usefulLifeMonths: 120,
      salvageValue: Money.zero(),
      accumulatedDepreciation: Money.zero(),
      status: "active",
      assetAccountId: null,
      depreciationExpenseAccountId: null,
      accumulatedDepreciationAccountId: null,
      notes: null,
      projectId: null,
      internalHourlyRate: Money.fromMajor("300"),
    });
    const draft = await h.service.createEquipmentLogDraft({
      // A caller that still sends a rate is ignored by the type AND the service.
      ...({ hourlyRate: Money.fromMajor("9000") } as object),
      id: "eql-rate",
      projectId: PROJECT,
      assetId: "AST-RATE",
      date: "2026-08-27",
      hours: Qty.fromMajor("4"),
    });
    expect(draft.hourlyRate.toString()).toBe("300.000000");
    expect(draft.amount.toString()).toBe("1200.000000");
  });
});
