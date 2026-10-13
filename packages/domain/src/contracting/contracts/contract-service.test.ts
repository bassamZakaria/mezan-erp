import { insertOnly } from "../../records/test-helpers/insert-only.js";
import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../../money/index.js";
import { NextNumberService, type SequenceStore } from "../../numbering/index.js";
import type {
  BoqLine,
  BoqLineAdjustment,
  VariationOrder,
  WorksContract,
  WorksContractListFilter,
  WorksContractStore,
  VariationOrderListFilter,
} from "./contract.js";
import {
  WorksContractService,
  defaultVatBasis,
  defaultWorksContractTerms,
  type WorksContractActor,
} from "./contract-service.js";
import {
  WorksContractNotDraftError,
  InvalidWorksContractError,
  SelfApprovalError,
} from "./errors.js";

class MemoryStore implements WorksContractStore {
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
    return [...this.contracts.values()].filter(
      (c) => (!filter?.projectId || c.projectId === filter.projectId) && (!filter?.status || c.status === filter.status),
    );
  }
  async insertContract(contract: WorksContract) {
    insertOnly(this.contracts, contract.id, contract);
  }
  async saveContract(contract: WorksContract) {
    this.contracts.set(contract.id, contract);
  }
  async listBoqLines(contractId: string) {
    return this.boq.filter((l) => l.contractId === contractId).sort((a, b) => a.sortOrder - b.sortOrder);
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
    return [...this.orders.values()].filter(
      (o) => (!filter?.contractId || o.contractId === filter.contractId) && (!filter?.status || o.status === filter.status),
    );
  }
  async findVariationOrderById(id: string) {
    return this.orders.get(id) ?? null;
  }
  async findVariationOrderByDocNo(docNo: string) {
    return [...this.orders.values()].find((o) => o.docNo === docNo) ?? null;
  }
  async insertVariationOrder(order: VariationOrder) {
    insertOnly(this.orders, order.id, order);
  }
  async saveVariationOrder(order: VariationOrder) {
    this.orders.set(order.id, order);
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}

const counters = new Map<string, number>();
const sequences: SequenceStore = {
  async increment(code) {
    const next = (counters.get(code) ?? 0) + 1;
    counters.set(code, next);
    return next;
  },
};

const PREPARER: WorksContractActor = { userId: "u-estimator", wildcardAdmin: false };
const APPROVER: WorksContractActor = { userId: "u-contracts-admin", wildcardAdmin: false };
const ADMIN: WorksContractActor = { userId: "u-owner", wildcardAdmin: true };

let store: MemoryStore;
let service: WorksContractService;

function newService() {
  store = new MemoryStore();
  counters.clear();
  service = new WorksContractService({
    store,
    numbering: new NextNumberService(sequences),
    projects: { findById: async (id) => (id === "PRJ-1" ? ({ id } as never) : null) },
    customers: { findById: async (id) => (id === "CUST-1" ? ({ id } as never) : null) },
  });
}

const base = {
  id: "CTR-1",
  projectId: "PRJ-1",
  customerId: "CUST-1",
  titleAr: "عقد إنشاء",
  contractType: "private" as const,
  signedDate: "2026-02-15",
  startDate: "2026-03-01",
  plannedEndDate: "2027-02-28",
};

const BOQ = [
  { id: "CTR-1-B1", code: "1", descriptionAr: "حفر", unit: "m3", qty: "12000", unitRate: "185.00" },
  { id: "CTR-1-B2", code: "2", descriptionAr: "خرسانة", unit: "m3", qty: "1450", unitRate: "1980.00" },
];

async function activeContract() {
  await service.create(base);
  await service.putBoq("CTR-1", BOQ);
  await service.activate("CTR-1", "2026-03-01");
}

beforeEach(newService);

