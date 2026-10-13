import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  RowActionOutcome,
  DocumentList,
  EmptyState,
  RowMenu,
  StatusPill,
  Button,
  Card,
  SidePanel,
  type DocumentListColumn,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { ETA_VAT_SUBTYPE_DEFINITIONS, getEtaVatSubTypeLabel, type EtaVatSubType } from "@mezan/domain";
import type { TaxCalculationTypeDTO, TaxRateDTO, TaxRateStatusDTO } from "@mezan/contracts";
import { useCreateTaxGroup, useCreateTaxRate, useTaxGroups, useTaxRates, useUpdateTaxRate } from "../data/hooks";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/**
 * الضرائب (Taxes) — docs/archive/catalog/04 §"الضرائب". List + add/edit dialog with
 * GL posting-account overrides and the Egyptian ETA e-invoice VAT sub-type
 * mapping (V001–V009).
 */

const CALC_TYPE_KEY: Record<TaxCalculationTypeDTO, AppTranslationKey> = {
  exclusive: "taxes.calc.exclusive",
  inclusive: "taxes.calc.inclusive",
};

const STATUS_KEY: Record<TaxRateStatusDTO, AppTranslationKey> = { active: "taxes.status.active", inactive: "taxes.status.inactive" };
const STATUS_TONE: Record<TaxRateStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

interface TaxDraft {
  code: string;
  name: string;
  rate: string;
  calculationType: TaxCalculationTypeDTO;
  isDefault: boolean;
  outputTaxAccountId: string;
  inputTaxAccountId: string;
  etaSubType: EtaVatSubType;
  status: TaxRateStatusDTO;
}

const BLANK_DRAFT: TaxDraft = {
  code: "",
  name: "",
  rate: "0",
  calculationType: "exclusive",
  isDefault: false,
  outputTaxAccountId: "",
  inputTaxAccountId: "",
  etaSubType: "auto",
  status: "active",
};

function draftFromTax(tax: TaxRateDTO): TaxDraft {
  return {
    code: tax.code,
    name: tax.name,
    rate: String(tax.rate),
    calculationType: tax.calculationType,
    isDefault: tax.isDefault,
    outputTaxAccountId: tax.outputTaxAccountId ?? "",
    inputTaxAccountId: tax.inputTaxAccountId ?? "",
    etaSubType: tax.etaSubType,
    status: tax.status,
  };
}

/** Returns a catalogue KEY (with any placeholders), so the caller decides the locale. */
type ValidationError = { key: AppTranslationKey; params?: Record<string, string | number> };

function validateDraft(draft: TaxDraft, existing: TaxRateDTO[], editingId: string | null): ValidationError | null {
  const code = draft.code.trim();
  if (code === "") return { key: "taxes.codeRequired" as const };
  if (!editingId && existing.some((tax) => tax.code === code)) {
    return { key: "taxes.codeInUse" as const, params: { code } };
  }
  const rate = Number(draft.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return { key: "taxes.rateRange" as const };
  }
  return null;
}

/**
 * مجموعات الضرائب (R6.4) — more than one tax on the same line.
 *
 * The table shows each component separately rather than one combined
 * percentage, because the parts are owed to different authorities: a VAT
 * return cannot be produced from a figure with two taxes melted into it. A
 * compounding member charges on the running total, which is why VAT 14 plus a
 * compounding table tax of 5 comes to 19.7%, not 19%.
 */
