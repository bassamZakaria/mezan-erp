import { ReversalDocumentType } from "@mezan/contracts";
import { useReverseDocumentAction } from "../reversal/ReverseDocumentAction";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  StatusPill,
  Card,
  Button,
  RowMenu,
  SidePanel,
  MoneyInput,
  type DocumentListColumn,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { AssetDTO, AssetScopeDTO, AssetStatusDTO, CreateAssetDTO } from "@mezan/contracts";
import {
  ApiError,
  useAccounts,
  useAssetCategories,
  useAssets,
  useAssetStats,
  useBranches,
  useCreateAsset,
  useDisposeAsset,
  useProjects,
  useSetInternalHourlyRate,
  type AssetListFilter,
} from "../data/hooks";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useUrlNumber, useUrlSearch } from "../lib/url-state";
import { EMPTY } from "../lib/empty";

/** سجل الأصول (Asset Register) — docs/archive/catalog/07 §"سجل الأصول". List + detail + register-asset panel. */

const STATUS_KEY: Record<AssetStatusDTO, AppTranslationKey> = {
  active: "common.active",
  under_maintenance: "asset.underMaintenance",
  fully_depreciated: "asset.fullyDepreciated",
  disposed: "asset.disposed",
};

const STATUS_TONE: Record<AssetStatusDTO, PillTone> = {
  active: "success",
  under_maintenance: "warning",
  fully_depreciated: "info",
  disposed: "danger",
};

const SCOPE_KEY: Record<AssetScopeDTO, AppTranslationKey> = { general: "asset.scopeGeneral", branch: "asset.scopeBranch", warehouse: "asset.scopeWarehouse" };
const SCOPE_VALUES = Object.keys(SCOPE_KEY) as AssetScopeDTO[];

const PAGE_SIZES = [10, 25, 50, 100] as const;

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

function bookValue(asset: AssetDTO): number {
  return toMajor(asset.acquisitionCost) - toMajor(asset.accumulatedDepreciation);
}

interface AssetDraft {
  nameAr: string;
  nameEn: string;
  code: string;
  categoryId: string;
  scope: AssetScopeDTO;
  branchId: string;
  warehouseId: string;
  acquisitionDate: string;
  acquisitionCost: number | null;
  depreciationStartDate: string;
  usefulLifeMonths: number;
  salvageValue: number | null;
  internalHourlyRate: number | null;
}

function blankDraft(): AssetDraft {
  return {
    nameAr: "",
    nameEn: "",
    code: "",
    categoryId: "",
    scope: "general",
    branchId: "",
    warehouseId: "",
    acquisitionDate: "",
    acquisitionCost: 0,
    depreciationStartDate: "",
    usefulLifeMonths: 60,
    salvageValue: null,
    internalHourlyRate: null,
  };
}

function validateDraft(draft: AssetDraft, existing: AssetDTO[]): { key: AppTranslationKey; params?: Record<string, string> } | null {
  const code = draft.code.trim();
  if (code === "") return { key: "asset.codeRequired" };
  if (existing.some((a) => a.code === code)) return { key: "assetCategories.codeInUse", params: { code } };
  if (draft.nameAr.trim() === "") return { key: "asset.nameArRequired" };
  if (draft.categoryId.trim() === "") return { key: "asset.categoryRequired" };
  if (draft.scope === "branch" && draft.branchId.trim() === "") return { key: "asset.branchRequired" };
  if (draft.acquisitionDate.trim() === "") return { key: "asset.acquisitionDateRequired" };
  if (draft.acquisitionCost === null || draft.acquisitionCost < 0) return { key: "asset.acquisitionCostRequired" };
  if (!Number.isFinite(draft.usefulLifeMonths) || draft.usefulLifeMonths <= 0) return { key: "asset.usefulLifeRequired" };
  return null;
}

