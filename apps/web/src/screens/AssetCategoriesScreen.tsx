import { useEffect, useState, type FormEvent } from "react";
import { DocumentList, EmptyState, StatusPill, Card, Button, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { AssetCategoryDTO, CreateAssetCategoryDTO } from "@mezan/contracts";
import { ApiError, useAssetCategories, useCreateAssetCategory } from "../data/hooks";
import { NumberField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { matchesSearch } from "@mezan/domain";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** تصنيفات الأصول (Asset Categories) — docs/archive/catalog/07 §"تصنيفات الأصول". List + add panel; API supports list+create only. */

const DEPRECIATION_METHOD_KEY = "assetCategories.straightLine" as const;
const STATUS_TONE: Record<"active" | "inactive", PillTone> = { active: "success", inactive: "neutral" };
const PAGE_SIZES = [10, 25, 50, 100] as const;

interface AssetCategoryDraft {
  code: string;
  nameAr: string;
  defaultUsefulLifeMonths: number;
  defaultSalvagePercent: number;
  assetAccountId: string;
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
  gainOnDisposalAccountId: string;
  lossOnDisposalAccountId: string;
}

function blankDraft(): AssetCategoryDraft {
  return {
    code: "",
    nameAr: "",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 0,
    assetAccountId: "",
    depreciationExpenseAccountId: "",
    accumulatedDepreciationAccountId: "",
    gainOnDisposalAccountId: "",
    lossOnDisposalAccountId: "",
  };
}

/** Returns a catalogue KEY (with any placeholders), so the caller decides the locale. */
type ValidationError = { key: AppTranslationKey; params?: Record<string, string | number> };

function validateDraft(draft: AssetCategoryDraft, existing: AssetCategoryDTO[]): ValidationError | null {
  const code = draft.code.trim();
  if (code === "") return { key: "assetCategories.codeRequired" as const };
  if (existing.some((c) => c.code === code)) return { key: "assetCategories.codeInUse" as const, params: { code } };
  if (draft.nameAr.trim() === "") return { key: "assetCategories.nameRequired" as const };
  if (!Number.isFinite(draft.defaultUsefulLifeMonths) || draft.defaultUsefulLifeMonths <= 0) {
    return { key: "assetCategories.lifePositive" as const };
  }
  if (!Number.isFinite(draft.defaultSalvagePercent) || draft.defaultSalvagePercent < 0 || draft.defaultSalvagePercent > 100) {
    return { key: "assetCategories.salvageRange" as const };
  }
  return null;
}

export function AssetCategoriesScreen() {
  const { t } = useAppTranslation();
  const query = useAssetCategories();
  const createAssetCategory = useCreateAssetCategory();
  const categories = query.data ?? [];

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | "active" | "inactive",
    (next: string) => void,
  ];
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AssetCategoryDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = categories.filter((c) => {
    if (statusFilter === "active" && !c.active) return false;
    if (statusFilter === "inactive" && c.active) return false;
    if (search.trim() === "") return true;
    const q = search.trim().toLowerCase();
    return matchesSearch(search, c.code, c.nameAr);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, categories);
    if (error) {
      setFormError(t(error.key, error.params));
      return;
    }
    setFormError(null);
    const body: CreateAssetCategoryDTO = {
      id: crypto.randomUUID(),
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      defaultUsefulLifeMonths: draft.defaultUsefulLifeMonths,
      defaultSalvagePercent: draft.defaultSalvagePercent,
      assetAccountId: draft.assetAccountId.trim() === "" ? null : draft.assetAccountId.trim(),
      depreciationExpenseAccountId: draft.depreciationExpenseAccountId.trim() === "" ? null : draft.depreciationExpenseAccountId.trim(),
      accumulatedDepreciationAccountId: draft.accumulatedDepreciationAccountId.trim() === "" ? null : draft.accumulatedDepreciationAccountId.trim(),
      gainOnDisposalAccountId: draft.gainOnDisposalAccountId.trim() === "" ? null : draft.gainOnDisposalAccountId.trim(),
      lossOnDisposalAccountId: draft.lossOnDisposalAccountId.trim() === "" ? null : draft.lossOnDisposalAccountId.trim(),
    };
    try {
      await createAssetCategory.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("assetCategories.theCategoryCouldNotBe"));
    }
  }

  const columns: DocumentListColumn<AssetCategoryDTO>[] = [
    { key: "code", header: t("assetCategories.categoryCode"), render: (c) => <span className="mz-num font-semibold text-ink">{c.code}</span> },
    { key: "nameAr", header: t("common.name"), render: (c) => <span className="font-semibold text-ink">{c.nameAr}</span> },
    { key: "method", header: t("assetCategories.defaultDepreciationMethod"), render: () => t(DEPRECIATION_METHOD_KEY) },
    { key: "usefulLife", header: t("assetCategories.defaultUsefulLifeMonths"), align: "end", render: (c) => <span className="mz-num">{c.defaultUsefulLifeMonths}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (c) => <StatusPill label={c.active ? t("common.active") : t("common.inactive")} tone={STATUS_TONE[c.active ? "active" : "inactive"]} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("assetCategories.assetCategoriesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<AssetCategoryDTO>
        title={t("assetCategories.assetCategories")}
        description={t("assetCategories.theDepreciationDefaultsAndAccount")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("assetCategories.addCategory")}
          </Button>
        }
        statusChips={[
          { key: "all", label: t("common.all"), count: categories.length },
          { key: "active", label: t("common.active"), count: categories.filter((c) => c.active).length },
          { key: "inactive", label: t("common.inactive"), count: categories.filter((c) => !c.active).length },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key as "all" | "active" | "inactive");
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("assetCategories.searchByCategoryCodeOr")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(c) => c.id}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{categories.length}</span> {t("assetCategories.categories")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("assetCategories.nothingToShow")}
            description={t("assetCategories.emptyBody")}
            action={{ label: t("assetCategories.addCategory"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("assetCategories.addCategory")} description={t("assetCategories.theCategorySCoreDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("assetCategories.identity")}</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField label={t("assetCategories.categoryCode2")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="FA-01" />
              <TextField label={t("assetCategories.categoryName")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[4px] font-display text-[13px] font-bold text-ink">{t("assetCategories.depreciationDefaults")}</h3>
            <p className="mb-[10px] text-[11.5px] text-ink-faint">
              {t("assetCategories.theseValuesAreAppliedAutomatically")}
            </p>
            <div className="flex flex-col gap-[12px]">
              <NumberField
                label={t("assetCategories.defaultUsefulLifeMonths2")}
                value={draft.defaultUsefulLifeMonths}
                onChange={(v) => setDraft((d) => ({ ...d, defaultUsefulLifeMonths: v }))}
                min={1}
                step={1}
              />
              <NumberField
                label={t("assetCategories.defaultSalvageRate")}
                value={draft.defaultSalvagePercent}
                onChange={(v) => setDraft((d) => ({ ...d, defaultSalvagePercent: v }))}
                min={0}
                max={100}
                step={0.5}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[4px] font-display text-[13px] font-bold text-ink">{t("assetCategories.accountMapping")}</h3>
            <p className="mb-[10px] text-[11.5px] text-ink-faint">
              {t("assetCategories.chooseTheLedgerAccountsAn")}
            </p>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label={t("assetCategories.defaultAssetAccountCode")}
                value={draft.assetAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, assetAccountId: v }))}
                placeholder="1500"
                hint={t("assetCategories.leaveEmptyToUseThe")}
              />
              <TextField
                label={t("assetCategories.defaultDepreciationExpenseAccountCode")}
                value={draft.depreciationExpenseAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, depreciationExpenseAccountId: v }))}
                placeholder="5400"
                hint={t("assetCategories.leaveEmptyToUseThe2")}
              />
              <TextField
                label={t("assetCategories.defaultAccumulatedDepreciationAccountCode")}
                value={draft.accumulatedDepreciationAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, accumulatedDepreciationAccountId: v }))}
                placeholder="1590"
                hint={t("assetCategories.leaveEmptyToUseThe3")}
              />
              <TextField
                label={t("assetCategories.defaultGainOnDisposalAccount")}
                value={draft.gainOnDisposalAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, gainOnDisposalAccountId: v }))}
                placeholder="4500"
                hint={t("assetCategories.leaveEmptyToUseThe4")}
              />
              <TextField
                label={t("assetCategories.defaultLossOnDisposalAccount")}
                value={draft.lossOnDisposalAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, lossOnDisposalAccountId: v }))}
                placeholder="5450"
                hint={t("assetCategories.leaveEmptyToUseThe5")}
              />
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