describe("contract defaults", () => {
  it("derives the VAT basis from the contract's own signature date (D-07)", () => {
    expect(defaultVatBasis("2025-07-17")).toBe("transitional");
    expect(defaultVatBasis("2025-07-18")).toBe("standard");
    expect(defaultVatBasis("2026-02-15")).toBe("standard");
  });

  it("gives a public contract the Law 182 payment clock and a final security, a private one neither", () => {
    expect(defaultWorksContractTerms("public", "2026-01-01").paymentTermDays).toBe(60);
    expect(defaultWorksContractTerms("public", "2026-01-01").finalSecurityPercent).toBe("5");
    expect(defaultWorksContractTerms("private", "2026-01-01").paymentTermDays).toBe(30);
    expect(defaultWorksContractTerms("private", "2026-01-01").finalSecurityPercent).toBe("0");
  });

  it("allocates the docNo off the CONTRACT sequence and starts the contract as a draft", async () => {
    const view = await service.create(base);
    expect(view.contract.docNo).toBe("CTR-0001");
    expect(view.contract.status).toBe("draft");
    expect(view.contract.withholdingTaxPercent).toBe("1");
    expect(view.contractValue.toString()).toBe("0.000000");
  });

  it("refuses a contract whose project or customer does not exist", async () => {
    await expect(service.create({ ...base, projectId: "PRJ-NOPE" })).rejects.toThrow(InvalidWorksContractError);
    await expect(service.create({ ...base, customerId: "CUST-NOPE" })).rejects.toThrow(InvalidWorksContractError);
  });
});

describe("التأمين النهائي — the Law 182/2018 gate", () => {
  const PUBLIC = { ...base, id: "CTR-P", contractType: "public" as const };
  const PUBLIC_BOQ = BOQ.map((l, i) => ({ ...l, id: `CTR-P-B${i + 1}` }));
  // 12,000 × 185 + 1,450 × 1,980 = 5,091,000; 5% of it is 254,550.
  const REQUIRED = "254550.000000";

  function withGuarantees(letters: readonly { id: string; docNo: string | null; currentValue: string; expiryDate: string }[]) {
    service = new WorksContractService({
      store,
      numbering: new NextNumberService(sequences),
      projects: { findById: async (id) => (id === "PRJ-1" ? ({ id } as never) : null) },
      customers: { findById: async (id) => (id === "CUST-1" ? ({ id } as never) : null) },
      guarantees: {
        listPerformanceGuarantees: async () =>
          letters.map((l) => ({ ...l, currentValue: Money.fromMajor(l.currentValue) })),
      },
    });
  }

  it("refuses activation when no performance bond covers the 5%, naming both figures in Arabic", async () => {
    withGuarantees([]);
    await service.create(PUBLIC);
    await service.putBoq("CTR-P", PUBLIC_BOQ);
    await expect(service.activate("CTR-P", "2026-03-01")).rejects.toThrow(
      /تأمين نهائي ناقص: المطلوب 254550\.00، القائم 0\.00/,
    );
  });

  it("refuses a bond that is SHORT of the requirement, and accepts one that covers it", async () => {
    withGuarantees([{ id: "LG-1", docNo: "LG-0001", currentValue: "200000", expiryDate: "2027-04-30" }]);
    await service.create(PUBLIC);
    await service.putBoq("CTR-P", PUBLIC_BOQ);
    await expect(service.activate("CTR-P", "2026-03-01")).rejects.toThrow(/تأمين نهائي ناقص/);

    withGuarantees([{ id: "LG-1", docNo: "LG-0001", currentValue: "254550", expiryDate: "2027-04-30" }]);
    const view = await service.activate("CTR-P", "2026-03-01");
    expect(view.contract.status).toBe("active");
    expect(view.finalSecurityStatus?.required.toString()).toBe(REQUIRED);
    expect(view.finalSecurityStatus?.covered.toString()).toBe(REQUIRED);
    expect(view.finalSecurityStatus?.shortfall.toString()).toBe("0.000000");
    expect(view.finalSecurityStatus?.guaranteeDocNo).toBe("LG-0001");
    expect(view.finalSecurityStatus?.expiryDate).toBe("2027-04-30");
  });

  it("leaves a PRIVATE contract alone — it retains cash and has no final-security status", async () => {
    withGuarantees([]);
    await service.create(base);
    await service.putBoq("CTR-1", BOQ);
    const view = await service.activate("CTR-1", "2026-03-01");
    expect(view.contract.status).toBe("active");
    expect(view.finalSecurityStatus).toBeNull();
  });
});

