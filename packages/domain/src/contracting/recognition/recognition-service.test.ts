import { beforeEach, describe, expect, it } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { Account } from "../../accounts/account.js";
import { InMemoryAccountRepository } from "../../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { InMemoryProjectRepository } from "../../projects/test-helpers/in-memory-project-repository.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../../gl/test-helpers/in-memory-ledger-repository.js";
import { NextNumberService } from "../../numbering/index.js";
import { postJournalEntry } from "../../gl/index.js";
import type { PostedLine, PostedLineFilter } from "../../gl/ledger.js";
import type { CostCategory } from "../cost-category.js";
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
import { InMemoryRecognitionRunRepository } from "./test-helpers/in-memory-recognition-run-repository.js";
import { RecognitionService } from "./recognition-service.js";
import {
  InvalidRecognitionRunError,
  RecognitionPreviousPeriodMissingError,
  RecognitionRunAlreadyPostedError,
  RecognitionRunNotLatestError,
} from "./errors.js";

class MemoryContractStore implements WorksContractStore {
  contracts = new Map<string, WorksContract>();
  boq: BoqLine[] = [];
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
  async listAdjustments(): Promise<BoqLineAdjustment[]> {
    return [];
  }
  async addAdjustments() {}
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

function account(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"] = "debit"): Account {
  return { id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

/** The posted-lines view the real SQLite ledger exposes, derived from the in-memory entries. */
function listLinesFrom(ledger: InMemoryLedgerRepository) {
  return async (filter?: PostedLineFilter): Promise<readonly PostedLine[]> => {
    const entries = await ledger.list({});
    const rows: PostedLine[] = [];
    for (const entry of entries) {
      if (entry.status !== "posted") continue;
      if (filter?.toDate && entry.date > filter.toDate) continue;
      if (filter?.fromDate && entry.date < filter.fromDate) continue;
      for (const line of entry.lines) {
        if (filter?.projectId && line.projectId !== filter.projectId) continue;
        if (filter?.accountIds && !filter.accountIds.includes(line.accountId)) continue;
        rows.push({
          entryId: entry.id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          source: entry.source ?? "system",
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
    return rows;
  };
}

interface Harness {
  service: RecognitionService;
  ledger: InMemoryLedgerRepository;
  store: MemoryContractStore;
  runs: InMemoryRecognitionRunRepository;
  capitalise(date: string, amount: string, costCategory: CostCategory | null): Promise<void>;
  certify(date: string, amount: string): Promise<void>;
  net(accountId: string): Promise<string>;
}

async function harness(
  options: { recognitionPolicy?: "cost_to_cost" | "certified_value"; estimatedTotalCost?: string | null; contractRate?: string } = {},
): Promise<Harness> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const projects = new InMemoryProjectRepository();
  const store = new MemoryContractStore();
  const runs = new InMemoryRecognitionRunRepository();

  for (const [id, type, natural] of [
    ["1130", "asset", "debit"],
    ["1170", "asset", "debit"],
    ["1200", "asset", "debit"],
    ["1230", "asset", "debit"],
    ["2165", "liability", "credit"],
    ["2175", "liability", "credit"],
    ["2196", "liability", "credit"],
    ["4150", "revenue", "credit"],
    ["5150", "expense", "debit"],
    ["5930", "expense", "debit"],
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

  await projects.create({
    id: "PRJ-1",
    code: "TOWER",
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
    costCenterId: "cc-prj-1",
  });

  const terms = defaultWorksContractTerms("private", "2026-01-15");
  store.contracts.set("CTR-1", {
    ...terms,
    recognitionPolicy: options.recognitionPolicy ?? "cost_to_cost",
    id: "CTR-1",
    docNo: "CTR-0001",
    projectId: "PRJ-1",
    customerId: "CUST-1",
    titleAr: "عقد إنشاء برج الأمل",
    titleEn: null,
    contractType: "private",
    signedDate: "2026-01-15",
    startDate: "2026-02-01",
    plannedEndDate: "2026-12-31",
    currency: "EGP",
    status: "active",
    activatedAt: "2026-02-01",
    completedAt: null,
    terminatedAt: null,
    notes: null,
    estimatedTotalCost:
      options.estimatedTotalCost === null ? null : Money.fromMajor(options.estimatedTotalCost ?? "800000"),
    budgetRevisions: [],
    provisionalHandoverDate: null,
    finalHandoverDate: null,
  });
  store.boq.push({
    id: "B1",
    contractId: "CTR-1",
    code: "1",
    descriptionAr: "الخرسانة المسلحة",
    descriptionEn: null,
    unit: "m3",
    qty: Qty.fromMajor("1000"),
    unitRate: Money.fromMajor(options.contractRate ?? "1000"),
    estimatedUnitCost: null,
    section: null,
    sortOrder: 0,
    origin: "base",
    variationOrderId: null,
    costCategory: "materials",
    theoreticalQtyPerUnit: null,
    theoreticalItemId: null,
  });

  const gl = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    projects,
    now: () => "2026-09-13T09:00:00.000Z",
  };

  const service = new RecognitionService({
    runs,
    contracts: store,
    accounts,
    ledger: { listLines: listLinesFrom(ledger) },
    gl,
    today: () => "2026-09-13",
    now: () => "2026-09-13T09:00:00.000Z",
  });

  let seq = 0;
  const capitalise = async (date: string, amount: string, costCategory: CostCategory | null): Promise<void> => {
    seq += 1;
    await postJournalEntry(
      {
        id: `WIP-${seq}`,
        date,
        memo: "استهلاك مواد",
        source: "system",
        lines: [
          { accountId: "1230", debit: Money.fromMajor(amount), credit: Money.zero(), projectId: "PRJ-1", costCategory },
          { accountId: "1200", debit: Money.zero(), credit: Money.fromMajor(amount), projectId: "PRJ-1" },
        ],
      },
      gl,
    );
  };
  const certify = async (date: string, amount: string): Promise<void> => {
    seq += 1;
    await postJournalEntry(
      {
        id: `MST-${seq}`,
        date,
        memo: "مستخلص",
        source: "system",
        lines: [
          { accountId: "1130", debit: Money.fromMajor(amount), credit: Money.zero(), projectId: "PRJ-1" },
          { accountId: "2165", debit: Money.zero(), credit: Money.fromMajor(amount), projectId: "PRJ-1" },
        ],
      },
      gl,
    );
  };
  const net = async (accountId: string): Promise<string> => {
    const lines = await listLinesFrom(ledger)({ projectId: "PRJ-1" });
    return Money.fromScaled(
      lines.filter((l) => l.accountId === accountId).reduce((acc, l) => acc + l.debit.scaled - l.credit.scaled, 0n),
    ).toString();
  };

  return { service, ledger, store, runs, capitalise, certify, net };
}

/** Every posted entry balances on its own — a half-posted month is not a thing. */
async function expectEveryEntryBalanced(ledger: InMemoryLedgerRepository): Promise<void> {
  for (const entry of await ledger.list({})) {
    const debit = entry.lines.reduce((acc, l) => acc + l.debit.scaled, 0n);
    const credit = entry.lines.reduce((acc, l) => acc + l.credit.scaled, 0n);
    expect(debit).toBe(credit);
  }
}

describe("RecognitionService.post", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("relieves the whole WIP balance, so the closing balance reads zero", async () => {
    await h.capitalise("2026-04-12", "120000", "materials");
    await h.capitalise("2026-05-20", "80000", "labour");

    const run = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31", postedBy: "u-accountant" });

    expect(run.docNo).toBe("RR-000001");
    expect(run.wipOpening.toString()).toBe("120000.000000");
    expect(run.wipIncurred.toString()).toBe("80000.000000");
    expect(run.wipRelieved.toString()).toBe("200000.000000");
    expect(run.wipClosing.toString()).toBe("0.000000");
    expect(await h.net("1230")).toBe("0.000000");
    expect(await h.net("5150")).toBe("200000.000000");
    await expectEveryEntryBalanced(h.ledger);
  });

  it("credits contracting revenue with the percentage of completion and holds the difference as a contract asset", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    await h.certify("2026-05-20", "100000");

    const run = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });

    expect(run.percentComplete).toBe("25.0000");
    expect(run.revenueToDate.toString()).toBe("250000.000000");
    expect(run.periodRevenue.toString()).toBe("250000.000000");
    expect(run.billedToDate.toString()).toBe("100000.000000");
    expect(run.contractAsset.toString()).toBe("150000.000000");
    expect(await h.net("4150")).toBe("-250000.000000");
    // 2165 nets to zero: the certificate's credit has been reclassified into 1170.
    expect(await h.net("2165")).toBe("0.000000");
    // 1170 holds the revenue recognised less the billings reclassified into it.
    expect(await h.net("1170")).toBe("150000.000000");
  });

  it("keeps the cost to date after a relief, so next month's percentage does not collapse", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    await h.capitalise("2026-06-10", "200000", "materials");

    const june = await h.service.preview("CTR-1", "2026-06-30");
    expect(june.costToDate.toString()).toBe("400000.000000");
    expect(june.percentComplete).toBe("50.0000");
    expect(june.periodRevenue.toString()).toBe("250000.000000");
  });

  it("moves an over-billed position into the contract liability and releases it when revenue catches up", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    await h.certify("2026-05-20", "400000");
    const may = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    expect(may.contractLiability.toString()).toBe("150000.000000");
    expect(await h.net("2175")).toBe("-150000.000000");
    expect(await h.net("1170")).toBe("0.000000");

    await h.capitalise("2026-06-10", "400000", "materials");
    const june = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-06-30" });
    expect(june.contractAsset.toString()).toBe("350000.000000");
    expect(june.contractLiability.toString()).toBe("0.000000");
    expect(await h.net("2175")).toBe("0.000000");
    expect(await h.net("1170")).toBe("350000.000000");
    await expectEveryEntryBalanced(h.ledger);
  });

  it("reports a closed month with the figures that month POSTED, not a fresh recomputation", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    await h.certify("2026-05-20", "100000");
    const may = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });

    // The run itself relieved the WIP and reclassified the billings, so
    // recomputing May would now report zero billed and zero cost in WIP.
    const preview = await h.service.preview("CTR-1", "2026-05-31");
    expect(preview.billedToDate.toString()).toBe(may.billedToDate.toString());
    expect(preview.wipRelieved.toString()).toBe(may.wipRelieved.toString());
    expect(preview.contractAsset.toString()).toBe(may.contractAsset.toString());
    expect(preview.due).toBe(false);
    expect(preview.existingRunDocNo).toBe(may.docNo);
    // Nothing has moved since, so the recomputation agrees with what was posted.
    expect(preview.divergent).toBe(false);
    expect(preview.recomputed?.wipClosing.toString()).toBe("0.000000");
  });

  it("flags a closed month whose ledger has moved since, and the next run clears it", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    const may = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    expect(may.wipClosing.toString()).toBe("0.000000");

    // A cost confirmed AFTER May was run, dated inside May. It cannot change
    // the posted entry, and the posted run still reads a closing balance of
    // zero — the divergence is the only thing that says otherwise.
    await h.capitalise("2026-05-20", "18000", "equipment");
    const preview = await h.service.preview("CTR-1", "2026-05-31");
    expect(preview.wipClosing.toString()).toBe("0.000000");
    expect(preview.divergent).toBe(true);
    // 1230 still holds the stranded 18,000 (May's run relieved 200,000 into
    // 5150), and the cost to date is the two together.
    expect(preview.recomputed?.wipRelieved.toString()).toBe("18000.000000");
    expect(preview.recomputed?.costToDate.toString()).toBe("218000.000000");

    // June takes the whole 1230 BALANCE, not June's own movement, so the
    // stranded 18,000 is relieved rather than sitting in WIP for ever.
    const june = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-06-30" });
    expect(june.wipOpening.toString()).toBe("18000.000000");
    expect(june.wipRelieved.toString()).toBe("18000.000000");
    expect(june.wipClosing.toString()).toBe("0.000000");
    expect(await h.net("1230")).toBe("0.000000");
  });

  it("refuses a second run for a period it has already run", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    await expect(h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" })).rejects.toBeInstanceOf(
      RecognitionRunAlreadyPostedError,
    );
  });

  it("refuses a month whose predecessor has not been run, but never the contract's first run", async () => {
    await h.capitalise("2026-05-12", "200000", "materials");
    // The first run may start in any month — there is nothing before it.
    await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    await expect(h.service.post({ contractId: "CTR-1", periodEnd: "2026-07-31" })).rejects.toBeInstanceOf(
      RecognitionPreviousPeriodMissingError,
    );
    await h.service.post({ contractId: "CTR-1", periodEnd: "2026-06-30" });
    await expect(h.service.post({ contractId: "CTR-1", periodEnd: "2026-07-31" })).resolves.toBeDefined();
  });

  it("refuses any date that is not a month end", async () => {
    await expect(h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-15" })).rejects.toBeInstanceOf(
      InvalidRecognitionRunError,
    );
  });
});

