import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { Asset, AssetRepository } from "./asset.js";
import type { AssetCategory } from "./asset-category.js";
import { AssetNotFoundError } from "./errors.js";
import {
  AssetAlreadyDisposedError,
  InvalidAssetDisposalError,
  disposeAsset,
  type DisposeAssetGlAccounts,
  type DisposeAssetPosting,
} from "./dispose-asset.js";

const ACCOUNTS: DisposeAssetGlAccounts = {
  assetAccountId: "1600",
  accumulatedDepreciationAccountId: "1690",
  gainAccountId: "4900",
  lossAccountId: "5900",
};

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    code: "FA-0001",
    nameAr: "سيارة نقل",
    nameEn: null,
    categoryId: "cat-1",
    scope: "company",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2024-01-01",
    acquisitionCost: Money.fromMajor("100000"),
    depreciationStartDate: "2024-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 60,
    salvageValue: Money.zero(),
    accumulatedDepreciation: Money.fromMajor("40000"),
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
    ...overrides,
  } as Asset;
}

function harness(initial: Asset = asset(), category: AssetCategory | null = null) {
  const stored = new Map<string, Asset>([[initial.id, initial]]);
  const posted: DisposeAssetPosting[] = [];
  const assets: AssetRepository = {
    async findById(id) {
      return stored.get(id) ?? null;
    },
    async findByCode(code) {
      return [...stored.values()].find((a) => a.code === code) ?? null;
    },
    async list() {
      return [...stored.values()];
    },
    async create(a) {
      stored.set(a.id, a);
    },
    async update(a) {
      stored.set(a.id, a);
    },
  };
  return {
    stored,
    posted,
    deps: {
      assets,
      categories: { async findById() { return category; } },
      accounts: ACCOUNTS,
      gl: { async post(p: DisposeAssetPosting) { posted.push(p); } },
    },
  };
}

const sum = (lines: readonly { debit: Money; credit: Money }[], side: "debit" | "credit") =>
  lines.reduce((acc, l) => acc + l[side].scaled, 0n);

describe("disposeAsset — the arithmetic", () => {
  it("reports book value as cost less accumulated depreciation", async () => {
    const h = harness();
    const result = await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    expect(result.bookValue.toString()).toBe("60000.000000");
  });

  it("reports a loss when a scrapped asset still has book value left", async () => {
    const h = harness();
    const result = await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    expect(result.gainOrLoss.toString()).toBe("-60000.000000");
  });

  it("reports a gain when the proceeds beat the book value", async () => {
    const h = harness();
    const result = await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("75000"), proceedsAccountId: "1310" },
      h.deps,
    );
    expect(result.gainOrLoss.toString()).toBe("15000.000000");
  });

  it("reports neither when the proceeds are exactly the book value", async () => {
    const h = harness();
    const result = await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("60000"), proceedsAccountId: "1310" },
      h.deps,
    );
    expect(result.gainOrLoss.scaled).toBe(0n);
  });

  it("is exact to the micro-unit either side of break-even", async () => {
    const gain = harness();
    const gained = await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("60000.000001"), proceedsAccountId: "1310" },
      gain.deps,
    );
    expect(gained.gainOrLoss.scaled).toBe(1n);

    const loss = harness();
    const lost = await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("59999.999999"), proceedsAccountId: "1310" },
      loss.deps,
    );
    expect(lost.gainOrLoss.scaled).toBe(-1n);
  });
});