describe("the draft gate", () => {
  it("refuses to activate a contract with no BOQ line", async () => {
    await service.create(base);
    await expect(service.activate("CTR-1", "2026-03-01")).rejects.toThrow(
      /لا يمكن تفعيل عقد بلا بنود في جدول الكميات/,
    );
  });

  it("refuses a SECOND live works contract on a project that already has one", async () => {
    await activeContract();
    await service.create({ ...base, id: "CTR-2", titleAr: "عقد إنشاء ثانٍ" });
    await service.putBoq("CTR-2", [{ ...BOQ[0]!, id: "CTR-2-B1" }]);
    await expect(service.activate("CTR-2", "2026-04-01")).rejects.toThrow(
      /المشروع مرتبط بعقد سارٍ بالفعل \(CTR-0001\)/,
    );

    // A CLOSED contract frees the project again — several contracts per project
    // is the design, one LIVE contract per project is the invariant.
    await service.complete("CTR-1", "2026-03-31");
    const second = await service.activate("CTR-2", "2026-04-01");
    expect(second.contract.status).toBe("active");
  });

  it("refuses a BOQ edit once the contract is active, in Arabic", async () => {
    await activeContract();
    await expect(service.putBoq("CTR-1", BOQ)).rejects.toThrow(WorksContractNotDraftError);
    await expect(service.putBoq("CTR-1", BOQ)).rejects.toThrow(/التعديل يتم بأمر تغيير/);
  });

  it("refuses an import into an active contract", async () => {
    await activeContract();
    await expect(service.reviewImport("CTR-1", [])).rejects.toThrow(WorksContractNotDraftError);
  });

  it("freezes the commercial terms on activation but still allows the budget, end date and notes", async () => {
    await activeContract();
    await expect(service.update("CTR-1", { retentionPercent: "7" }, ADMIN)).rejects.toThrow(
      /الشروط التجارية تُجمَّد بتفعيل العقد/,
    );
    const updated = await service.update(
      "CTR-1",
      { estimatedTotalCost: "20300000", reason: "إعادة تقدير بعد أسعار الحديد", plannedEndDate: "2027-04-30" },
      ADMIN,
    );
    expect(updated.contract.estimatedTotalCost?.toString()).toBe("20300000.000000");
    expect(updated.contract.plannedEndDate).toBe("2027-04-30");
    expect(updated.contract.budgetRevisions).toHaveLength(1);
    expect(updated.contract.budgetRevisions[0]?.reason).toBe("إعادة تقدير بعد أسعار الحديد");
    expect(updated.contract.budgetRevisions[0]?.userId).toBe("u-owner");
  });

  it("refuses a budget change with no reason", async () => {
    await activeContract();
    await expect(service.update("CTR-1", { estimatedTotalCost: "999" }, ADMIN)).rejects.toThrow(
      /تغيير التكلفة التقديرية يتطلب ذكر السبب/,
    );
  });

  it("refuses a duplicate BOQ code inside one submission", async () => {
    await service.create(base);
    await expect(
      service.putBoq("CTR-1", [...BOQ, { ...BOQ[0]!, id: "CTR-1-B3" }]),
    ).rejects.toThrow(/كود البند "1" مكرر/);
  });
});

