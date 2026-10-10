import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import type { JournalPostingDeps } from "../gl/index.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
  RecordingAuditSink,
  RecordingGlEventPublisher,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import type { Asset } from "./asset.js";
import type { AssetCategory } from "./asset-category.js";
import { postDepreciationRun, type PostDepreciationRunDeps } from "./post-depreciation-run.js";
import { DepreciationRunNotDraftError } from "./errors.js";
import {
  createInMemoryAssetCategoryRepository,
  createInMemoryAssetRepository,
  createInMemoryDepreciationRunRepository,
} from "./test-helpers/in-memory-fixed-assets-repositories.js";

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

function category(overrides: Partial<AssetCategory> = {}): AssetCategory {
  return {
    id: "cat-1",
    code: "VEHICLES",
    nameAr: "سيارات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 12,
    defaultSalvagePercent: 0,
    assetAccountId: null,
    depreciationExpenseAccountId: "5400-1",
    accumulatedDepreciationAccountId: "1590-1",
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: true,
    ...overrides,
  };
}

function asset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    categoryId: "cat-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2025-01-01",
    acquisitionCost: Money.fromMajor("12000.00"),
    depreciationStartDate: "2025-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 12,
    salvageValue: Money.zero(),
    accumulatedDepreciation: Money.zero(),
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
    projectId: null,
    internalHourlyRate: null,
    ...overrides,
  };
}

interface Harness {
  deps: PostDepreciationRunDeps;
  gl: JournalPostingDeps;
  ledger: InMemoryLedgerRepository;
  assets: ReturnType<typeof createInMemoryAssetRepository>;
  categories: ReturnType<typeof createInMemoryAssetCategoryRepository>;
  runs: ReturnType<typeof createInMemoryDepreciationRunRepository>;
}

