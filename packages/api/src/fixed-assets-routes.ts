import { BranchRecordKind, recordsInBranchGrant } from "./branch-policy.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  createAssetCategory,
  createAsset,
  createDepreciationRun,
  postDepreciationRun,
  reverseDepreciationRun,
  DuplicateAssetCategoryCodeError,
  InvalidAssetCategoryError,
  AssetCategoryNotFoundError,
  DuplicateAssetCodeError,
  InvalidAssetError,
  AssetNotFoundError,
  AssetAlreadyDisposedError,
  InvalidAssetDisposalError,
  type DisposalProceedsAccount,
  disposeAsset,
  postJournalEntry,
  DepreciationRunNotFoundError,
  DepreciationRunNotDraftError,
  DepreciationRunNotPostedError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  VatPeriodAlreadyFiledError,
  DuplicateDepreciationPeriodError,
  NoDepreciableAssetsError,
  ReversalDateBeforeOriginalError,
  LaterDepreciationRunExistsError,
  type AssetCategory,
  type AssetCategoryRepository,
  type Asset,
  type AssetInternalRateHistoryRepository,
  type AssetInternalRateRow,
  type AssetRepository,
  type DepreciationRun,
  type DepreciationRunRepository,
  type AuditSink,
  type JournalPostingDeps,
  type WarehouseBranchLookup,
  type SettingsRepository,
  createDefaultSettings,
  matchesSearch,
  sortInternalRateHistory,
} from "@mezan/domain";
import {
  createAssetCategorySchema,
  createAssetSchema,
  createDepreciationRunSchema,
  disposeAssetSchema,
  setInternalHourlyRateSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
  branchScopeOf,
  withinScope,
} from "./permission-gate.js";
import type { StoredBranchesResolver } from "./permission-gate.js";
import { documentBranches } from "./stored-branches.js";
import { recordAdminEvent } from "./admin-audit.js";
import { tenantDay } from "./tenant-day.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * Fixed Assets routes (docs/archive/catalog/07-mfg-projects-assets.md "الأصول
 * الثابتة"): asset categories, the asset register, and depreciation runs
 * (including posting them to the REAL GL). Root-relative — a parent app
 * mounts this whole router under `/assets`.
 */