describe("RecognitionService — the onerous contract", () => {
  it("provides for the foreseeable loss the month it appears and releases it when the contract recovers", async () => {
    const h = await harness({ estimatedTotalCost: "1200000" });
    await h.capitalise("2026-05-12", "300000", "materials");

    const may = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    expect(may.foreseeableLoss.toString()).toBe("200000.000000");
    expect(may.provisionRequired.toString()).toBe("150000.000000");
    expect(await h.net("2196")).toBe("-150000.000000");
    expect(await h.net("5930")).toBe("150000.000000");

    // A variation order lifts the contract value above the forecast cost.
    h.store.orders.set("VO-1", {
      id: "VO-1",
      docNo: "VO-0001",
      contractId: "CTR-1",
      date: "2026-06-01",
      titleAr: "أعمال إضافية",
      reason: "توسعة النطاق",
      requestedBy: "employer",
      status: "approved",
      approvedAt: "2026-06-10",
      approvedBy: "u1",
      rejectedReason: null,
      createdBy: null,
      lines: [
        {
          id: "VOL-1",
          variationOrderId: "VO-1",
          kind: "change",
          boqLineId: "B1",
          newLine: null,
          qtyDelta: Qty.fromMajor("400"),
          unitRateOverride: null,
          sortOrder: 0,
        },
      ],
    });

    const june = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-06-30" });
    expect(june.contractValue.toString()).toBe("1400000.000000");
    expect(june.foreseeableLoss.toString()).toBe("0.000000");
    expect(june.provisionMovement.toString()).toBe("-150000.000000");
    expect(await h.net("2196")).toBe("0.000000");
    await expectEveryEntryBalanced(h.ledger);
  });
});