describe("variation orders", () => {
  async function draftOrder(lines: Parameters<typeof service.createVariationOrder>[0]["lines"]) {
    return service.createVariationOrder(
      {
        id: "VO-1",
        contractId: "CTR-1",
        date: "2026-05-28",
        titleAr: "أمر تغيير",
        reason: "سبب",
        requestedBy: "employer",
        lines,
      },
      PREPARER,
    );
  }

  it("refuses a variation order on a contract that is still a draft", async () => {
    await service.create(base);
    await service.putBoq("CTR-1", BOQ);
    await expect(draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }])).rejects.toThrow(
      /لا يمكن إصدار أمر تغيير إلا على عقد ساري/,
    );
  });

  it("refuses a change line that names no BOQ line the contract holds", async () => {
    await activeContract();
    await expect(draftOrder([{ kind: "change", boqLineId: "NOPE", qtyDelta: "1" }])).rejects.toThrow(
      /البند "NOPE" غير موجود في جدول الكميات/,
    );
  });

  it("refuses approval by the person who prepared it, and allows the wildcard admin", async () => {
    await activeContract();
    await draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }]);
    await expect(service.approveVariationOrder("VO-1", "2026-08-02", PREPARER)).rejects.toThrow(SelfApprovalError);
    // A single-operator install has nobody else; `"*"` is exempt on purpose.
    const adminSelf = { userId: PREPARER.userId, wildcardAdmin: true };
    const approved = await service.approveVariationOrder("VO-1", "2026-08-02", adminSelf);
    expect(approved.order.status).toBe("approved");
  });

  /**
   * `approvedAt` is what every quantity ceiling and the «أوامر تغيير متأخرة
   * الاعتماد» exception are measured from. Backdating it to before the order
   * existed reopened every ceiling retroactively AND hid the late approval
   * from the report that exists to catch it.
   */
  it("refuses an approval dated before the variation order itself", async () => {
    await activeContract();
    await draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }]);
    await expect(service.approveVariationOrder("VO-1", "2024-01-01", APPROVER)).rejects.toThrow(
      /لا يجوز أن يسبق تاريخ أمر التغيير/,
    );
  });

  it("refuses an approval dated in the future", async () => {
    await activeContract();
    await draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }]);
    await expect(service.approveVariationOrder("VO-1", "2099-01-01", APPROVER)).rejects.toThrow(
      /لا يجوز أن يكون في المستقبل/,
    );
  });

  it("adds an `add` line to the BOQ with origin variation, and records a `change` as a dated adjustment", async () => {
    await activeContract();
    await draftOrder([
      {
        kind: "add",
        newLine: { code: "7", descriptionAr: "حديد التسليح", unit: "ton", qty: "210", unitRate: "46500.00" },
      },
      { kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" },
    ]);
    const approved = await service.approveVariationOrder("VO-1", "2026-08-02", APPROVER);
    expect(approved.order.approvedBy).toBe("u-contracts-admin");
    expect(approved.netValue.toString()).toBe("9876000.000000");

    const lines = await service.listBoq("CTR-1");
    const added = lines.find((l) => l.code === "7");
    expect(added?.origin).toBe("variation");
    expect(added?.variationOrderId).toBe("VO-1");
    // The base line's own quantity is never rewritten — the adjustment carries the delta.
    expect(lines.find((l) => l.code === "1")?.qty.toString()).toBe("12000.000000");
    expect(store.adjustments).toHaveLength(1);
    expect(store.adjustments[0]?.approvedAt).toBe("2026-08-02");

    const before = await service.contractedQuantities("CTR-1", "2026-07-01");
    expect(before.find((r) => r.code === "1")?.contractedQty.toString()).toBe("12000.000000");
    const after = await service.contractedQuantities("CTR-1", "2026-08-02");
    expect(after.find((r) => r.code === "1")?.contractedQty.toString()).toBe("12600.000000");
  });

  it("counts an approved variation in the contract value, a draft one not at all", async () => {
    await activeContract();
    await draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }]);
    expect((await service.get("CTR-1")).contractValueAfterVariations.toString()).toBe("5091000.000000");
    await service.approveVariationOrder("VO-1", "2026-08-02", APPROVER);
    expect((await service.get("CTR-1")).contractValueAfterVariations.toString()).toBe("5202000.000000");
  });

  it("refuses to edit or re-approve an order that is no longer a draft", async () => {
    await activeContract();
    await draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }]);
    await service.approveVariationOrder("VO-1", "2026-08-02", APPROVER);
    await expect(service.updateVariationOrder("VO-1", { titleAr: "آخر" })).rejects.toThrow(/لا يمكن تعديل أمر تغيير/);
    await expect(service.approveVariationOrder("VO-1", "2026-08-03", APPROVER)).rejects.toThrow(/لم يعد مسودة/);
  });

  it("rejects an order with a reason and leaves the BOQ untouched", async () => {
    await activeContract();
    await draftOrder([{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }]);
    const rejected = await service.rejectVariationOrder("VO-1", "خارج نطاق العقد", APPROVER);
    expect(rejected.order.status).toBe("rejected");
    expect(rejected.order.rejectedReason).toBe("خارج نطاق العقد");
    expect(store.adjustments).toHaveLength(0);
  });
});

describe("completion", () => {
  it("asks the completion guard slice 2 plugs in, and surfaces its Arabic refusal", async () => {
    await activeContract();
    const guarded = new WorksContractService({
      store,
      numbering: new NextNumberService(sequences),
      projects: { findById: async (id) => ({ id }) as never },
      customers: { findById: async (id) => ({ id }) as never },
      completionGuard: async () => "لا يمكن إنهاء العقد قبل اعتماد المستخلص الختامي",
    });
    expect((await guarded.get("CTR-1")).canComplete).toBe(false);
    await expect(guarded.complete("CTR-1", "2026-12-31")).rejects.toThrow(
      /لا يمكن إنهاء العقد قبل اعتماد المستخلص الختامي/,
    );
    await expect(service.complete("CTR-1", "2026-12-31")).resolves.toMatchObject({
      contract: { status: "completed", completedAt: "2026-12-31" },
    });
  });
});
