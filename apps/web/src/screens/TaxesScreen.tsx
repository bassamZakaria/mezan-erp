import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, StatusPill, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { ETA_VAT_SUBTYPE_DEFINITIONS, getEtaVatSubTypeLabel, type EtaVatSubType } from "@mezan/domain";
import type { TaxCalculationTypeDTO, TaxRateDTO, TaxRateStatusDTO } from "@mezan/contracts";
import { useCreateTaxRate, useTaxRates, useUpdateTaxRate } from "../data/hooks";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * الضرائب (Taxes) — docs/catalog/04 §"الضرائب". List + add/edit dialog with
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

export function TaxesScreen() {
  const { t } = useAppTranslation();
  const query = useTaxRates();
  const createTaxRate = useCreateTaxRate();
  const updateTaxRate = useUpdateTaxRate();
  const taxes = query.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaxRateStatusDTO | "all">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaxDraft>(BLANK_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = taxes;
    if (statusFilter !== "all") rows = rows.filter((tax) => tax.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((tax) => tax.name.toLowerCase().includes(q) || tax.code.toLowerCase().includes(q));
    }
    return rows;
  }, [taxes, statusFilter, search]);

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setFormError(null);
    setFormOpen(true);
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
    {
      key: "actions",
      header: "",
      render: (tax) => (
        <Button size="sm" onClick={() => openEditForm(tax)}>
          {t("common.edit")}
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("taxes.taxesCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<TaxRateDTO>
        eyebrow={t("eyebrow.accounting.taxes")}
        title={t("taxes.taxes")}
        description={t("taxes.theseTaxesApplyWhenInvoices")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("taxes.addTax")}
          </Button>
        }
        stats={[
          { label: t("taxes.totalTaxes"), value: <span className="mz-num">{taxes.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{taxes.filter((tax) => tax.status === "active").length}</span> },
          { label: t("common.inactive"), value: <span className="mz-num">{taxes.filter((tax) => tax.status === "inactive").length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("taxes.search")}
        filterBarExtra={
          <SelectField
            label=""
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as TaxRateStatusDTO | "all")}
            options={[
              { value: "all", label: t("taxes.allStatuses") },
              { value: "active", label: t("common.active") },
              { value: "inactive", label: t("common.inactive") },
            ]}
          />
        }
        columns={columns}
        rows={filtered}
        rowKey={(tax) => tax.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{taxes.length}</span> {t("taxes.taxes2")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("taxes.noMatchingTaxes")}</div>}
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
    </div>
  );
}