describe("RecognitionService — certified value contracts", () => {
  it("posts no revenue and no billings reclass, only the WIP relief", async () => {
    const h = await harness({ recognitionPolicy: "certified_value" });
    await h.capitalise("2026-05-12", "200000", "materials");
    await h.certify("2026-05-20", "100000");

    const run = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    expect(run.periodRevenue.toString()).toBe("0.000000");
    expect(run.wipRelieved.toString()).toBe("200000.000000");
    expect(await h.net("4150")).toBe("0.000000");
    expect(await h.net("2165")).toBe("-100000.000000");
    expect(await h.net("1230")).toBe("0.000000");
  });
});

describe("RecognitionService — refusals and reversal", () => {
  it("refuses to recognise without an estimate of the total cost", async () => {
    const h = await harness({ estimatedTotalCost: null });
    await h.capitalise("2026-05-12", "200000", "materials");
    await expect(h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" })).rejects.toThrow(
      "لا يمكن الاعتراف بالإيراد دون تقدير التكلفة الكلية",
    );
    const preview = await h.service.preview("CTR-1", "2026-05-31");
    expect(preview.due).toBe(false);
    expect(preview.blockedReasonAr).toBe("لا يمكن الاعتراف بالإيراد دون تقدير التكلفة الكلية.");
  });

  it("reverses only the latest run, and the mirror entry takes the ledger back where it was", async () => {
    const h = await harness();
    await h.capitalise("2026-05-12", "200000", "materials");
    const may = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-05-31" });
    await h.capitalise("2026-06-10", "100000", "materials");
    const june = await h.service.post({ contractId: "CTR-1", periodEnd: "2026-06-30" });

    await expect(h.service.reverse(may.id)).rejects.toBeInstanceOf(RecognitionRunNotLatestError);

    const reversed = await h.service.reverse(june.id, { reversedBy: "u-accountant" });
    expect(reversed.status).toBe("reversed");
    expect(reversed.reversalJournalEntryId).not.toBeNull();
    // June's relief and its revenue are back out: 1230 carries June's cost again.
    expect(await h.net("1230")).toBe("100000.000000");
    expect(await h.net("4150")).toBe("-250000.000000");
    await expectEveryEntryBalanced(h.ledger);

    // With June reversed, May is the latest run again and may now be reversed.
    await expect(h.service.reverse(may.id)).resolves.toBeDefined();
    expect(await h.net("4150")).toBe("0.000000");
    expect(await h.net("1230")).toBe("300000.000000");
  });
});