export function AssetRegisterScreen() {
  const reversal = useReverseDocumentAction(ReversalDocumentType.AssetDisposal);
  const { t } = useAppTranslation();
  const categoriesQuery = useAssetCategories();
  const branchesQuery = useBranches();
  const projectsQuery = useProjects();
  const createAsset = useCreateAsset();

  const categories = categoriesQuery.data ?? [];
  const branches = branchesQuery.data ?? [];
  const projects = projectsQuery.data ?? EMPTY;
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.nameAr]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : t("common.noProject"));
  }, [projects, t]);
  const projectOptions: EntityPickerOption[] = useMemo(
    () =>
      projects
        .filter((p) => p.status === "planned" || p.status === "active" || p.status === "on_hold")
        .map((p) => ({ id: p.id, label: p.nameAr, sublabel: p.code })),
    [projects],
  );

  const [searchText, setSearchText, search] = useUrlSearch();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  /**
   * One filter for the rows and the KPI strip (R1.1) — category, branch and
   * search used to narrow the browser's own unfiltered copy of the register
   * while the three tiles kept counting every asset regardless.
   */
  const filter = useMemo<AssetListFilter>(
    () => ({ categoryId: categoryFilter, branchId: branchFilter, search: search.trim() || undefined }),
    [categoryFilter, branchFilter, search],
  );
  const query = useAssets(filter);
  const assets = query.data ?? [];
  const stats = useAssetStats(filter).data ?? {};

  const [formOpen, setFormOpen] = useState(false);
  const disposeAsset = useDisposeAsset();
  const setInternalHourlyRate = useSetInternalHourlyRate();
  const [rateDraft, setRateDraft] = useState<number | null>(null);
  const [rateEffectiveFrom, setRateEffectiveFrom] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeDate, setDisposeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [disposeProceeds, setDisposeProceeds] = useState<number | null>(null);
  const [disposeError, setDisposeError] = useState<string | null>(null);
  const accountsQuery = useAccounts();
  // Where the money from a sale lands: a cash/bank account, or a receivable
  // when the buyer has not paid yet. HEADER accounts are excluded — nothing may
  // post to one, so offering it is offering a choice that always fails. The
  // empty first option is explicit: without it the list rendered its first real
  // account as though it were selected while the value was still empty, so the
  // user saw an account chosen and got "حساب التحصيل مطلوب" on submit.
  const proceedsAccountOptions = [
    { value: "", label: t("assets.disposeProceedsPlaceholder") },
    ...(accountsQuery.data ?? [])
      .filter((a) => a.type === "asset" && !a.isHeader && (String(a.code).startsWith("13") || String(a.code).startsWith("11")))
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` })),
  ];
  const [disposeProceedsAccountId, setDisposeProceedsAccountId] = useState("");
  const [draft, setDraft] = useState<AssetDraft>(blankDraft());
  const [project, setProject] = useState<EntityPickerOption | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function categoryName(categoryId: string): string {
    const category = categories.find((c) => c.id === categoryId);
    return category ? `${category.code} — ${category.nameAr}` : categoryId;
  }

  const filtered = assets;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = (categoryFilter === "all" ? 0 : 1) + (branchFilter === "all" ? 0 : 1);

  const selected = selectedId ? assets.find((a) => a.id === selectedId) ?? null : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setProject(null);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, assets);
    if (error) {
      setFormError(t(error.key, error.params));
      return;
    }
    setFormError(null);
    const body: CreateAssetDTO = {
      id: crypto.randomUUID(),
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      categoryId: draft.categoryId,
      scope: draft.scope,
      branchId: draft.scope === "branch" ? draft.branchId : null,
      warehouseId: draft.scope === "warehouse" ? (draft.warehouseId.trim() === "" ? null : draft.warehouseId.trim()) : null,
      acquisitionDate: draft.acquisitionDate.trim(),
      acquisitionCost: (draft.acquisitionCost ?? 0).toFixed(6),
      depreciationStartDate: draft.depreciationStartDate.trim() === "" ? undefined : draft.depreciationStartDate.trim(),
      usefulLifeMonths: draft.usefulLifeMonths,
      salvageValue: draft.salvageValue === null ? undefined : draft.salvageValue.toFixed(6),
      projectId: project?.id ?? null,
      internalHourlyRate: draft.internalHourlyRate === null ? null : draft.internalHourlyRate.toFixed(6),
    };
    try {
      await createAsset.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("asset.couldNotRegisterTheAsset"));
    }
  }

  const columns: DocumentListColumn<AssetDTO>[] = [
    { key: "nameAr", header: t("asset.asset"), render: (a) => <span className="font-semibold text-ink">{a.nameAr}</span> },
    { key: "category", header: t("common.category"), render: (a) => categoryName(a.categoryId) },
    { key: "acquisitionDate", header: t("asset.acquiredOn"), render: (a) => <span className="mz-num">{a.acquisitionDate}</span> },
    { key: "acquisitionCost", header: t("asset.acquisitionCost"), align: "end", render: (a) => <MoneyDisplay value={toMajor(a.acquisitionCost)} /> },
    { key: "bookValue", header: t("asset.bookValue"), align: "end", render: (a) => <MoneyDisplay value={bookValue(a)} /> },
    { key: "status", header: t("common.status"), render: (a) => <StatusPill label={t(STATUS_KEY[a.status])} tone={STATUS_TONE[a.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("asset.couldNotLoadTheAsset")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<AssetDTO>
        title={t("asset.assetRegister")}
        description={t("asset.theCentralRecordOfFixed")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("asset.registerAnAsset")}
          </Button>
        }
        listKey="asset-register"
        statsCollapsible
        stats={[
          { label: t("asset.totalAssets"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("common.active"), value: <span className="mz-num">{stats.active ?? 0}</span> },
          { label: t("asset.fullyDepreciated"), value: <span className="mz-num">{stats.fully_depreciated ?? 0}</span> },
        ]}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("asset.searchAssets")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap gap-[10px]">
            <div className="min-w-[200px]">
              <SelectField
                label={t("common.category")}
                value={categoryFilter}
                onChange={(v) => {
                  setCategoryFilter(v);
                  setPage(1);
                }}
                options={[{ value: "all", label: t("asset.allCategories") }, ...categories.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameAr}` }))]}
              />
            </div>
            <div className="min-w-[200px]">
              <SelectField
                label={t("common.branch")}
                value={branchFilter}
                onChange={(v) => {
                  setBranchFilter(v);
                  setPage(1);
                }}
                options={[{ value: "all", label: t("asset.allBranches") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </div>
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={accountsQuery.isLoading}
        rowKey={(a) => a.id}
        onRowClick={(a) => setSelectedId(a.id)}
        rowAction={(a) => {
          const menuItems: RowMenuItem[] = [
            {
              key: "view",
              label: t("common.view"),
              onSelect: () => {
                setDisposeOpen(false);
                setSelectedId(a.id);
              },
            },
            ...(a.status !== "disposed"
              ? [
                  {
                    key: "dispose",
                    label: t("assets.dispose"),
                    tone: "danger" as const,
                    onSelect: () => {
                      setDisposeError(null);
                      setSelectedId(a.id);
                      setDisposeOpen(true);
                    },
                  },
                ]
              : reversal.menuItems({ id: a.id, params: { id: a.id }, subject: a.nameAr })),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: a.nameAr })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("asset.asset2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("asset.noAssetsNothingHasBeen")}
            description={t("asset.emptyBody")}
            action={{ label: t("asset.registerAnAsset"), onClick: openCreateForm }}
          />
        }
      />
      {reversal.dialog}

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("asset.panelTitle", { name: selected.nameAr }) : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.assetCode")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.code}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.assetName")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.nameEn ?? "—"}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.category")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{categoryName(selected.categoryId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.assetScope")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(SCOPE_KEY[selected.scope])}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.acquiredOn")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.acquisitionDate}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.depreciationStarts")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.depreciationStartDate}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.usefulLifeMonths")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.usefulLifeMonths}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.depreciationMethod")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t("asset.straightLine")}</div>
              </div>
              <div className="border-e border-t border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.assignedProject")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{projectName(selected.projectId)}</div>
              </div>
            </Card>
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.acquisitionCost")}</div>
                <MoneyDisplay value={toMajor(selected.acquisitionCost)} className="mt-[5px] text-[14px] font-bold" />
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.residualValue")}</div>
                <MoneyDisplay value={toMajor(selected.salvageValue)} className="mt-[5px] text-[14px] font-bold" />
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.internalHourlyRate")}</div>
                {selected.internalHourlyRate ? (
                  <MoneyDisplay value={toMajor(selected.internalHourlyRate)} className="mt-[5px] text-[14px] font-bold" />
                ) : (
                  <div className="mt-[5px] text-[14px] font-bold text-ink">{t("asset.notPlant")}</div>
                )}
                <div className="mt-[8px] flex items-end gap-[8px]">
                  <MoneyInput
                    aria-label={t("asset.internalHourlyRate")}
                    value={rateDraft}
                    onChange={setRateDraft}
                  />
                  <TextField
                    label={t("asset.rateEffectiveFrom")}
                    value={rateEffectiveFrom}
                    onChange={setRateEffectiveFrom}
                    placeholder="YYYY-MM-DD"
                  />
                  <Button
                    disabled={setInternalHourlyRate.isPending}
                    onClick={() => {
                      setRateError(null);
                      setInternalHourlyRate
                        .mutateAsync({
                          id: selected.id,
                          hourlyRate: rateDraft === null ? null : rateDraft.toFixed(6),
                          ...(rateEffectiveFrom.trim() ? { effectiveFrom: rateEffectiveFrom.trim() } : {}),
                        })
                        .then(() => {
                          setRateDraft(null);
                          setRateEffectiveFrom("");
                        })
                        .catch((err: unknown) =>
                          setRateError(err instanceof ApiError ? err.message : t("asset.rateCouldNotBeSaved")),
                        );
                    }}
                  >
                    {t("asset.saveRate")}
                  </Button>
                </div>
                <p className="mt-[6px] text-[11.5px] text-ink-muted">{t("asset.internalHourlyRateAudited")}</p>
                {rateError ? <p className="mt-[6px] text-[11.5px] font-semibold text-danger-ink">{rateError}</p> : null}
                <div className="mt-[10px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{t("asset.rateHistory")}</div>
                  {selected.rateHistory.length === 0 ? (
                    <p className="mt-[4px] text-[11.5px] text-ink-muted">{t("asset.rateHistoryEmpty")}</p>
                  ) : (
                    <ul className="mt-[4px] flex flex-col gap-[3px]">
                      {[...selected.rateHistory].reverse().map((row) => (
                        <li
                          key={`${row.effectiveFrom}-${row.setAt}`}
                          className="flex items-baseline justify-between gap-[10px] text-[11.5px] text-ink-muted"
                        >
                          <span className="mz-num">{row.effectiveFrom}</span>
                          <MoneyDisplay value={toMajor(row.hourlyRate)} className="font-semibold text-ink" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.accumulatedDepreciation")}</div>
                <MoneyDisplay value={toMajor(selected.accumulatedDepreciation)} className="mt-[5px] text-[14px] font-bold" />
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("asset.bookValue")}</div>
                <MoneyDisplay value={bookValue(selected)} className="mt-[5px] text-[14px] font-bold text-brand" />
              </div>
            </Card>
            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.notes")}</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.notes}</div>
              </Card>
            ) : null}
            {selected.status !== "disposed" ? (
              <Card className="p-[15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("assets.disposeHint")}</div>
                {disposeOpen ? (
                  <div className="mt-[12px] flex flex-col gap-[10px]">
                    <TextField label={t("assets.disposeDate")} value={disposeDate} onChange={setDisposeDate} placeholder="YYYY-MM-DD" />
                    <div>
                      <div className="mb-[5px] text-[11px] font-semibold text-ink-faint">{t("assets.disposeProceeds")}</div>
                      <MoneyInput
                        aria-label={t("assets.disposeProceeds")}
                        value={disposeProceeds}
                        onChange={setDisposeProceeds}
                      />
                    </div>
                    <SelectField
                      label={t("assets.disposeProceedsAccount")}
                      value={disposeProceedsAccountId}
                      onChange={setDisposeProceedsAccountId}
                      options={proceedsAccountOptions}
                    />
                    {disposeError ? <p className="text-[12px] font-semibold text-danger-ink">{disposeError}</p> : null}
                    <div className="flex gap-[8px]">
                      <Button type="button" onClick={() => setDisposeOpen(false)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        disabled={disposeAsset.isPending}
                        onClick={async () => {
                          setDisposeError(null);
                          try {
                            await disposeAsset.mutateAsync({
                              id: selected.id,
                              date: disposeDate,
                              proceeds: disposeProceeds ? String(disposeProceeds) : undefined,
                              proceedsAccountId: disposeProceeds ? disposeProceedsAccountId : null,
                            });
                            setDisposeOpen(false);
                            setDisposeProceeds(null);
                            setSelectedId(null);
                          } catch (err) {
                            setDisposeError(err instanceof Error ? err.message : t("api.theAssetCouldNotBeDisposed"));
                          }
                        }}
                      >
                        {t("assets.disposeConfirm")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" className="mt-[10px]" onClick={() => setDisposeOpen(true)}>
                    {t("assets.dispose")}
                  </Button>
                )}
              </Card>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("asset.registerAnAsset")} description={t("asset.coreAssetDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("asset.identityAndClassification")}</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label={t("asset.arabicName")}
                value={draft.nameAr}
                onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
                placeholder={t("asset.eGMainDeliveryVan")}
              />
              <TextField label={t("asset.assetName")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
              <TextField label={t("asset.assetCode2")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} />
              <SelectField
                label={t("asset.category")}
                value={draft.categoryId}
                onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))}
                options={[{ value: "", label: t("asset.chooseACategory") }, ...categories.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameAr}` }))]}
              />
              <SelectField
                label={t("asset.assetScope2")}
                value={draft.scope}
                onChange={(v) => setDraft((d) => ({ ...d, scope: v as AssetScopeDTO }))}
                options={SCOPE_VALUES.map((value) => ({ value, label: t(SCOPE_KEY[value]) }))}
              />
              {draft.scope === "branch" ? (
                <SelectField
                  label={t("asset.branch2")}
                  value={draft.branchId}
                  onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
                  options={[{ value: "", label: t("asset.chooseABranch") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                  hint={t("asset.anAssetTiedToOne")}
                />
              ) : null}
              {draft.scope === "warehouse" ? (
                <TextField label={t("common.warehouse")} value={draft.warehouseId} onChange={(v) => setDraft((d) => ({ ...d, warehouseId: v }))} />
              ) : null}
              <EntityPicker
                label={t("asset.assignedProject")}
                value={project}
                onChange={setProject}
                options={projectOptions}
                placeholder={t("common.noProject")}
                emptyMessage={t("common.noProject")}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("asset.acquisition")}</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label={t("asset.acquiredOn2")}
                value={draft.acquisitionDate}
                onChange={(v) => setDraft((d) => ({ ...d, acquisitionDate: v }))}
                placeholder="YYYY-MM-DD"
              />
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("asset.acquisitionCost2")}</div>
                <MoneyInput aria-label={t("asset.acquisitionCost2")} value={draft.acquisitionCost} onChange={(v) => setDraft((d) => ({ ...d, acquisitionCost: v }))} />
              </div>
              <TextField
                label={t("asset.depreciationStarts")}
                value={draft.depreciationStartDate}
                onChange={(v) => setDraft((d) => ({ ...d, depreciationStartDate: v }))}
                placeholder="YYYY-MM-DD"
                hint={t("asset.defaultsToTheAcquisitionDate")}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("asset.depreciationAndValue")}</h3>
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("asset.depreciationMethod")}</div>
                <div className="rounded-md border border-border bg-surface-2 px-[13px] py-[9px] text-[13px] text-ink-muted">{t("asset.straightLine")}</div>
              </div>
              <NumberField
                label={t("asset.usefulLifeMonths2")}
                value={draft.usefulLifeMonths}
                onChange={(v) => setDraft((d) => ({ ...d, usefulLifeMonths: v }))}
                min={1}
                step={1}
              />
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("asset.residualValue")}</div>
                <MoneyInput aria-label={t("asset.residualValue")} value={draft.salvageValue} onChange={(v) => setDraft((d) => ({ ...d, salvageValue: v }))} />
              </div>
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("asset.internalHourlyRate")}</div>
                <MoneyInput
                  aria-label={t("asset.internalHourlyRate")}
                  value={draft.internalHourlyRate}
                  onChange={(v) => setDraft((d) => ({ ...d, internalHourlyRate: v }))}
                />
                <p className="mt-[6px] text-[11.5px] text-ink-muted">{t("asset.internalHourlyRateHint")}</p>
              </div>
            </div>
          </div>

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
