import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  createAssetCategory,
  createAsset,
  createDepreciationRun,
  postDepreciationRun,
  DuplicateAssetCategoryCodeError,
  InvalidAssetCategoryError,
  AssetCategoryNotFoundError,
  DuplicateAssetCodeError,
  InvalidAssetError,
  AssetNotFoundError,
  AssetAlreadyDisposedError,
  InvalidAssetDisposalError,
  disposeAsset,
  postJournalEntry,
  DepreciationRunNotFoundError,
  DepreciationRunNotDraftError,
  DuplicateDepreciationPeriodError,
  NoDepreciableAssetsError,
  type AssetCategory,
  type AssetCategoryRepository,
  type Asset,
  type AssetRepository,
  type DepreciationRun,
  type DepreciationRunRepository,
  type JournalPostingDeps,
} from "@mezan/domain";
import { createAssetCategorySchema, createAssetSchema, createDepreciationRunSchema, disposeAssetSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";

/**
 * Fixed Assets routes (docs/catalog/07-mfg-projects-assets.md "الأصول
 * الثابتة"): asset categories, the asset register, and depreciation runs
 * (including posting them to the REAL GL). Root-relative — a parent app
 * mounts this whole router under `/assets`.
 */
export interface FixedAssetsRoutesDeps {
  readonly categories: AssetCategoryRepository;
  readonly assets: AssetRepository;
  readonly runs: DepreciationRunRepository;
  readonly gl: JournalPostingDeps;
  readonly defaultAccounts: {
    readonly depreciationExpenseAccountId: string;
    readonly accumulatedDepreciationAccountId: string;
    /** Where an asset's cost sits, and where a disposal's gain or loss lands. */
    readonly assetAccountId?: string;
    readonly disposalGainAccountId?: string;
    readonly disposalLossAccountId?: string;
  };
  /** Generates ids when the request omits them. Defaults to `randomUUID`. */
  readonly idGen?: () => string;
}

function serializeCategory(category: AssetCategory) {
  return {
    id: category.id,
    code: category.code,
    nameAr: category.nameAr,
    nameEn: category.nameEn,
    defaultDepreciationMethod: category.defaultDepreciationMethod,
    defaultUsefulLifeMonths: category.defaultUsefulLifeMonths,
    defaultSalvagePercent: category.defaultSalvagePercent,
    assetAccountId: category.assetAccountId,
    depreciationExpenseAccountId: category.depreciationExpenseAccountId,
    accumulatedDepreciationAccountId: category.accumulatedDepreciationAccountId,
    gainOnDisposalAccountId: category.gainOnDisposalAccountId,
    lossOnDisposalAccountId: category.lossOnDisposalAccountId,
    active: category.active,
  };
}

function serializeAsset(asset: Asset) {
  return {
    id: asset.id,
    code: asset.code,
    nameAr: asset.nameAr,
    nameEn: asset.nameEn,
    categoryId: asset.categoryId,
    scope: asset.scope,
    branchId: asset.branchId,
    warehouseId: asset.warehouseId,
    acquisitionDate: asset.acquisitionDate,
    acquisitionCost: asset.acquisitionCost.toString(),
    depreciationStartDate: asset.depreciationStartDate,
    depreciationMethod: asset.depreciationMethod,
    usefulLifeMonths: asset.usefulLifeMonths,
    salvageValue: asset.salvageValue.toString(),
    accumulatedDepreciation: asset.accumulatedDepreciation.toString(),
    status: asset.status,
    assetAccountId: asset.assetAccountId,
    depreciationExpenseAccountId: asset.depreciationExpenseAccountId,
    accumulatedDepreciationAccountId: asset.accumulatedDepreciationAccountId,
    notes: asset.notes,
  };
}

function serializeRun(run: DepreciationRun) {
  return {
    id: run.id,
    period: run.period,
    branchId: run.branchId,
    status: run.status,
    lines: run.lines.map((l) => ({ assetId: l.assetId, amount: l.amount.toString() })),
    totalAmount: run.totalAmount.toString(),
    journalEntryId: run.journalEntryId,
    createdAt: run.createdAt,
    postedAt: run.postedAt,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof AssetCategoryNotFoundError || err instanceof AssetNotFoundError || err instanceof DepreciationRunNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateAssetCategoryCodeError || err instanceof DuplicateAssetCodeError || err instanceof DuplicateDepreciationPeriodError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof DepreciationRunNotDraftError || err instanceof AssetAlreadyDisposedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidAssetDisposalError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof InvalidAssetCategoryError || err instanceof InvalidAssetError || err instanceof NoDepreciableAssetsError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

export function createFixedAssetsRoutes(
  deps: FixedAssetsRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;

  app.get("/categories", gate("assets.view"), async (c) => {
    const categories = await deps.categories.list();
    return c.json(categories.map(serializeCategory));
  });

  app.post("/categories", gate("assets.manage"), async (c) => {
    const parsed = createAssetCategorySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const category = await createAssetCategory(parsed.data, deps.categories);
      return c.json(serializeCategory(category), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/categories/:id", gate("assets.view"), async (c) => {
    const category = await deps.categories.findById(c.req.param("id"));
    if (!category) return c.json({ error: "ASSET_CATEGORY_NOT_FOUND" }, 404);
    return c.json(serializeCategory(category));
  });

  app.get("/", gate("assets.view"), async (c) => {
    const assets = withinScope(await deps.assets.list(), branchScopeOf(c), (a) => a.branchId);
    return c.json(assets.map(serializeAsset));
  });

  app.post("/", gate("assets.create"), async (c) => {
    const parsed = createAssetSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const asset = await createAsset(
        {
          ...parsed.data,
          acquisitionCost: Money.fromMajor(parsed.data.acquisitionCost),
          salvageValue: parsed.data.salvageValue !== undefined ? Money.fromMajor(parsed.data.salvageValue) : undefined,
        },
        { assets: deps.assets, categories: deps.categories },
      );
      return c.json(serializeAsset(asset), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("assets.view"), async (c) => {
    const asset = await deps.assets.findById(c.req.param("id"));
    if (!asset) return c.json({ error: "ASSET_NOT_FOUND" }, 404);
    return c.json(serializeAsset(asset));
  });

  /**
   * التخلص من أصل. The status value and the `assets.dispose` permission both
   * shipped long before anything could reach them (D13).
   */
  app.post("/:id/dispose", gate("assets.dispose"), async (c) => {
    const parsed = disposeAssetSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    try {
      const result = await disposeAsset(
        {
          assetId: c.req.param("id"),
          date: body.date,
          proceeds: body.proceeds ? Money.fromMajor(body.proceeds) : undefined,
          proceedsAccountId: body.proceedsAccountId ?? null,
          notes: body.notes ?? null,
        },
        {
          assets: deps.assets,
          categories: deps.categories,
          accounts: {
            assetAccountId: deps.defaultAccounts.assetAccountId ?? "1500",
            accumulatedDepreciationAccountId: deps.defaultAccounts.accumulatedDepreciationAccountId,
            gainAccountId: deps.defaultAccounts.disposalGainAccountId ?? "4500",
            lossAccountId: deps.defaultAccounts.disposalLossAccountId ?? "5450",
          },
          gl: {
            post: async (posting) => {
              await postJournalEntry(
                {
                  id: `DISP-JE:${posting.sourceDocId}`,
                  date: posting.date,
                  memo: posting.memo,
                  source: "system",
                  lines: posting.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
                },
                deps.gl,
              );
            },
          },
        },
      );
      return c.json({
        ...serializeAsset(result.asset),
        bookValueAtDisposal: result.bookValue.toString(),
        gainOrLoss: result.gainOrLoss.toString(),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/depreciation/runs", gate("assets.depreciation.view"), async (c) => {
    const runs = await deps.runs.list();
    return c.json(runs.map(serializeRun));
  });

  app.post("/depreciation/runs", gate("assets.depreciation.run"), async (c) => {
    const parsed = createDepreciationRunSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const run = await createDepreciationRun(
        { id: idGen(), period: parsed.data.period, branchId: parsed.data.branchId ?? null },
        { runs: deps.runs, assets: deps.assets },
      );
      return c.json(serializeRun(run), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/depreciation/runs/:id", gate("assets.depreciation.view"), async (c) => {
    const run = await deps.runs.findById(c.req.param("id"));
    if (!run) return c.json({ error: "DEPRECIATION_RUN_NOT_FOUND" }, 404);
    return c.json(serializeRun(run));
  });

  app.post("/depreciation/runs/:id/post", gate("assets.depreciation.run"), async (c) => {
    try {
      const run = await postDepreciationRun(c.req.param("id"), {
        runs: deps.runs,
        assets: deps.assets,
        categories: deps.categories,
        gl: deps.gl,
        defaultAccounts: deps.defaultAccounts,
      });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