export interface FixedAssetsRoutesDeps {
  /** Refuses an asset or a depreciation run naming a branch or warehouse no master record holds (D310). */
  readonly masterData?: MasterDataChecks;
  readonly categories: AssetCategoryRepository;
  readonly assets: AssetRepository;
  readonly runs: DepreciationRunRepository;
  readonly gl: JournalPostingDeps;
  readonly warehouses?: WarehouseBranchLookup;
  /** Where a disposal's sale proceeds may land — derived by the composition root from the chart, never from a code prefix. */
  readonly disposalProceedsAccounts?: () => Promise<readonly DisposalProceedsAccount[]>;
  readonly defaultAccounts: {
    readonly depreciationExpenseAccountId: string;
    readonly accumulatedDepreciationAccountId: string;
    /** Where an asset's cost sits, and where a disposal's gain or loss lands. */
    readonly assetAccountId?: string;
    readonly disposalGainAccountId?: string;
    readonly disposalLossAccountId?: string;
  };
  /**
   * تاريخ سعر الساعة الداخلي. The rate is effective-dated because an equipment
   * log is priced at the rate in force on ITS date, not on today's.
   */
  readonly rateHistory: AssetInternalRateHistoryRepository;
  /** Generates ids when the request omits them. Defaults to `randomUUID`. */
  readonly idGen?: () => string;
  /** سجل العمليات الحساسة — a سعر الساعة الداخلي change is recorded with its before and after. */
  readonly audit?: AuditSink;
  /**
   * Tenant settings §"الضريبة" → `depreciationProrate`, so the depreciation in
   * the month of acquisition follows the tenant's stated policy rather than a
   * built-in one.
   */
  readonly settings?: SettingsRepository;
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

function serializeRateRow(row: AssetInternalRateRow) {
  return {
    effectiveFrom: row.effectiveFrom,
    hourlyRate: row.hourlyRate.toString(),
    setBy: row.setBy,
    setAt: row.setAt,
  };
}

function serializeAsset(asset: Asset, history: readonly AssetInternalRateRow[] = []) {
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
    projectId: asset.projectId,
    internalHourlyRate: asset.internalHourlyRate?.toString() ?? null,
    rateHistory: sortInternalRateHistory(history).map(serializeRateRow),
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
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 404 | 409 | 422) =>
    c.json({ error: e.code, message: e.message, ...(e.messageEn ? { messageEn: e.messageEn } : {}) }, status);
  if (err instanceof AssetCategoryNotFoundError || err instanceof AssetNotFoundError || err instanceof DepreciationRunNotFoundError) {
    return refuse(err, 404);
  }
  if (err instanceof DuplicateAssetCategoryCodeError || err instanceof DuplicateAssetCodeError || err instanceof DuplicateDepreciationPeriodError) {
    return refuse(err, 409);
  }
  if (
    err instanceof DepreciationRunNotDraftError ||
    err instanceof DepreciationRunNotPostedError ||
    err instanceof AssetAlreadyDisposedError
  ) {
    return refuse(err, 409);
  }
  // The GL's own gates reach the caller as a refusal, not a 500: a reversal
  // dated into a closed period or a filed VAT month is a business answer.
  if (
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof VatPeriodAlreadyFiledError
  ) {
    return refuse(err, 422);
  }
  if (
    err instanceof ReversalDateBeforeOriginalError ||
    err instanceof LaterDepreciationRunExistsError ||
    err instanceof InvalidAssetDisposalError ||
    err instanceof InvalidAssetCategoryError ||
    err instanceof InvalidAssetError ||
    err instanceof NoDepreciableAssetsError
  ) {
    return refuse(err, 422);
  }
  throw err;
}

