import { useMemo, useRef, useState } from "react";
import { Button, Card, StatusPill } from "@mezan/ui";
import { useItems, useSuppliers, useWarehouses } from "../data/hooks";
import {
  useCustomerImportCommit,
  useCustomerImportPreview,
  useHistoricalImportCommit,
  useHistoricalImportPreview,
  useItemImportCommit,
  useItemImportPreview,
  useOpeningBalanceImportCommit,
  useOpeningBalanceImportPreview,
  useSupplierImportCommit,
  useSupplierImportPreview,
} from "../data/migration-hooks";
import { guessColumnIndex, parseCsv, type ParsedCsv } from "./csv-utils";
import { SelectField, TextField } from "./form-controls";

/**
 * معالج نقل البيانات (Data-migration import wizard) — docs/catalog/09 "نقل
 * البيانات": customers, suppliers, items, item opening balances, and
 * historical purchase documents. Real backend end to end — the preview step
 * shows the user's ACTUAL uploaded rows and the backend's real per-row
 * validation, never a sample file; commit is all-or-nothing per batch (see
 * packages/api/src/data-migration-routes.ts's doc comment) and the result
 * step reports exactly what was written.
 *
 * Customers/suppliers/items/opening-balances have their own new
 * `/data-migration/*` routes. Historical purchase documents reuse the
 * EXISTING `/purchases/historical-import` routes built earlier — this wizard
 * is only the missing web wiring for that backend.
 */

type ImportKind = "customers" | "suppliers" | "items" | "opening_balances" | "purchase_documents";
type Step = "kind" | "upload" | "map" | "preview" | "done";

type FieldKind = "text" | "number" | "decimal" | "bool" | "enum";

interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly kind: FieldKind;
  readonly enumOptions?: readonly { value: string; label: string }[];
}

const KIND_OPTIONS: { key: ImportKind; label: string; description: string }[] = [
  { key: "customers", label: "العملاء", description: "استيراد قائمة عملاء جديدة من ملف CSV" },
  { key: "suppliers", label: "الموردون", description: "استيراد قائمة موردين جديدة من ملف CSV" },
  { key: "items", label: "الأصناف", description: "استيراد قائمة أصناف جديدة من ملف CSV" },
  { key: "opening_balances", label: "الأرصدة الافتتاحية", description: "استيراد كميات مخزون افتتاحية لمستودع واحد" },
  { key: "purchase_documents", label: "مستندات مشتريات سابقة", description: "أرشفة فواتير/مرتجعات مشتريات سابقة مستقرة" },
];

const CUSTOMER_FIELDS: FieldSpec[] = [
  { key: "code", label: "كود العميل", required: true, kind: "text" },
  { key: "nameAr", label: "اسم العميل", required: true, kind: "text" },
  { key: "nameEn", label: "الاسم بالإنجليزية", required: false, kind: "text" },
  { key: "phone", label: "الهاتف", required: false, kind: "text" },
  { key: "email", label: "البريد الإلكتروني", required: false, kind: "text" },
  { key: "contactPerson", label: "مسؤول التواصل", required: false, kind: "text" },
  { key: "taxNumber", label: "الرقم الضريبي", required: false, kind: "text" },
  { key: "category", label: "التصنيف", required: false, kind: "text" },
  { key: "notes", label: "ملاحظات", required: false, kind: "text" },
  { key: "paymentTermsDays", label: "مدة السداد (أيام)", required: false, kind: "number" },
  { key: "currency", label: "العملة", required: false, kind: "text" },
  { key: "openingBalance", label: "الرصيد الافتتاحي", required: false, kind: "decimal" },
  { key: "creditLimit", label: "حد الائتمان", required: false, kind: "decimal" },
  {
    key: "etaBuyerType",
    label: "نوع عميل الفاتورة الإلكترونية",
    required: false,
    kind: "enum",
    enumOptions: [
      { value: "auto", label: "تلقائي" },
      { value: "business", label: "منشأة" },
      { value: "individual", label: "فرد" },
    ],
  },
  { key: "nationalId", label: "الرقم القومي", required: false, kind: "text" },
];