function TaxGroupsTab() {
  const { t, locale } = useAppTranslation();
  const groupsQuery = useTaxGroups();
  const createGroup = useCreateTaxGroup();
  const rates = useTaxRates().data ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: "", nameAr: "", nameEn: "" });
  const [picked, setPicked] = useState<{ taxRateId: string; compounding: boolean }[]>([]);

  const groups = groupsQuery.data ?? [];
  const rateName = (id: string) => rates.find((rate) => rate.id === id)?.name ?? id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (picked.length === 0) {
      setError(t("taxGroups.pickAtLeastOne"));
      return;
    }
    try {
      await createGroup.mutateAsync({
        id: crypto.randomUUID(),
        code: draft.code.trim(),
        nameAr: draft.nameAr.trim(),
        nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
        members: picked,
      });
      setFormOpen(false);
      setDraft({ code: "", nameAr: "", nameEn: "" });
      setPicked([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("taxes.taxesCouldNotBeLoaded"));
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <p className="max-w-[74ch] text-[12.5px] text-ink-muted">{t("taxGroups.description")}</p>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          {t("taxGroups.add")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">
          {t("taxGroups.empty")}
        </div>
      ) : (
        groups.map((group) => (
          <Card key={group.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-border bg-surface-2 px-[16px] py-[9px]">
              <span className="text-[12.5px] font-bold text-ink">
                <span className="mz-num">{group.code}</span> · {locale === "en" ? (group.nameEn ?? group.nameAr) : group.nameAr}
              </span>
              <span className="text-[12px] text-ink-muted">
                {t("taxGroups.effective")} <span className="mz-num font-semibold text-ink">{group.effectivePercent}%</span>
              </span>
            </div>
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="text-[11px] font-semibold text-ink-faint">
                <tr>
                  <th className="px-[15px] py-[8px] text-start">{t("taxGroups.members")}</th>
                  <th className="px-[15px] py-[8px] text-end">{t("taxes.taxRate")}</th>
                  <th className="px-[15px] py-[8px] text-start">{t("taxGroups.compounding")}</th>
                  <th className="px-[15px] py-[8px] text-end">{t("taxGroups.effective")}</th>
                </tr>
              </thead>
              <tbody>
                {group.components.map((component) => (
                  <tr key={component.taxRateId} className="border-t border-border">
                    <td className="px-[15px] py-[9px] text-ink">{rateName(component.taxRateId)}</td>
                    <td className="mz-num px-[15px] py-[9px] text-end">{component.ratePercent}%</td>
                    <td className="px-[15px] py-[9px] text-ink-muted">
                      {component.compounding ? t("taxGroups.compounding") : t("taxGroups.onBase")}
                    </td>
                    <td className="mz-num px-[15px] py-[9px] text-end font-semibold">{component.effectivePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("taxGroups.newGroup")}>
        <form className="flex flex-col gap-[12px]" onSubmit={submit}>
          {error ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}
          <TextField label={t("taxGroups.code")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} />
          <TextField label={t("taxGroups.name")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("taxGroups.nameEn")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />

          <div className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-ink">{t("taxGroups.members")}</span>
            {rates.map((rate) => {
              const member = picked.find((m) => m.taxRateId === rate.id);
              return (
                <div key={rate.id} className="flex items-center justify-between gap-[10px] rounded-md border border-border px-[12px] py-[8px]">
                  <ToggleField
                    label={`${rate.name} · ${rate.rate}%`}
                    checked={member !== undefined}
                    onChange={(checked) =>
                      setPicked((prev) =>
                        checked
                          ? [...prev, { taxRateId: rate.id, compounding: false }]
                          : prev.filter((m) => m.taxRateId !== rate.id),
                      )
                    }
                  />
                  {member ? (
                    <ToggleField
                      label={t("taxGroups.compounding")}
                      checked={member.compounding}
                      onChange={(checked) =>
                        setPicked((prev) =>
                          prev.map((m) => (m.taxRateId === rate.id ? { ...m, compounding: checked } : m)),
                        )
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function TaxesScreen() {
  const { t } = useAppTranslation();
  const query = useTaxRates();
  const createTaxRate = useCreateTaxRate();
  const updateTaxRate = useUpdateTaxRate();
  const taxes = query.data ?? EMPTY;

  const [searchText, setSearchText, search] = useUrlSearch();
  const [activeTab, setActiveTab] = useState<"rates" | "groups">("rates");
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    TaxRateStatusDTO | "all",
    (next: string) => void,
  ];
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaxDraft>(BLANK_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = taxes;
    if (statusFilter !== "all") rows = rows.filter((tax) => tax.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((tax) => tax.name.toLowerCase().includes(q) || tax.code.toLowerCase().includes(q));
    }
    return rows;
  }, [taxes, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = statusFilter === "all" ? 0 : 1;

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setFormError(null);
    setFormOpen(true);
  }

  async function deactivateTax(tax: TaxRateDTO) {
    if (pendingId) return;
    setPendingId(tax.id);
    setActionError(null);
    try {
      await updateTaxRate.mutateAsync({ id: tax.id, patch: { status: "inactive" } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("taxes.theTaxCouldNotBe"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  function openEditForm(tax: TaxRateDTO) {
    setEditingId(tax.id);
    setDraft(draftFromTax(tax));
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, taxes, editingId);
    if (error) {
      setFormError(t(error.key, error.params));
      return;
    }
    setFormError(null);
    const rate = Number(draft.rate);
    const outputTaxAccountId = draft.outputTaxAccountId.trim() === "" ? null : draft.outputTaxAccountId.trim();
    const inputTaxAccountId = draft.inputTaxAccountId.trim() === "" ? null : draft.inputTaxAccountId.trim();

    try {
      if (editingId) {
        // At most one default tax rate at a time — enforced server-side (@mezan/domain's updateTaxRate).
        await updateTaxRate.mutateAsync({
          id: editingId,
          patch: {
            name: draft.name.trim(),
            rate,
            calculationType: draft.calculationType,
            isDefault: draft.isDefault,
            outputTaxAccountId,
            inputTaxAccountId,
            etaSubType: draft.etaSubType,
            status: draft.status,
          },
        });
      } else {
        await createTaxRate.mutateAsync({
          id: crypto.randomUUID(),
          code: draft.code.trim(),
          name: draft.name.trim(),
          rate,
          calculationType: draft.calculationType,
          isDefault: draft.isDefault,
          outputTaxAccountId,
          inputTaxAccountId,
          etaSubType: draft.etaSubType,
        });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("taxes.theTaxCouldNotBe"));
    }
  }

  const columns: DocumentListColumn<TaxRateDTO>[] = [
    {
      key: "name",
      header: t("common.name"),
      render: (tax) => (
        <div>
          <div className="flex items-center gap-[7px] font-semibold text-ink">
            {tax.name}
            {tax.isDefault ? <StatusPill label={t("taxes.default")} tone="info" /> : null}
          </div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{tax.code}</div>
        </div>
      ),
    },
    { key: "rate", header: t("taxes.taxRate"), render: (tax) => <span className="mz-num">{tax.rate.toFixed(2)}%</span> },
    { key: "type", header: t("common.type"), render: (tax) => t(CALC_TYPE_KEY[tax.calculationType]) },
    { key: "status", header: t("common.status"), render: (tax) => <StatusPill label={t(STATUS_KEY[tax.status])} tone={STATUS_TONE[tax.status]} /> },
  ];

  return (
    <div className="w-full">
      <div className="mb-[14px] flex gap-[6px] border-b border-border">
        {(["rates", "groups"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-[14px] py-[8px] text-[12.5px] font-semibold transition-colors ${
              activeTab === tab ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab === "rates" ? t("taxes.tab.rates") : t("taxes.tab.groups")}
          </button>
        ))}
      </div>

      {activeTab === "groups" ? <TaxGroupsTab /> : null}
      {activeTab === "rates" ? (
      <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("taxes.taxesCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}
      <DocumentList<TaxRateDTO>
        title={t("taxes.taxes")}
        description={t("taxes.theseTaxesApplyWhenInvoices")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("taxes.addTax")}
          </Button>
        }
        listKey="taxes"
        statsCollapsible
        stats={[
          { label: t("taxes.totalTaxes"), value: <span className="mz-num">{taxes.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{taxes.filter((tax) => tax.status === "active").length}</span> },
          { label: t("common.inactive"), value: <span className="mz-num">{taxes.filter((tax) => tax.status === "inactive").length}</span> },
        ]}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("taxes.search")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <SelectField
            label=""
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v as TaxRateStatusDTO | "all");
              setPage(1);
            }}
            options={[
              { value: "all", label: t("taxes.allStatuses") },
              { value: "active", label: t("common.active") },
              { value: "inactive", label: t("common.inactive") },
            ]}
          />
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(tax) => tax.id}
        rowAction={(tax) => {
          const items: RowMenuItem[] = [{ key: "edit", label: t("common.edit"), onSelect: () => openEditForm(tax) }];
          if (tax.status === "active") {
            items.push({
              key: "deactivate",
              label: t("taxes.deactivate"),
              tone: "danger",
              disabled: pendingId === tax.id,
              onSelect: () => deactivateTax(tax),
            });
          }
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: tax.name })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{taxes.length}</span> {t("taxes.taxes2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("taxes.noMatchingTaxes")}
            description={t("taxes.emptyBody")}
            action={{ label: t("taxes.addTax"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? t("taxes.editTax") : t("taxes.addTax")}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("taxes.taxName")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField
            label={t("taxes.taxCode")}
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
            disabled={editingId !== null}
            placeholder="VAT14"
          />
          <TextField label={t("taxes.taxRate2")} value={draft.rate} onChange={(v) => setDraft((d) => ({ ...d, rate: v }))} />
          <SelectField
            label={t("common.type")}
            value={draft.calculationType}
            onChange={(v) => setDraft((d) => ({ ...d, calculationType: v as TaxCalculationTypeDTO }))}
            options={[
              { value: "exclusive", label: t(CALC_TYPE_KEY.exclusive) },
              { value: "inclusive", label: t(CALC_TYPE_KEY.inclusive) },
            ]}
          />
          <ToggleField label={t("taxes.defaultTax")} checked={draft.isDefault} onChange={(v) => setDraft((d) => ({ ...d, isDefault: v }))} />

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("taxes.postingAccounts")}</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label={t("taxes.taxPayableAccountSales")}
                value={draft.outputTaxAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, outputTaxAccountId: v }))}
                placeholder={t("taxes.automaticDefault2200")}
              />
              <TextField
                label={t("taxes.inputTaxAccountPurchases")}
                value={draft.inputTaxAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, inputTaxAccountId: v }))}
                placeholder={t("taxes.automaticDefault1400")}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("taxes.eInvoiceClassificationEta")}</h3>
            <SelectField
              label={t("taxes.vatSubtype")}
              value={draft.etaSubType}
              onChange={(v) => setDraft((d) => ({ ...d, etaSubType: v as EtaVatSubType }))}
              options={ETA_VAT_SUBTYPE_DEFINITIONS.map((d) => ({ value: d.code, label: getEtaVatSubTypeLabel(d.code) }))}
            />
          </div>

          {editingId ? (
            <SelectField
              label={t("common.status")}
              value={draft.status}
              onChange={(v) => setDraft((d) => ({ ...d, status: v as TaxRateStatusDTO }))}
              options={[
                { value: "active", label: t("common.active") },
                { value: "inactive", label: t("common.inactive") },
              ]}
            />
          ) : null}

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? t("common.save") : t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
      </>
      ) : null}
    </div>
  );
}