export function createFixedAssetsRoutes(
  deps: FixedAssetsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  /**
   * A run for one branch is that branch's; a company-wide run posts on every
   * asset it depreciates, so it is judged by the branches of those assets.
   */
  const storedBranches: StoredBranchesResolver = async (c) => {
    const id = c.req.param("id");
    const route = c.req.routePath;
    if (!id || route.includes("/categories/:id")) return null;
    const assetBranches = async (assetIds: readonly string[]) => {
      const assets = await Promise.all(assetIds.map((assetId) => deps.assets.findById(assetId)));
      return (await Promise.all(assets.map((asset) => (asset ? documentBranches(c, [asset.branchId], [asset.warehouseId]) : [])))).flat();
    };
    if (route.includes("/depreciation/runs/:id")) {
      const run = await deps.runs.findById(id);
      if (!run) return null;
      return run.branchId ? [run.branchId] : assetBranches(run.lines.map((line) => line.assetId));
    }
    return assetBranches([id]);
  };
  const gate = createPermissionGate(resolveAuthContext, { storedBranches });
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

  interface AssetListFilter {
    readonly status?: string;
    readonly categoryId?: string;
    readonly branchId?: string;
    readonly search?: string;
  }

  /** The screen sends "all" for a cleared select, which is the absence of a filter, not a value to match. */
  function optionalQuery(c: Context, name: string): string | undefined {
    const value = c.req.query(name);
    return !value || value === "all" ? undefined : value;
  }

  function parseAssetListQuery(c: Context): AssetListFilter {
    return {
      status: optionalQuery(c, "status"),
      categoryId: optionalQuery(c, "categoryId"),
      branchId: optionalQuery(c, "branchId"),
      search: c.req.query("search") || undefined,
    };
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through. The register used to narrow by category, branch and free text in
   * the browser while its three tiles counted every asset the server had sent,
   * so applying a filter moved the rows and left the header alone.
   *
   * `branchScopeOf` is the scope, not a presentation filter — the `branchId`
   * query parameter narrows the already-scoped set and can never widen it.
   */
  async function listFilteredAssets(c: Context, filter: AssetListFilter): Promise<readonly Asset[]> {
    let rows = await recordsInBranchGrant(c, BranchRecordKind.Asset, withinScope(await deps.assets.list(), branchScopeOf(c), (a) => a.branchId), (a) => a.id);
    if (filter.status) rows = rows.filter((a) => a.status === filter.status);
    if (filter.categoryId) rows = rows.filter((a) => a.categoryId === filter.categoryId);
    if (filter.branchId) rows = rows.filter((a) => a.branchId === filter.branchId);
    if (filter.search) rows = rows.filter((a) => matchesSearch(filter.search, a.nameAr, a.nameEn, a.code));
    return rows;
  }

  app.get("/", gate("assets.view"), async (c) => {
    const assets = await listFilteredAssets(c, parseAssetListQuery(c));
    const history = await deps.rateHistory.listAll();
    const byAsset = new Map<string, AssetInternalRateRow[]>();
    for (const row of history) {
      const bucket = byAsset.get(row.assetId) ?? [];
      bucket.push(row);
      byAsset.set(row.assetId, bucket);
    }
    return c.json(assets.map((asset) => serializeAsset(asset, byAsset.get(asset.id) ?? [])));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   */
  app.get("/counts", gate("assets.view"), async (c) => {
    const { status: _ignored, ...withoutStatus } = parseAssetListQuery(c);
    const assets = await listFilteredAssets(c, withoutStatus);
    const counts: Record<string, number> = {
      all: assets.length,
      active: 0,
      under_maintenance: 0,
      fully_depreciated: 0,
      disposed: 0,
    };
    for (const asset of assets) counts[asset.status] = (counts[asset.status] ?? 0) + 1;
    return c.json(counts);
  });

  /** The KPI strip, over the whole filtered set rather than the page the screen happens to hold. */
  app.get("/stats", gate("assets.view"), async (c) => {
    const assets = await listFilteredAssets(c, parseAssetListQuery(c));
    let active = 0;
    let fullyDepreciated = 0;
    for (const asset of assets) {
      if (asset.status === "active") active += 1;
      if (asset.status === "fully_depreciated") fullyDepreciated += 1;
    }
    return c.json({ count: assets.length, active, fully_depreciated: fullyDepreciated });
  });

  app.post("/", gate("assets.create"), async (c) => {
    const parsed = createAssetSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const assetPlaceRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Branch, ids: [parsed.data.branchId] },
      { kind: MasterDataKind.Warehouse, ids: [parsed.data.warehouseId] },
    ]);
    if (assetPlaceRefusal) return assetPlaceRefusal;
    try {
      const asset = await createAsset(
        {
          ...parsed.data,
          acquisitionCost: Money.fromMajor(parsed.data.acquisitionCost),
          salvageValue: parsed.data.salvageValue !== undefined ? Money.fromMajor(parsed.data.salvageValue) : undefined,
          internalHourlyRate: parsed.data.internalHourlyRate ? Money.fromMajor(parsed.data.internalHourlyRate) : null,
        },
        { assets: deps.assets, categories: deps.categories },
      );
      return c.json(serializeAsset(asset), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/disposal-proceeds-accounts", gate("assets.view"), async (c) => {
    const offered = (await deps.disposalProceedsAccounts?.()) ?? [];
    return c.json(offered.map(({ account, kind }) => ({ id: account.id, code: account.code, nameAr: account.nameAr, nameEn: account.nameEn ?? null, kind })));
  });

  app.get("/:id", gate("assets.view"), async (c) => {
    const asset = await deps.assets.findById(c.req.param("id"));
    if (!asset) return c.json({ error: "ASSET_NOT_FOUND" }, 404);
    return c.json(serializeAsset(asset, await deps.rateHistory.list(asset.id)));
  });

  /**
   * سعر الساعة الداخلي. Every سجل تشغيل معدات charges the project at THIS
   * number — it becomes أعمال تحت التنفيذ, then تكلفة إيراد العقود, then the
   * percentage of completion, then recognised revenue. The site log therefore
   * has no override; the rate is changed here, under `assets.manage`, and the
   * before and after are recorded.
   *
   * INVARIANT: the rate is APPENDED at an effective date, never overwritten. A
   * log entered today for work done last month must price at the rate that was
   * in force then — overwriting restates a month that has already been
   * reported, in WIP, in cost, and in recognised revenue.
   */
  app.patch("/:id/internal-hourly-rate", gate("assets.manage"), async (c) => {
    const parsed = setInternalHourlyRateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const asset = await deps.assets.findById(c.req.param("id"));
    if (!asset) return c.json({ error: "ASSET_NOT_FOUND" }, 404);
    const next = parsed.data.hourlyRate === null ? null : Money.fromMajor(parsed.data.hourlyRate);
    if (next !== null && next.scaled < 0n) {
      return c.json({ error: "VALIDATION_ERROR", message: "سعر الساعة الداخلي لا يمكن أن يكون سالبًا" }, 422);
    }
    const effectiveFrom = await tenantDay(c, parsed.data.effectiveFrom ?? new Date().toISOString());
    const updated: Asset = { ...asset, internalHourlyRate: next };
    await deps.assets.update(updated);
    if (next !== null) {
      await deps.rateHistory.append({
        assetId: asset.id,
        effectiveFrom,
        hourlyRate: next,
        setBy: getAuthContext(c)?.userId ?? null,
        setAt: new Date().toISOString(),
      });
    }
    await recordAdminEvent(deps.audit, c, {
      module: "assets",
      entityType: "ASSET",
      entityId: asset.id,
      action: "SET_INTERNAL_HOURLY_RATE",
      severity: "WARNING",
      details: {
        code: asset.code,
        before: asset.internalHourlyRate?.toString() ?? null,
        after: next?.toString() ?? null,
        effectiveFrom,
        reason: parsed.data.reason ?? null,
      },
    });
    return c.json(serializeAsset(updated, await deps.rateHistory.list(asset.id)));
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
    // SECURITY: the account the proceeds land in is checked against the server's own list — the screen's picker is not a limit.
    if (body.proceedsAccountId && deps.disposalProceedsAccounts && !(await deps.disposalProceedsAccounts()).some(({ account }) => account.id === body.proceedsAccountId)) {
      return c.json(
        {
          error: "INVALID_DISPOSAL_PROCEEDS_ACCOUNT",
          message: "حساب تحصيل قيمة البيع يجب أن يكون حساب نقدية أو بنك أو ذمماً مدينة غير حساب مراقبة العملاء.",
          messageEn: "The proceeds account must be a cash or bank account, or a receivable other than the customers' control account.",
        },
        422,
      );
    }
    try {
      const result = await disposeAsset(
        {
          assetId: c.req.param("id"),
          date: await tenantDay(c, body.date),
          proceeds: body.proceeds ? Money.fromMajor(body.proceeds) : undefined,
          proceedsAccountId: body.proceedsAccountId ?? null,
          notes: body.notes ?? null,
        },
        {
          assets: deps.assets,
          categories: deps.categories,
          warehouses: deps.warehouses,
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
                  lines: posting.lines.map((l) => ({
                    accountId: l.accountId,
                    debit: l.debit,
                    credit: l.credit,
                    projectId: l.projectId ?? null,
                    costCategory: l.costCategory ?? null,
                    branchId: l.branchId ?? null,
                  })),
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

  /**
   * The single filter the runs list, its chips and its KPI strip all go
   * through. A run with no branch belongs to every branch, so `withinScope`
   * keeps it visible under a narrowed scope rather than dropping it.
   */
  async function listFilteredRuns(c: Context, status?: string): Promise<readonly DepreciationRun[]> {
    const rows = await recordsInBranchGrant(c, BranchRecordKind.DepreciationRun, withinScope(await deps.runs.list(), branchScopeOf(c), (r) => r.branchId), (r) => r.id);
    return status ? rows.filter((r) => r.status === status) : rows;
  }

  function runStatusQuery(c: Context): string | undefined {
    const status = c.req.query("status");
    return !status || status === "all" ? undefined : status;
  }

  app.get("/depreciation/runs", gate("assets.depreciation.view"), async (c) => {
    const runs = await listFilteredRuns(c, runStatusQuery(c));
    return c.json(runs.map(serializeRun));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   */
  app.get("/depreciation/runs/counts", gate("assets.depreciation.view"), async (c) => {
    const runs = await listFilteredRuns(c);
    const counts: Record<string, number> = { all: runs.length, draft: 0, posted: 0, cancelled: 0 };
    for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
    return c.json(counts);
  });

  /** The KPI strip, over the whole filtered set rather than the page the screen happens to hold. */
  app.get("/depreciation/runs/stats", gate("assets.depreciation.view"), async (c) => {
    const runs = await listFilteredRuns(c, runStatusQuery(c));
    let draft = 0;
    let posted = 0;
    for (const run of runs) {
      if (run.status === "draft") draft += 1;
      if (run.status === "posted") posted += 1;
    }
    return c.json({ count: runs.length, draft, posted });
  });

  app.post("/depreciation/runs", gate("assets.depreciation.run"), async (c) => {
    const parsed = createDepreciationRunSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const runBranchRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Branch, ids: [parsed.data.branchId] },
    ]);
    if (runBranchRefusal) return runBranchRefusal;
    try {
      const settings = deps.settings ? ((await deps.settings.get()) ?? createDefaultSettings()) : null;
      const run = await createDepreciationRun(
        {
          id: idGen(),
          period: parsed.data.period,
          branchId: parsed.data.branchId ?? null,
          prorate: settings?.depreciationProrate ?? "DAILY",
        },
        { runs: deps.runs, assets: deps.assets },
      );
      return c.json(serializeRun(run), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/depreciation/runs/:id", gate("assets.depreciation.view"), async (c) => {
    const run = await deps.runs.findById(c.req.param("id"));
    if (!run || withinScope([run], branchScopeOf(c), (r) => r.branchId).length === 0) {
      return c.json({ error: "DEPRECIATION_RUN_NOT_FOUND" }, 404);
    }
    return c.json(serializeRun(run));
  });

  app.post("/depreciation/runs/:id/post", gate("assets.depreciation.run"), async (c) => {
    try {
      const run = await postDepreciationRun(c.req.param("id"), {
        runs: deps.runs,
        assets: deps.assets,
        categories: deps.categories,
        gl: deps.gl,
        warehouses: deps.warehouses,
        defaultAccounts: deps.defaultAccounts,
      });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * عكس تشغيل الإهلاك (B-9, D275). Period-gated by the GL engine on the
   * reversal's own date, so a locked or closed month refuses; the assets'
   * accumulated depreciation comes back with the entry. No date sent
   * defaults to today, in the tenant's own calendar day — the same fix D270
   * gave voucher reversals, one bounded context over — never the run's own
   * period-end day, which would restate a period already reported.
   */
  app.post("/depreciation/runs/:id/reverse", gate("assets.depreciation.run"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { date?: string; memo?: string };
    try {
      const run = await reverseDepreciationRun(
        c.req.param("id"),
        { runs: deps.runs, assets: deps.assets, gl: deps.gl },
        {
          reversalId: idGen(),
          date: await tenantDay(c, body.date ?? (deps.gl.now ? deps.gl.now() : new Date().toISOString())),
          memo: body.memo,
        },
      );
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