const SUPPLIER_FIELDS: FieldSpec[] = [
  { key: "code", label: "كود المورد", required: true, kind: "text" },
  { key: "nameAr", label: "اسم المورد", required: true, kind: "text" },
  { key: "nameEn", label: "الاسم بالإنجليزية", required: false, kind: "text" },
  { key: "phone", label: "الهاتف", required: false, kind: "text" },
  { key: "email", label: "البريد الإلكتروني", required: false, kind: "text" },
  { key: "contactPerson", label: "مسؤول التواصل", required: false, kind: "text" },
  { key: "taxNumber", label: "الرقم الضريبي", required: false, kind: "text" },
  { key: "category", label: "التصنيف", required: false, kind: "text" },
  { key: "notes", label: "ملاحظات", required: false, kind: "text" },
  { key: "paymentTermsDays", label: "مدة السداد (أيام)", required: false, kind: "number" },
  { key: "currency", label: "العملة", required: false, kind: "text" },
  { key: "openingBalance", label: "الرصيد الافتتاحي", required: false, kind: "decimal" },
  { key: "addressCity", label: "المدينة", required: false, kind: "text" },
  { key: "addressDistrict", label: "الحي", required: false, kind: "text" },
  { key: "addressStreet", label: "الشارع", required: false, kind: "text" },
];

const ITEM_FIELDS: FieldSpec[] = [
  { key: "code", label: "كود الصنف", required: true, kind: "text" },
  { key: "nameAr", label: "اسم الصنف", required: true, kind: "text" },
  { key: "nameEn", label: "الاسم بالإنجليزية", required: false, kind: "text" },
  {
    key: "type",
    label: "نوع الصنف",
    required: false,
    kind: "enum",
    enumOptions: [
      { value: "stock", label: "مخزون" },
      { value: "service", label: "خدمة" },
    ],
  },
  { key: "baseUnitCode", label: "وحدة القياس الأساسية", required: true, kind: "text" },
  { key: "barcodes", label: "الباركود (افصل بفاصلة لأكثر من رمز)", required: false, kind: "text" },
  { key: "categoryId", label: "التصنيف", required: false, kind: "text" },
  { key: "brand", label: "العلامة التجارية", required: false, kind: "text" },
  {
    key: "costingMethod",
    label: "طريقة التكلفة",
    required: false,
    kind: "enum",
    enumOptions: [
      { value: "WAC", label: "المتوسط المرجح" },
      { value: "FIFO", label: "الوارد أولاً صادر أولاً" },
    ],
  },
  { key: "salePrice", label: "سعر البيع", required: false, kind: "decimal" },
  { key: "costPrice", label: "سعر التكلفة", required: false, kind: "decimal" },
  { key: "taxRatePercent", label: "نسبة الضريبة %", required: false, kind: "number" },
  { key: "reorderPoint", label: "حد إعادة الطلب", required: false, kind: "number" },
  { key: "reorderQty", label: "كمية إعادة الطلب", required: false, kind: "number" },
];

const OPENING_BALANCE_FIELDS: FieldSpec[] = [
  { key: "itemCode", label: "كود الصنف", required: true, kind: "text" },
  { key: "qty", label: "الكمية", required: true, kind: "decimal" },
  { key: "unitCost", label: "سعر التكلفة", required: true, kind: "decimal" },
];

const PURCHASE_DOC_FIELDS: FieldSpec[] = [
  {
    key: "docType",
    label: "نوع المستند",
    required: true,
    kind: "enum",
    enumOptions: [
      { value: "PURCHASE_INVOICE", label: "فاتورة مشتريات" },
      { value: "PURCHASE_RETURN", label: "مرتجع مشتريات" },
    ],
  },
  { key: "documentNumber", label: "رقم المستند الأصلي", required: true, kind: "text" },
  { key: "supplierRef", label: "المورد (الكود أو الاسم)", required: true, kind: "text" },
  { key: "date", label: "التاريخ", required: true, kind: "text" },
  { key: "dueDate", label: "تاريخ الاستحقاق", required: false, kind: "text" },
  { key: "itemRef", label: "الصنف (الكود أو الاسم)", required: false, kind: "text" },
  { key: "description", label: "الوصف", required: false, kind: "text" },
  { key: "qty", label: "الكمية", required: true, kind: "decimal" },
  { key: "unitCost", label: "سعر الوحدة", required: true, kind: "decimal" },
  { key: "amountPaid", label: "المبلغ المسدد (لكل المستند)", required: true, kind: "decimal" },
];

