import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { PeriodNotOpenForPostingError } from "../fiscal-periods/errors.js";
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
import { reverseDepreciationRun } from "./reverse-depreciation-run.js";
import { DepreciationRunNotPostedError } from "./errors.js";
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
    projectId: null,
    internalHourlyRate: null,
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
    ...overrides,
  };
}

interface Harness {
  deps: PostDepreciationRunDeps;
  gl: JournalPostingDeps;
  ledger: InMemoryLedgerRepository;
  periods: InMemoryFiscalPeriodRepository;
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

  return { deps, gl, ledger, assets, categories, runs, periods };
}

/**
 * guards B-9 — a posted depreciation run could not be undone at all, so a
 * wrong month stayed in the books forever.
 */
describe("reverseDepreciationRun", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
    await h.categories.create(category());
    // a1 depreciates normally; a2 is one month from its base, so posting the
    // run flips it to fully_depreciated and the reversal must flip it back.
    await h.assets.create(asset("a1", { accumulatedDepreciation: Money.fromMajor("2000.00") }));
    await h.assets.create(
      asset("a2", {
        acquisitionCost: Money.fromMajor("3600.00"),
        usefulLifeMonths: 12,
        accumulatedDepreciation: Money.fromMajor("3300.00"),
      }),
    );
    await h.runs.create({
      id: "run-1",
      period: "2026-03",
      branchId: null,
      status: "draft",
      lines: [
        { assetId: "a1", amount: Money.fromMajor("1000.00") },
        { assetId: "a2", amount: Money.fromMajor("300.00") },
      ],
      totalAmount: Money.fromMajor("1300.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });
    await postDepreciationRun("run-1", h.deps);
  });

  const deps = () => ({ runs: h.runs, assets: h.assets, gl: h.gl });

  it("posts a mirror-image entry and marks the original reversed", async () => {
    await reverseDepreciationRun("run-1", deps(), { reversalId: "rev-1" });

    const original = await h.ledger.findById("DEP-JE:run-1");
    expect(original!.status).toBe("reversed");
    expect(original!.reversedByEntryId).toBe("rev-1");

    const reversal = await h.ledger.findById("rev-1");
    expect(reversal!.status).toBe("posted");
    expect(reversal!.memo).toBe("عكس إهلاك الفترة 2026-03");
    // Every account nets to zero across the two entries.
    for (const accountId of ["5400-1", "1590-1"]) {
      const balance = await h.ledger.accountBalance(accountId);
      expect(balance.debit.scaled, accountId).toBe(balance.credit.scaled);
    }
  });

  it("restores every asset's accumulated depreciation, and its status with it", async () => {
    expect((await h.assets.findById("a2"))!.status).toBe("fully_depreciated");

    await reverseDepreciationRun("run-1", deps(), { reversalId: "rev-1" });

    expect((await h.assets.findById("a1"))!.accumulatedDepreciation.toString()).toBe("2000.000000");
    const a2 = await h.assets.findById("a2");
    expect(a2!.accumulatedDepreciation.toString()).toBe("3300.000000");
    expect(a2!.status).toBe("active");
    expect((await h.runs.findById("run-1"))!.status).toBe("cancelled");
  });

  it("refuses a reversal dated into a closed period, and changes nothing", async () => {
    await h.periods.create({
      id: "fp-2026-02",
      year: 2026,
      periodNumber: 2,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      status: "closed",
    });

    await expect(
      reverseDepreciationRun("run-1", deps(), { reversalId: "rev-1", date: "2026-02-15" }),
    ).rejects.toBeInstanceOf(PeriodNotOpenForPostingError);

    expect((await h.ledger.findById("DEP-JE:run-1"))!.status).toBe("posted");
    expect((await h.assets.findById("a1"))!.accumulatedDepreciation.toString()).toBe("3000.000000");
    expect((await h.runs.findById("run-1"))!.status).toBe("posted");
  });

  it("refuses to reverse a run that was never posted", async () => {
    await h.runs.create({
      id: "run-draft",
      period: "2026-04",
      branchId: null,
      status: "draft",
      lines: [{ assetId: "a1", amount: Money.fromMajor("1.00") }],
      totalAmount: Money.fromMajor("1.00"),
      journalEntryId: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      postedAt: null,
    });
    await expect(
      reverseDepreciationRun("run-draft", deps(), { reversalId: "rev-2" }),
    ).rejects.toBeInstanceOf(DepreciationRunNotPostedError);
  });

  it("refuses to reverse the same run twice", async () => {
    await reverseDepreciationRun("run-1", deps(), { reversalId: "rev-1" });
    await expect(
      reverseDepreciationRun("run-1", deps(), { reversalId: "rev-3" }),
    ).rejects.toBeInstanceOf(DepreciationRunNotPostedError);
  });
});