async function harness(): Promise<Harness> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const audit = new RecordingAuditSink();
  const events = new RecordingGlEventPublisher();

  await accounts.create(account("5400-1", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1590-1", { type: "asset", naturalBalance: "credit" }));
  await accounts.create(account("5401", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1591", { type: "asset", naturalBalance: "credit" }));
  await accounts.create(account("5499", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1599", { type: "asset", naturalBalance: "credit" }));
  await periods.create({
    id: "fp-2026-03",
    year: 2026,
    periodNumber: 3,
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    status: "open",
  });

  const gl: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    audit,
    events,
    now: () => "2026-03-31T10:00:00.000Z",
    actor: "u1",
  };

  const assets = createInMemoryAssetRepository();
  const categories = createInMemoryAssetCategoryRepository();
  const runs = createInMemoryDepreciationRunRepository();

  const deps: PostDepreciationRunDeps = {
    runs,
    assets,
    categories,
    gl,
    now: () => "2026-03-31T12:00:00.000Z",
    defaultAccounts: {
      depreciationExpenseAccountId: "5499",
      accumulatedDepreciationAccountId: "1599",
    },
  };

  return { deps, gl, ledger, assets, categories, runs };
}

describe("postDepreciationRun", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
    await h.categories.create(category());
    // a1, a3 fall back to the category's accounts (same pair); a2 has its own override (a distinct pair)
    // and is set up to cross its depreciable base this run.
    await h.assets.create(
      asset("a1", {
        acquisitionCost: Money.fromMajor("12000.00"),
        usefulLifeMonths: 12,
        accumulatedDepreciation: Money.fromMajor("2000.00"),
      }),
    );
    await h.assets.create(
      asset("a3", {
        acquisitionCost: Money.fromMajor("6000.00"),
        usefulLifeMonths: 12,
        accumulatedDepreciation: Money.zero(),
      }),
    );
    await h.assets.create(
      asset("a2", {
        acquisitionCost: Money.fromMajor("3600.00"),
        usefulLifeMonths: 12,
        accumulatedDepreciation: Money.fromMajor("3300.00"),
        depreciationExpenseAccountId: "5401",
        accumulatedDepreciationAccountId: "1591",
      }),
    );
    await h.runs.create({
      id: "run-1",
      period: "2026-03",
      branchId: null,
      status: "draft",
      lines: [
        { assetId: "a1", amount: Money.fromMajor("1000.00") },
        { assetId: "a3", amount: Money.fromMajor("500.00") },
        { assetId: "a2", amount: Money.fromMajor("300.00") },
      ],
      totalAmount: Money.fromMajor("1800.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });
  });

  it("posts a balanced journal entry grouped by resolved account pair, Dr expense / Cr accumulated depreciation", async () => {
    const posted = await postDepreciationRun("run-1", h.deps);

    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).toBe("DEP-JE:run-1");
    expect(posted.postedAt).toBe("2026-03-31T12:00:00.000Z");

    const entry = await h.ledger.findById("DEP-JE:run-1");
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("posted");
    expect(entry!.source).toBe("system");
    expect(entry!.date).toBe("2026-03-31");

    const totalDebit = entry!.lines.reduce((acc, l) => acc.add(l.debit), Money.zero());
    const totalCredit = entry!.lines.reduce((acc, l) => acc.add(l.credit), Money.zero());
    expect(totalDebit.equals(totalCredit)).toBe(true);
    expect(totalDebit.toString()).toBe("1800.000000");

    expect(entry!.lines).toHaveLength(4);
    const line5400 = entry!.lines.find((l) => l.accountId === "5400-1");
    const line1590 = entry!.lines.find((l) => l.accountId === "1590-1");
    const line5401 = entry!.lines.find((l) => l.accountId === "5401");
    const line1591 = entry!.lines.find((l) => l.accountId === "1591");

    expect(line5400!.debit.toString()).toBe("1500.000000");
    expect(line5400!.credit.scaled).toBe(0n);
    expect(line1590!.credit.toString()).toBe("1500.000000");
    expect(line1590!.debit.scaled).toBe(0n);
    expect(line5401!.debit.toString()).toBe("300.000000");
    expect(line1591!.credit.toString()).toBe("300.000000");
  });

  it("updates each asset's accumulatedDepreciation by exactly its line amount", async () => {
    await postDepreciationRun("run-1", h.deps);

    const a1 = await h.assets.findById("a1");
    const a3 = await h.assets.findById("a3");
    expect(a1!.accumulatedDepreciation.toString()).toBe("3000.000000");
    expect(a3!.accumulatedDepreciation.toString()).toBe("500.000000");
  });

  it("flips an asset to fully_depreciated when it reaches its depreciable base", async () => {
    await postDepreciationRun("run-1", h.deps);

    const a1 = await h.assets.findById("a1");
    const a2 = await h.assets.findById("a2");
    expect(a1!.status).toBe("active");
    expect(a2!.status).toBe("fully_depreciated");
    expect(a2!.accumulatedDepreciation.toString()).toBe("3600.000000");
  });

  it("resolves to the deps.defaultAccounts fallback when neither the asset nor its category has an override", async () => {
    await h.categories.create(
      category({ id: "cat-2", code: "UNCONFIGURED", depreciationExpenseAccountId: null, accumulatedDepreciationAccountId: null }),
    );
    await h.assets.create(
      asset("a4", {
        categoryId: "cat-2",
        acquisitionCost: Money.fromMajor("1200.00"),
        usefulLifeMonths: 12,
      }),
    );
    await h.runs.create({
      id: "run-2",
      period: "2026-03",
      branchId: null,
      status: "draft",
      lines: [{ assetId: "a4", amount: Money.fromMajor("100.00") }],
      totalAmount: Money.fromMajor("100.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });

    await postDepreciationRun("run-2", h.deps);

    const entry = await h.ledger.findById("DEP-JE:run-2");
    expect(entry!.lines.find((l) => l.accountId === "5499")!.debit.toString()).toBe("100.000000");
    expect(entry!.lines.find((l) => l.accountId === "1599")!.credit.toString()).toBe("100.000000");
  });

  it("posts a project-assigned asset's expense line with its projectId and costCategory equipment, and the credit line with projectId only", async () => {
    await h.assets.create(
      asset("a5", {
        acquisitionCost: Money.fromMajor("1200.00"),
        usefulLifeMonths: 12,
        projectId: "proj-1",
      }),
    );
    await h.runs.create({
      id: "run-3",
      period: "2026-03",
      branchId: null,
      status: "draft",
      lines: [{ assetId: "a5", amount: Money.fromMajor("100.00"), projectId: "proj-1", costCategory: "equipment" }],
      totalAmount: Money.fromMajor("100.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });

    await postDepreciationRun("run-3", h.deps);

    const entry = await h.ledger.findById("DEP-JE:run-3");
    const expenseLine = entry!.lines.find((l) => l.accountId === "5400-1");
    const accumulatedLine = entry!.lines.find((l) => l.accountId === "1590-1");
    expect(expenseLine!.projectId).toBe("proj-1");
    expect(expenseLine!.costCategory).toBe("equipment");
    expect(accumulatedLine!.projectId).toBe("proj-1");
    expect(accumulatedLine!.costCategory ?? null).toBeNull();
  });

  it("rejects posting a non-draft run", async () => {
    await postDepreciationRun("run-1", h.deps);
    await expect(postDepreciationRun("run-1", h.deps)).rejects.toBeInstanceOf(DepreciationRunNotDraftError);
  });
});

/**
 * guards B-9 — the GL entry and every asset write went out one at a time with
 * nothing around them, and the memo was English in an Arabic-first product.
 */
describe("postDepreciationRun — atomicity and the Arabic memo", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
    await h.categories.create(category());
    await h.assets.create(asset("a1", { accumulatedDepreciation: Money.zero() }));
    await h.runs.create({
      id: "run-tx",
      period: "2026-03",
      branchId: null,
      status: "draft",
      lines: [{ assetId: "a1", amount: Money.fromMajor("1000.00") }],
      totalAmount: Money.fromMajor("1000.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });
  });

  it("writes the entry, the asset and the run inside ONE transaction", async () => {
    let depth = 0;
    const openTransaction = h.ledger.transaction.bind(h.ledger);
    h.ledger.transaction = async <T,>(fn: () => Promise<T>): Promise<T> => {
      depth += 1;
      try {
        return await openTransaction(fn);
      } finally {
        depth -= 1;
      }
    };

    const seen: Record<string, number> = {};
    const saveEntry = h.ledger.save.bind(h.ledger);
    h.ledger.save = async (entry) => {
      seen.entry = depth;
      return saveEntry(entry);
    };
    const updateAsset = h.assets.update.bind(h.assets);
    h.assets.update = async (a) => {
      seen.asset = depth;
      return updateAsset(a);
    };
    const updateRun = h.runs.update.bind(h.runs);
    h.runs.update = async (r) => {
      seen.run = depth;
      return updateRun(r);
    };

    await postDepreciationRun("run-tx", h.deps);

    expect(seen.entry, "the journal entry").toBeGreaterThan(0);
    expect(seen.asset, "the asset write").toBeGreaterThan(0);
    expect(seen.run, "the run status").toBeGreaterThan(0);
  });

  it("memos the entry in Arabic", async () => {
    await postDepreciationRun("run-tx", h.deps);
    expect((await h.ledger.findById("DEP-JE:run-tx"))!.memo).toBe("إهلاك الفترة 2026-03");
  });
});

describe("postDepreciationRun — the branch dimension (D111)", () => {
  it("buckets depreciation by the asset's own branch, a warehouse asset by its warehouse's branch, and leaves a company asset unattributed", async () => {
    const h = await harness();
    await h.categories.create(category());
    await h.assets.create(asset("b1", { scope: "branch", branchId: "BR-ALEX" }));
    await h.assets.create(asset("b2", { scope: "branch", branchId: "BR-ALEX" }));
    await h.assets.create(asset("g1"));
    await h.assets.create(asset("w1", { scope: "warehouse", warehouseId: "WH-GIZA" }));
    await h.runs.create({
      id: "run-br",
      period: "2026-03",
      branchId: null,
      status: "draft",
      lines: [
        { assetId: "b1", amount: Money.fromMajor("100.00") },
        { assetId: "b2", amount: Money.fromMajor("50.00") },
        { assetId: "g1", amount: Money.fromMajor("70.00") },
        { assetId: "w1", amount: Money.fromMajor("30.00") },
      ],
      totalAmount: Money.fromMajor("250.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });
    await postDepreciationRun("run-br", {
      ...h.deps,
      warehouses: { findById: async (id) => (id === "WH-GIZA" ? { branchId: "BR-GIZA" } : null) },
    });
    const entry = await h.ledger.findById("DEP-JE:run-br");
    expect(entry!.lines.map((l) => [l.accountId, l.branchId ?? null, l.debit.toString(), l.credit.toString()])).toEqual([
      ["5400-1", "BR-ALEX", "150.000000", "0.000000"],
      ["1590-1", "BR-ALEX", "0.000000", "150.000000"],
      ["5400-1", null, "70.000000", "0.000000"],
      ["1590-1", null, "0.000000", "70.000000"],
      ["5400-1", "BR-GIZA", "30.000000", "0.000000"],
      ["1590-1", "BR-GIZA", "0.000000", "30.000000"],
    ]);
  });
});