describe("disposeAsset — the posting", () => {
  it("balances, and clears both the cost and the accumulated depreciation", async () => {
    const h = harness();
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);

    const [posting] = h.posted;
    expect(posting).toBeDefined();
    expect(sum(posting?.lines ?? [], "debit")).toBe(sum(posting?.lines ?? [], "credit"));

    const byAccount = new Map((posting?.lines ?? []).map((l) => [l.accountId, l]));
    expect(byAccount.get("1690")?.debit.toString()).toBe("40000.000000");
    expect(byAccount.get("1600")?.credit.toString()).toBe("100000.000000");
    expect(byAccount.get("5900")?.debit.toString()).toBe("60000.000000");
    expect(byAccount.has("4900")).toBe(false);
  });

  it("credits the gain account, and only it, on a profitable sale", async () => {
    const h = harness();
    await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("75000"), proceedsAccountId: "1310" },
      h.deps,
    );
    const [posting] = h.posted;
    const byAccount = new Map((posting?.lines ?? []).map((l) => [l.accountId, l]));
    expect(byAccount.get("4900")?.credit.toString()).toBe("15000.000000");
    expect(byAccount.has("5900")).toBe(false);
    expect(byAccount.get("1310")?.debit.toString()).toBe("75000.000000");
    expect(sum(posting?.lines ?? [], "debit")).toBe(sum(posting?.lines ?? [], "credit"));
  });

  it("posts neither gain nor loss when the sale exactly matches the book value", async () => {
    const h = harness();
    await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("60000"), proceedsAccountId: "1310" },
      h.deps,
    );
    const accounts = (h.posted[0]?.lines ?? []).map((l) => l.accountId);
    expect(accounts).not.toContain("4900");
    expect(accounts).not.toContain("5900");
    expect(sum(h.posted[0]?.lines ?? [], "debit")).toBe(sum(h.posted[0]?.lines ?? [], "credit"));
  });

  it("omits the accumulated-depreciation line for an asset that never depreciated", async () => {
    const h = harness(asset({ accumulatedDepreciation: Money.zero() }));
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    const accounts = (h.posted[0]?.lines ?? []).map((l) => l.accountId);
    expect(accounts).not.toContain("1690");
    expect(sum(h.posted[0]?.lines ?? [], "debit")).toBe(sum(h.posted[0]?.lines ?? [], "credit"));
  });

  it("posts nothing at all for a fully depreciated asset scrapped for nothing, beyond clearing both sides", async () => {
    const h = harness(asset({ accumulatedDepreciation: Money.fromMajor("100000") }));
    const result = await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    expect(result.bookValue.scaled).toBe(0n);
    expect(result.gainOrLoss.scaled).toBe(0n);
    const byAccount = new Map((h.posted[0]?.lines ?? []).map((l) => [l.accountId, l]));
    expect(byAccount.get("1690")?.debit.toString()).toBe("100000.000000");
    expect(byAccount.get("1600")?.credit.toString()).toBe("100000.000000");
    expect(sum(h.posted[0]?.lines ?? [], "debit")).toBe(sum(h.posted[0]?.lines ?? [], "credit"));
  });

  it("names the asset in the entry, so the ledger is readable without a lookup", async () => {
    const h = harness();
    await disposeAsset({ assetId: "asset-1", date: "2026-02-15" }, h.deps);
    expect(h.posted[0]).toMatchObject({
      sourceDocType: "ASSET_DISPOSAL",
      sourceDocId: "asset-1",
      sourceDocNumber: "FA-0001",
      date: "2026-02-15",
    });
    expect(h.posted[0]?.memo).toContain("FA-0001");
    expect(h.posted[0]?.memo).toContain("سيارة نقل");
  });

  it("prefers the asset's own accounts, then the category's, then the fallbacks", async () => {
    const own = harness(asset({ assetAccountId: "1601", accumulatedDepreciationAccountId: "1691" }));
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, own.deps);
    expect((own.posted[0]?.lines ?? []).map((l) => l.accountId)).toEqual(
      expect.arrayContaining(["1601", "1691"]),
    );

    const category = harness(asset(), {
      id: "cat-1",
      assetAccountId: "1602",
      accumulatedDepreciationAccountId: "1692",
    } as AssetCategory);
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, category.deps);
    expect((category.posted[0]?.lines ?? []).map((l) => l.accountId)).toEqual(
      expect.arrayContaining(["1602", "1692"]),
    );
  });

  it("still disposes the asset when no ledger is wired in", async () => {
    const h = harness();
    const result = await disposeAsset(
      { assetId: "asset-1", date: "2026-01-31" },
      { ...h.deps, gl: undefined },
    );
    expect(result.asset.status).toBe("disposed");
    expect(h.posted).toHaveLength(0);
  });
});

describe("disposeAsset — the refusals", () => {
  it("refuses an asset that is not there", async () => {
    const h = harness();
    await expect(disposeAsset({ assetId: "ghost", date: "2026-01-31" }, h.deps)).rejects.toBeInstanceOf(
      AssetNotFoundError,
    );
  });

  it("refuses to dispose the same asset twice — disposal is terminal", async () => {
    const h = harness();
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    await expect(disposeAsset({ assetId: "asset-1", date: "2026-02-01" }, h.deps)).rejects.toBeInstanceOf(
      AssetAlreadyDisposedError,
    );
    expect(h.posted).toHaveLength(1);
  });

  it("refuses negative proceeds, in Arabic", async () => {
    const h = harness();
    await expect(
      disposeAsset(
        { assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("-1"), proceedsAccountId: "1310" },
        h.deps,
      ),
    ).rejects.toThrow(InvalidAssetDisposalError);
    expect(h.posted).toHaveLength(0);
  });

  it("refuses proceeds with nowhere to land", async () => {
    const h = harness();
    await expect(
      disposeAsset({ assetId: "asset-1", date: "2026-01-31", proceeds: Money.fromMajor("1000") }, h.deps),
    ).rejects.toThrow(InvalidAssetDisposalError);
  });

  it("refuses a disposal dated before the asset was acquired", async () => {
    const h = harness();
    await expect(
      disposeAsset({ assetId: "asset-1", date: "2023-12-31" }, h.deps),
    ).rejects.toThrow(InvalidAssetDisposalError);
    expect(h.posted).toHaveLength(0);
  });

  it("allows a disposal on the acquisition day itself", async () => {
    const h = harness(asset({ accumulatedDepreciation: Money.zero() }));
    const result = await disposeAsset({ assetId: "asset-1", date: "2024-01-01" }, h.deps);
    expect(result.asset.status).toBe("disposed");
  });

  it("leaves the asset alone when it refuses", async () => {
    const h = harness();
    await expect(
      disposeAsset({ assetId: "asset-1", date: "2023-01-01" }, h.deps),
    ).rejects.toThrow(InvalidAssetDisposalError);
    expect(h.stored.get("asset-1")?.status).toBe("active");
  });
});

describe("disposeAsset — what it stores", () => {
  it("marks the asset disposed so it stops depreciating", async () => {
    const h = harness();
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    expect(h.stored.get("asset-1")?.status).toBe("disposed");
  });

  it("keeps the disposal note, and keeps the old note when none is given", async () => {
    const withNote = harness();
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31", notes: "بيعت لشركة النقل" }, withNote.deps);
    expect(withNote.stored.get("asset-1")?.notes).toBe("بيعت لشركة النقل");

    const kept = harness(asset({ notes: "ملاحظة سابقة" }));
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, kept.deps);
    expect(kept.stored.get("asset-1")?.notes).toBe("ملاحظة سابقة");
  });

  it("changes nothing else about the asset", async () => {
    const h = harness();
    const before = h.stored.get("asset-1") as Asset;
    await disposeAsset({ assetId: "asset-1", date: "2026-01-31" }, h.deps);
    const after = h.stored.get("asset-1") as Asset;
    expect({ ...after, status: before.status }).toEqual(before);
  });
});
