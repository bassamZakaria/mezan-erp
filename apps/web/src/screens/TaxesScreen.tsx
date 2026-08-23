import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, StatusPill, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { ETA_VAT_SUBTYPE_DEFINITIONS, getEtaVatSubTypeLabel, type EtaVatSubType } from "@mezan/domain";
import type { TaxCalculationTypeDTO, TaxRateDTO, TaxRateStatusDTO } from "@mezan/contracts";
import { useCreateTaxRate, useTaxRates, useUpdateTaxRate } from "../data/hooks";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";

/**
 * الضرائب (Taxes) — docs/catalog/04 §"الضرائب". List + add/edit dialog with
 * GL posting-account overrides and the Egyptian ETA e-invoice VAT sub-type
 * mapping (V001–V009).
 */

const CALC_TYPE_LABEL: Record<TaxCalculationTypeDTO, string> = {
  exclusive: "غير شاملة (تضاف على السعر)",
  inclusive: "شاملة (مضمنة في السعر)",
};

const STATUS_LABEL: Record<TaxRateStatusDTO, string> = { active: "نشط", inactive: "غير نشط" };
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

function validateDraft(draft: TaxDraft, existing: TaxRateDTO[], editingId: string | null): string | null {
  const code = draft.code.trim();
  if (code === "") return "رمز الضريبة مطلوب.";
  if (!editingId && existing.some((t) => t.code === code)) {
    return `رمز الضريبة "${code}" مستخدم بالفعل — اختر رمزاً آخر.`;
  }
  const rate = Number(draft.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return "نسبة الضريبة يجب أن تكون رقماً بين 0 و 100.";
  }
  return null;
}

export function TaxesScreen() {
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
    if (statusFilter !== "all") rows = rows.filter((t) => t.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q));
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
      setFormError(error);
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
      setFormError(err instanceof Error ? err.message : "تعذر حفظ الضريبة");
    }
  }

  const columns: DocumentListColumn<TaxRateDTO>[] = [
    {
      key: "name",
      header: "الاسم",
      render: (t) => (
        <div>
          <div className="flex items-center gap-[7px] font-semibold text-ink">
            {t.name}
            {t.isDefault ? <StatusPill label="الافتراضي" tone="info" /> : null}
          </div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{t.code}</div>
        </div>
      ),
    },
    { key: "rate", header: "نسبة الضريبة (%)", render: (t) => <span className="mz-num">{t.rate.toFixed(2)}%</span> },
    { key: "type", header: "النوع", render: (t) => CALC_TYPE_LABEL[t.calculationType] },
    { key: "status", header: "الحالة", render: (t) => <StatusPill label={STATUS_LABEL[t.status]} tone={STATUS_TONE[t.status]} /> },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <Button size="sm" onClick={() => openEditForm(t)}>
          تعديل
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الضرائب.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<TaxRateDTO>
        eyebrow="Accounting · Taxes"
        title="الضرائب"
        description="تستخدم هذه الضرائب عند إنشاء الفواتير. إذا لم تحدد ضريبة للصنف، تطبق الضريبة الافتراضية تلقائياً."
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة ضريبة
          </Button>
        }
        stats={[
          { label: "إجمالي الضرائب", value: <span className="mz-num">{taxes.length}</span> },
          { label: "نشط", value: <span className="mz-num">{taxes.filter((t) => t.status === "active").length}</span> },
          { label: "غير نشط", value: <span className="mz-num">{taxes.filter((t) => t.status === "inactive").length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث"
        filterBarExtra={
          <SelectField
            label=""
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as TaxRateStatusDTO | "all")}
            options={[
              { value: "all", label: "كل الحالات" },
              { value: "active", label: "نشط" },
              { value: "inactive", label: "غير نشط" },
            ]}
          />
        }
        columns={columns}
        rows={filtered}
        rowKey={(t) => t.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{taxes.length}</span> ضريبة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد ضرائب مطابقة</div>}
      />

      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "تعديل ضريبة" : "إضافة ضريبة"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label="اسم الضريبة *" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField
            label="رمز الضريبة *"
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
            disabled={editingId !== null}
            placeholder="VAT14"
          />
          <TextField label="نسبة الضريبة (%) *" value={draft.rate} onChange={(v) => setDraft((d) => ({ ...d, rate: v }))} />
          <SelectField
            label="النوع"
            value={draft.calculationType}
            onChange={(v) => setDraft((d) => ({ ...d, calculationType: v as TaxCalculationTypeDTO }))}
            options={[
              { value: "exclusive", label: CALC_TYPE_LABEL.exclusive },
              { value: "inclusive", label: CALC_TYPE_LABEL.inclusive },
            ]}
          />
          <ToggleField label="ضريبة افتراضية" checked={draft.isDefault} onChange={(v) => setDraft((d) => ({ ...d, isDefault: v }))} />

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">حسابات الترحيل</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label="حساب الضريبة المستحقة (المبيعات)"
                value={draft.outputTaxAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, outputTaxAccountId: v }))}
                placeholder="تلقائي (الافتراضي 2200)"
              />
              <TextField
                label="حساب ضريبة المدخلات (المشتريات)"
                value={draft.inputTaxAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, inputTaxAccountId: v }))}
                placeholder="تلقائي (الافتراضي 1400)"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">تصنيف الفاتورة الإلكترونية (ETA)</h3>
            <SelectField
              label="النوع الفرعي لضريبة القيمة المضافة"
              value={draft.etaSubType}
              onChange={(v) => setDraft((d) => ({ ...d, etaSubType: v as EtaVatSubType }))}
              options={ETA_VAT_SUBTYPE_DEFINITIONS.map((d) => ({ value: d.code, label: getEtaVatSubTypeLabel(d.code) }))}
            />
          </div>

          {editingId ? (
            <SelectField
              label="الحالة"
              value={draft.status}
              onChange={(v) => setDraft((d) => ({ ...d, status: v as TaxRateStatusDTO }))}
              options={[
                { value: "active", label: "نشط" },
                { value: "inactive", label: "غير نشط" },
              ]}
            />
          ) : null}

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? "حفظ" : "إضافة"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