function fieldsFor(kind: ImportKind): FieldSpec[] {
  switch (kind) {
    case "customers":
      return CUSTOMER_FIELDS;
    case "suppliers":
      return SUPPLIER_FIELDS;
    case "items":
      return ITEM_FIELDS;
    case "opening_balances":
      return OPENING_BALANCE_FIELDS;
    case "purchase_documents":
      return PURCHASE_DOC_FIELDS;
  }
}

function normalizeDecimal(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/,/g, "");
  if (cleaned === "") return undefined;
  return cleaned;
}
function normalizeNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}
function normalizeBool(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "نعم"].includes(v)) return true;
  if (["false", "0", "no", "n", "لا"].includes(v)) return false;
  return undefined;
}

type RowErrorLike = { readonly rowNumber: number; readonly reasons: readonly string[] };

export function DataMigrationPage() {
  const [step, setStep] = useState<Step>("kind");
  const [kind, setKind] = useState<ImportKind | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [columnMap, setColumnMap] = useState<Record<string, number>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const warehousesQuery = useWarehouses();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();

  const customerPreview = useCustomerImportPreview();
  const customerCommit = useCustomerImportCommit();
  const supplierPreview = useSupplierImportPreview();
  const supplierCommit = useSupplierImportCommit();
  const itemPreview = useItemImportPreview();
  const itemCommit = useItemImportCommit();
  const openingBalancePreview = useOpeningBalanceImportPreview();
  const openingBalanceCommit = useOpeningBalanceImportCommit();
  const historicalPreview = useHistoricalImportPreview();
  const historicalCommit = useHistoricalImportCommit();

  const fields = kind ? fieldsFor(kind) : [];

  function resetAll() {
    setStep("kind");
    setKind(null);
    setCsv(null);
    setPasteText("");
    setColumnMap({});
    setWarehouseId("");
    setError(null);
  }

  function chooseKind(k: ImportKind) {
    setKind(k);
    setStep("upload");
    setError(null);
  }

  function applyCsvText(text: string) {
    const result = parseCsv(text);
    setCsv(result);
    const specs = kind ? fieldsFor(kind) : [];
    const map: Record<string, number> = {};
    for (const spec of specs) {
      map[spec.key] = guessColumnIndex(result.headers, [spec.key, spec.label]);
    }
    setColumnMap(map);
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => applyCsvText(String(reader.result ?? ""));
    reader.readAsText(file, "utf-8");
  }

  function goToMap() {
    if (!csv || csv.rows.length === 0) {
      setError("الرجاء رفع أو لصق ملف CSV يحتوي على بيانات.");
      return;
    }
    setError(null);
    setStep("map");
  }

  function rawRowValues(csvRow: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const spec of fields) {
      const idx = columnMap[spec.key] ?? -1;
      out[spec.key] = idx >= 0 ? (csvRow[idx] ?? "").trim() : "";
    }
    return out;
  }

  function resolveByCodeOrName<T extends { id: string; code: string; nameAr: string }>(
    ref: string,
    list: readonly T[],
  ): T | undefined {
    const q = ref.trim();
    if (q === "") return undefined;
    return list.find((x) => x.id === q) ?? list.find((x) => x.code === q) ?? list.find((x) => x.nameAr === q);
  }

  const missingRequired = fields.filter((f) => f.required && (columnMap[f.key] ?? -1) < 0);

  function buildCustomerRows() {
    return (csv?.rows ?? []).map((r, i) => {
      const v = rawRowValues(r);
      return {
        rowNumber: i + 1,
        code: v.code,
        nameAr: v.nameAr,
        nameEn: v.nameEn || null,
        phone: v.phone || null,
        email: v.email || null,
        contactPerson: v.contactPerson || null,
        taxNumber: v.taxNumber || null,
        category: v.category || null,
        notes: v.notes || null,
        paymentTermsDays: normalizeNumber(v.paymentTermsDays),
        currency: v.currency || undefined,
        openingBalance: normalizeDecimal(v.openingBalance),
        creditLimit: normalizeDecimal(v.creditLimit),
        etaBuyerType: (v.etaBuyerType || undefined) as "auto" | "business" | "individual" | undefined,
        nationalId: v.nationalId || null,
      };
    });
  }

  function buildSupplierRows() {
    return (csv?.rows ?? []).map((r, i) => {
      const v = rawRowValues(r);
      return {
        rowNumber: i + 1,
        code: v.code,
        nameAr: v.nameAr,
        nameEn: v.nameEn || null,
        phone: v.phone || null,
        email: v.email || null,
        contactPerson: v.contactPerson || null,
        taxNumber: v.taxNumber || null,
        category: v.category || null,
        notes: v.notes || null,
        paymentTermsDays: normalizeNumber(v.paymentTermsDays),
        currency: v.currency || undefined,
        openingBalance: normalizeDecimal(v.openingBalance),
        addressCity: v.addressCity || null,
        addressDistrict: v.addressDistrict || null,
        addressStreet: v.addressStreet || null,
      };
    });
  }

  function buildItemRows() {
    return (csv?.rows ?? []).map((r, i) => {
      const v = rawRowValues(r);
      return {
        rowNumber: i + 1,
        code: v.code,
        nameAr: v.nameAr,
        nameEn: v.nameEn || null,
        type: (v.type || undefined) as "stock" | "service" | undefined,
        baseUnitCode: v.baseUnitCode,
        barcodes: v.barcodes ? v.barcodes.split(",").map((b) => b.trim()).filter(Boolean) : undefined,
        categoryId: v.categoryId || null,
        brand: v.brand || null,
        costingMethod: (v.costingMethod || undefined) as "WAC" | "FIFO" | undefined,
        salePrice: normalizeDecimal(v.salePrice) ?? null,
        costPrice: normalizeDecimal(v.costPrice) ?? null,
        taxRatePercent: normalizeNumber(v.taxRatePercent),
        reorderPoint: normalizeNumber(v.reorderPoint) ?? null,
        reorderQty: normalizeNumber(v.reorderQty) ?? null,
      };
    });
  }

  function buildOpeningBalanceRows() {
    return (csv?.rows ?? []).map((r, i) => {
      const v = rawRowValues(r);
      return { rowNumber: i + 1, itemCode: v.itemCode, qty: normalizeDecimal(v.qty) ?? "0", unitCost: normalizeDecimal(v.unitCost) ?? "0" };
    });
  }

  const suppliers = suppliersQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function buildHistoricalRows() {
    return (csv?.rows ?? []).map((r, i) => {
      const v = rawRowValues(r);
      const supplier = resolveByCodeOrName(v.supplierRef, suppliers);
      const item = v.itemRef ? resolveByCodeOrName(v.itemRef, items) : undefined;
      return {
        rowNumber: i + 1,
        docType: (v.docType || "PURCHASE_INVOICE") as "PURCHASE_INVOICE" | "PURCHASE_RETURN",
        documentNumber: v.documentNumber,
        supplierId: supplier?.id ?? v.supplierRef,
        date: v.date,
        dueDate: v.dueDate || null,
        itemId: item?.id ?? null,
        description: v.description || null,
        qty: normalizeDecimal(v.qty) ?? "0",
        unitCost: normalizeDecimal(v.unitCost) ?? "0",
        amountPaid: normalizeDecimal(v.amountPaid) ?? "0",
      };
    });
  }

  function runPreview() {
    setError(null);
    if (kind === "customers") customerPreview.mutate({ rows: buildCustomerRows() });
    else if (kind === "suppliers") supplierPreview.mutate({ rows: buildSupplierRows() });
    else if (kind === "items") itemPreview.mutate({ rows: buildItemRows() });
    else if (kind === "opening_balances") {
      if (!warehouseId) {
        setError("اختر المستودع أولاً.");
        return;
      }
      openingBalancePreview.mutate({ warehouseId, date: docDate, rows: buildOpeningBalanceRows() });
    } else if (kind === "purchase_documents") historicalPreview.mutate({ rows: buildHistoricalRows() });
    setStep("preview");
  }

  function runCommit() {
    setError(null);
    if (kind === "customers") customerCommit.mutate({ rows: buildCustomerRows() });
    else if (kind === "suppliers") supplierCommit.mutate({ rows: buildSupplierRows() });
    else if (kind === "items") itemCommit.mutate({ rows: buildItemRows() });
    else if (kind === "opening_balances") openingBalanceCommit.mutate({ warehouseId, date: docDate, rows: buildOpeningBalanceRows() });
    else if (kind === "purchase_documents") historicalCommit.mutate({ rows: buildHistoricalRows() });
    setStep("done");
  }

  const previewResult =
    kind === "customers"
      ? customerPreview.data
      : kind === "suppliers"
        ? supplierPreview.data
        : kind === "items"
          ? itemPreview.data
          : kind === "opening_balances"
            ? openingBalancePreview.data
            : historicalPreview.data;

  const previewPending =
    customerPreview.isPending || supplierPreview.isPending || itemPreview.isPending || openingBalancePreview.isPending || historicalPreview.isPending;

  const commitResult =
    kind === "customers"
      ? customerCommit.data
      : kind === "suppliers"
        ? supplierCommit.data
        : kind === "items"
          ? itemCommit.data
          : kind === "opening_balances"
            ? openingBalanceCommit.data
            : historicalCommit.data;

  const commitPending =
    customerCommit.isPending || supplierCommit.isPending || itemCommit.isPending || openingBalanceCommit.isPending || historicalCommit.isPending;

  const previewErrors: readonly RowErrorLike[] = previewResult?.errors ?? [];
  const previewValidCount = previewResult && "validCount" in previewResult ? previewResult.validCount : (previewResult?.groups?.length ?? 0);
  const previewTotal = previewResult && "total" in previewResult ? previewResult.total : (csv?.rows.length ?? 0);
  const canCommit = kind === "purchase_documents" ? true : previewErrors.length === 0 && previewValidCount > 0;

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="font-display text-[21px] font-bold text-ink">نقل البيانات</h1>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">استيراد العملاء، الموردين، الأصناف، الأرصدة الافتتاحية، أو مستندات مشتريات سابقة من ملف CSV.</p>
      </div>

      <ol className="flex flex-wrap items-center gap-[6px] text-[12px] font-semibold text-ink-faint">
        {(["kind", "upload", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li key={s} className={`flex items-center gap-[6px] ${step === s ? "text-brand" : ""}`}>
            {i > 0 ? <span aria-hidden>←</span> : null}
            <span>{{ kind: "النوع", upload: "الرفع", map: "المطابقة", preview: "المعاينة", done: "النتيجة" }[s]}</span>
          </li>
        ))}
      </ol>

      {error ? (
        <Card className="p-[14px_18px]">
          <p className="text-[12.5px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}

      {step === "kind" ? (
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
          {KIND_OPTIONS.map((opt) => (
            <Card key={opt.key} className="flex flex-col gap-[8px] p-[18px_20px]">
              <h3 className="font-display text-[14.5px] font-bold text-ink">{opt.label}</h3>
              <p className="text-[12px] text-ink-muted">{opt.description}</p>
              <Button variant="primary" size="sm" className="mt-[6px] self-start" onClick={() => chooseKind(opt.key)}>
                اختيار
              </Button>
            </Card>
          ))}
        </div>
      ) : null}

      {step === "upload" && kind ? (
        <Card className="flex flex-col gap-[14px] p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">رفع أو لصق ملف CSV — {KIND_OPTIONS.find((k) => k.key === kind)?.label}</h3>
          <div className="flex flex-wrap items-center gap-[10px]">
            <Button onClick={() => fileInputRef.current?.click()}>اختيار ملف CSV</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            {csv ? <StatusPill tone="success" label={`تم تحميل ${csv.rows.length} صف`} /> : null}
          </div>
          <div>
            <label className="mb-[6px] block text-[12.5px] font-semibold text-ink">أو الصق محتوى CSV مباشرة</label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-border bg-surface p-[10px_12px] text-[12.5px] text-ink outline-none focus:border-brand"
              placeholder="code,nameAr,phone&#10;C-001,شركة الأمل,0100000000"
            />
            <Button size="sm" className="mt-[8px]" onClick={() => applyCsvText(pasteText)} disabled={pasteText.trim() === ""}>
              تحليل النص الملصق
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-[14px]">
            <Button onClick={resetAll}>رجوع</Button>
            <Button variant="primary" onClick={goToMap} disabled={!csv || csv.rows.length === 0}>
              التالي: مطابقة الأعمدة
            </Button>
          </div>
        </Card>
      ) : null}

      {step === "map" && kind && csv ? (
        <Card className="flex flex-col gap-[14px] p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">مطابقة الأعمدة</h3>
          <p className="text-[12px] text-ink-muted">حدد أي عمود من الملف المرفوع يقابل كل حقل. الحقول المميزة بـ * مطلوبة.</p>

          {kind === "opening_balances" ? (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              <SelectField
                label="المستودع *"
                value={warehouseId}
                onChange={setWarehouseId}
                options={(warehousesQuery.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
              />
              <TextField label="تاريخ الرصيد الافتتاحي *" value={docDate} onChange={setDocDate} />
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-start text-ink-faint">
                  <th className="p-[8px] text-start">الحقل</th>
                  <th className="p-[8px] text-start">عمود الملف</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key} className="border-b border-border">
                    <td className="p-[8px] font-semibold text-ink">
                      {f.label}
                      {f.required ? <span className="text-danger-ink"> *</span> : null}
                    </td>
                    <td className="p-[8px]">
                      <select
                        value={columnMap[f.key] ?? -1}
                        onChange={(e) => setColumnMap((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                        className="w-full rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                      >
                        <option value={-1}>— بدون —</option>
                        {csv.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `عمود ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequired.length > 0 ? (
            <p className="text-[12px] font-semibold text-warning-ink">
              حقول مطلوبة غير مطابقة بعد: {missingRequired.map((f) => f.label).join("، ")}
            </p>
          ) : null}

          <div className="flex items-center justify-between border-t border-border pt-[14px]">
            <Button onClick={() => setStep("upload")}>رجوع</Button>
            <Button
              variant="primary"
              onClick={runPreview}
              disabled={missingRequired.length > 0 || (kind === "opening_balances" && !warehouseId) || previewPending}
            >
              {previewPending ? "جارٍ المعاينة…" : "التالي: المعاينة"}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === "preview" ? (
        <Card className="flex flex-col gap-[14px] p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">معاينة الاستيراد</h3>
          {previewPending ? (
            <p className="text-[12.5px] text-ink-muted">جارٍ التحقق من الصفوف…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-[10px]">
                <StatusPill tone="success" label={`صفوف صالحة: ${previewValidCount} من ${previewTotal}`} />
                {previewErrors.length > 0 ? <StatusPill tone="danger" label={`صفوف بها أخطاء: ${previewErrors.length}`} /> : null}
              </div>
              {previewErrors.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-border text-start text-ink-faint">
                        <th className="p-[6px] text-start">الصف</th>
                        <th className="p-[6px] text-start">الأسباب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewErrors.map((e) => (
                        <tr key={e.rowNumber} className="border-b border-border">
                          <td className="p-[6px] font-semibold text-ink">{e.rowNumber}</td>
                          <td className="p-[6px] text-danger-ink">{e.reasons.join("، ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {kind !== "purchase_documents" && previewErrors.length > 0 ? (
                <p className="text-[12px] font-semibold text-warning-ink">
                  لن يتم استيراد أي صف قبل تصحيح كل الأخطاء أعلاه — الاستيراد كل شيء أو لا شيء لكل دفعة.
                </p>
              ) : null}
            </>
          )}
          <div className="flex items-center justify-between border-t border-border pt-[14px]">
            <Button onClick={() => setStep("map")}>رجوع لتعديل المطابقة</Button>
            <Button variant="primary" onClick={runCommit} disabled={!canCommit || commitPending || previewPending}>
              {commitPending ? "جارٍ الاستيراد…" : "تأكيد الاستيراد"}
            </Button>
          </div>
        </Card>
      ) : null}

      {step === "done" ? (
        <Card className="flex flex-col gap-[14px] p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">نتيجة الاستيراد</h3>
          {commitPending ? (
            <p className="text-[12.5px] text-ink-muted">جارٍ التنفيذ…</p>
          ) : commitResult ? (
            <>
              {"createdIds" in commitResult ? (
                <StatusPill tone="success" label={`تم استيراد ${commitResult.createdIds?.length ?? 0} صف بنجاح`} />
              ) : (
                <StatusPill tone="success" label={`تم أرشفة ${commitResult.archivedIds?.length ?? 0} مستند`} />
              )}
              {(commitResult.errors?.length ?? 0) > 0 ? (
                <>
                  <StatusPill tone="danger" label={`صفوف لم تُستورد: ${commitResult.errors.length}`} />
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-border text-start text-ink-faint">
                          <th className="p-[6px] text-start">الصف</th>
                          <th className="p-[6px] text-start">الأسباب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commitResult.errors.map((e) => (
                          <tr key={e.rowNumber} className="border-b border-border">
                            <td className="p-[6px] font-semibold text-ink">{e.rowNumber}</td>
                            <td className="p-[6px] text-danger-ink">{e.reasons.join("، ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-[12.5px] text-ink-muted">لا توجد نتيجة بعد.</p>
          )}
          <div className="border-t border-border pt-[14px]">
            <Button variant="primary" onClick={resetAll}>
              استيراد آخر
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
