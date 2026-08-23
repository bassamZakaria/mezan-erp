import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EntityPicker,
  IconButton,
  Money,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentDetailTab,
  type DocumentListColumn,
  type DocumentListSort,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { AlternateUnitDTO, CostingMethodDTO, EtaCodeTypeDTO, ItemDTO, ItemStatusDTO, ItemTypeDTO } from "@mezan/contracts";
import { useAccounts, useCreateItem, useItemCategories, useItemUnits, useItems, useUpdateItem } from "../data/hooks";
import { categoryLabel, unitLabel } from "../lib/item-labels";
import { Field, FieldGroup, NumberField, SelectField, TextField, ToggleField } from "./item-form-controls";

const TYPE_LABEL: Record<ItemTypeDTO, string> = { stock: "منتج مخزون", service: "خدمة" };
const TYPE_TONE: Record<ItemTypeDTO, PillTone> = { stock: "info", service: "neutral" };
const STATUS_LABEL: Record<ItemStatusDTO, string> = { active: "نشط", inactive: "غير نشط" };
const STATUS_TONE: Record<ItemStatusDTO, PillTone> = { active: "success", inactive: "neutral" };
const COSTING_LABEL: Record<CostingMethodDTO, string> = { WAC: "متوسط التكلفة (WAC)", FIFO: "الأقدم أولاً (FIFO)" };
const ETA_CODE_TYPE_LABEL: Record<EtaCodeTypeDTO, string> = { EGS: "EGS", GPC: "GPC" };

const NO_CATEGORY_OPTION: EntityPickerOption = { id: "__none__", label: "بدون تصنيف" };
const DEFAULT_GL_OPTION: EntityPickerOption = { id: "__default__", label: "الافتراضي حسب نوع الصنف" };
const PAGE_SIZE = 5;

/** Draft shape for the add/edit panel. Money fields are plain numbers here (MoneyInput's contract) — converted to/from the ItemDTO's decimal-string wire shape on submit/load. */
interface ItemDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: ItemTypeDTO;
  baseUnitCode: string;
  alternateUnits: AlternateUnitDTO[];
  barcodes: string[];
  categoryId: string | null;
  brand: string;
  costingMethod: CostingMethodDTO;
  salePrice: number | null;
  costPrice: number | null;
  taxRatePercent: number;
  trackInventory: boolean;
  trackBatches: boolean;
  reorderPoint: number | null;
  reorderQty: number | null;
  revenueAccountId: string | null;
  cogsAccountId: string | null;
  inventoryAccountId: string | null;
  etaCodeType: EtaCodeTypeDTO | null;
  etaItemCode: string;
  gpcCode: string;
  status: ItemStatusDTO;
}

const BLANK_DRAFT: ItemDraft = {
  code: "",
  nameAr: "",
  nameEn: "",
  type: "stock",
  baseUnitCode: "PCS",
  alternateUnits: [],
  barcodes: [],
  categoryId: null,
  brand: "",
  costingMethod: "WAC",
  salePrice: null,
  costPrice: null,
  taxRatePercent: 14,
  trackInventory: true,
  trackBatches: false,
  reorderPoint: null,
  reorderQty: null,
  revenueAccountId: null,
  cogsAccountId: null,
  inventoryAccountId: null,
  etaCodeType: null,
  etaItemCode: "",
  gpcCode: "",
  status: "active",
};

function draftFromItem(item: ItemDTO): ItemDraft {
  return {
    code: item.code,
    nameAr: item.nameAr,
    nameEn: item.nameEn ?? "",
    type: item.type,
    baseUnitCode: item.baseUnitCode,
    alternateUnits: item.alternateUnits,
    barcodes: item.barcodes,
    categoryId: item.categoryId,
    brand: item.brand ?? "",
    costingMethod: item.costingMethod,
    salePrice: item.salePrice === null ? null : Number(item.salePrice),
    costPrice: item.costPrice === null ? null : Number(item.costPrice),
    taxRatePercent: item.taxRatePercent,
    trackInventory: item.trackInventory,
    trackBatches: item.trackBatches || item.trackExpiry,
    reorderPoint: item.reorderPoint,
    reorderQty: item.reorderQty,
    revenueAccountId: item.revenueAccountId,
    cogsAccountId: item.cogsAccountId,
    inventoryAccountId: item.inventoryAccountId,
    etaCodeType: item.etaCodeType,
    etaItemCode: item.etaItemCode ?? "",
    gpcCode: item.gpcCode ?? "",
    status: item.status,
  };
}

/**
 * Client-side mirror of the rules `@mezan/domain`'s `createItem`/`updateItem`
 * enforce (packages/domain/src/items) — unique code, non-blank name,
 * positive/unique alternate-unit conversions, non-blank/unique barcodes, a
 * service item can't track inventory, batch/expiry tracking requires
 * trackInventory. The server re-validates on save; this runs first so the form
 * shows the same messages inline without importing the whole domain package
 * into the web bundle.
 */
function validateDraft(draft: ItemDraft, existing: ItemDTO[], editingId: string | null): string | null {
  if (!editingId && existing.some((i) => i.code === draft.code)) {
    return `الكود "${draft.code}" مستخدم بالفعل — أعد المحاولة.`;
  }
  if (draft.nameAr.trim() === "") return "اسم الصنف مطلوب.";
  if (draft.type === "service" && draft.trackInventory) {
    return "لا يمكن لصنف من نوع (خدمة) أن يتتبع المخزون.";
  }
  const seenUnitCodes = new Set<string>();
  for (const unit of draft.alternateUnits) {
    if (unit.code.trim() === "" || unit.name.trim() === "") return "كود واسم الوحدة البديلة مطلوبان.";
    if (unit.code === draft.baseUnitCode) return `الوحدة البديلة "${unit.code}" لا يمكن أن تطابق الوحدة الأساسية.`;
    if (seenUnitCodes.has(unit.code)) return `كود الوحدة البديلة "${unit.code}" مكرر.`;
    seenUnitCodes.add(unit.code);
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) return `عامل تحويل الوحدة "${unit.code}" يجب أن يكون رقماً موجباً.`;
  }
  const seenBarcodes = new Set<string>();
  for (const barcode of draft.barcodes) {
    if (barcode.trim() === "") return "لا يمكن ترك الباركود فارغاً.";
    if (seenBarcodes.has(barcode)) return `الباركود "${barcode}" مكرر.`;
    seenBarcodes.add(barcode);
  }
  if (draft.reorderPoint !== null && draft.reorderPoint < 0) return "نقطة إعادة الطلب لا يمكن أن تكون سالبة.";
  if (draft.reorderQty !== null && draft.reorderQty < 0) return "كمية إعادة الطلب لا يمكن أن تكون سالبة.";
  if (draft.taxRatePercent < 0) return "نسبة الضريبة لا يمكن أن تكون سالبة.";
  return null;
}

function draftToItem(draft: ItemDraft, id: string): ItemDTO {
  return {
    id,
    code: draft.code,
    nameAr: draft.nameAr.trim(),
    nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
    type: draft.type,
    baseUnitCode: draft.baseUnitCode,
    alternateUnits: draft.alternateUnits,
    barcodes: draft.barcodes,
    categoryId: draft.categoryId,
    brand: draft.brand.trim() === "" ? null : draft.brand.trim(),
    costingMethod: draft.costingMethod,
    salePrice: draft.salePrice === null ? null : draft.salePrice.toFixed(2),
    costPrice: draft.costPrice === null ? null : draft.costPrice.toFixed(2),
    taxRatePercent: draft.taxRatePercent,
    trackInventory: draft.type === "stock" ? draft.trackInventory : false,
    trackBatches: draft.type === "stock" && draft.trackInventory ? draft.trackBatches : false,
    trackExpiry: draft.type === "stock" && draft.trackInventory ? draft.trackBatches : false,
    reorderPoint: draft.reorderPoint,
    reorderQty: draft.reorderQty,
    revenueAccountId: draft.revenueAccountId,
    cogsAccountId: draft.cogsAccountId,
    inventoryAccountId: draft.inventoryAccountId,
    etaCodeType: draft.etaCodeType,
    etaItemCode: draft.etaItemCode.trim() === "" ? null : draft.etaItemCode.trim(),
    gpcCode: draft.gpcCode.trim() === "" ? null : draft.gpcCode.trim(),
    status: draft.status,
  };
}

function nextItemCode(items: ItemDTO[]): string {
  return `ITM-${String(items.length + 1).padStart(6, "0")}`;
}

/** الأصناف (Items) — docs/catalog/03-inventory.md. List (KPI strip + filters + table + pager), item detail (tabs), add/edit form. */
export function ItemsScreen() {
  const query = useItems();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const accountsQuery = useAccounts();
  const unitsQuery = useItemUnits();
  const categoriesQuery = useItemCategories();
  const items = query.data ?? [];
  const glAccounts = accountsQuery.data ?? [];
  const itemUnits = unitsQuery.data ?? [];
  const itemCategories = categoriesQuery.data ?? [];

  function glAccountLabel(id: string | null): string {
    if (!id) return "الافتراضي حسب نوع الصنف";
    const account = glAccounts.find((a) => a.id === id);
    return account ? `${account.code} — ${account.nameAr}` : id;
  }

  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("general");

  const [search, setSearch] = useState("");
  const [statusChipKey, setStatusChipKey] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [sort, setSort] = useState<DocumentListSort>({ key: "code", direction: "asc" });
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(BLANK_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  const totalCount = items.length;
  const activeCount = items.filter((i) => i.status === "active").length;
  const stockCount = items.filter((i) => i.type === "stock").length;
  const serviceCount = items.filter((i) => i.type === "service").length;

  const filtered = useMemo(() => {
    let rows = items;
    if (statusChipKey === "active" || statusChipKey === "inactive") rows = rows.filter((i) => i.status === statusChipKey);
    if (statusChipKey === "stock" || statusChipKey === "service") rows = rows.filter((i) => i.type === statusChipKey);
    if (categoryFilter !== "all") rows = rows.filter((i) => i.categoryId === categoryFilter);
    if (unitFilter !== "all") rows = rows.filter((i) => i.baseUnitCode === unitFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (i) => i.nameAr.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || (i.nameEn ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...rows].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "salePrice") return (Number(a.salePrice ?? 0) - Number(b.salePrice ?? 0)) * dir;
      if (sort.key === "costPrice") return (Number(a.costPrice ?? 0) - Number(b.costPrice ?? 0)) * dir;
      if (sort.key === "nameAr") return a.nameAr.localeCompare(b.nameAr) * dir;
      return a.code.localeCompare(b.code) * dir;
    });
    return sorted;
  }, [items, statusChipKey, categoryFilter, unitFilter, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const categoryOptions: EntityPickerOption[] = useMemo(
    () => [NO_CATEGORY_OPTION, ...itemCategories.map((c) => ({ id: c.id, label: c.nameAr }))],
    [itemCategories],
  );
  const glOptions: EntityPickerOption[] = useMemo(
    () => [DEFAULT_GL_OPTION, ...glAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))],
    [glAccounts],
  );

  const selectedItem = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;

  function openCreateForm() {
    setEditingId(null);
    setDraft({ ...BLANK_DRAFT, code: nextItemCode(items) });
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(item: ItemDTO) {
    setEditingId(item.id);
    setDraft(draftFromItem(item));
    setFormError(null);
    setFormOpen(true);
  }

  function openDetail(item: ItemDTO) {
    setSelectedId(item.id);
    setDetailTab("general");
    setView("detail");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, items, editingId);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    try {
      if (editingId) {
        const { id: _id, code: _code, ...patch } = draftToItem(draft, editingId);
        await updateItem.mutateAsync({ id: editingId, patch });
      } else {
        await createItem.mutateAsync(draftToItem(draft, crypto.randomUUID()));
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّرت العملية.");
    }
  }

  function updateAlternateUnit(index: number, patch: Partial<AlternateUnitDTO>) {
    setDraft((d) => ({
      ...d,
      alternateUnits: d.alternateUnits.map((u, i) => (i === index ? { ...u, ...patch } : u)),
    }));
  }

  function updateBarcode(index: number, value: string) {
    setDraft((d) => ({ ...d, barcodes: d.barcodes.map((b, i) => (i === index ? value : b)) }));
  }

  const columns: DocumentListColumn<ItemDTO>[] = [
    {
      key: "nameAr",
      header: "اسم الصنف",
      sortable: true,
      render: (row) => (
        <div className="flex flex-col gap-[3px]">
          <span className="font-semibold text-ink">{row.nameAr}</span>
          <span className="flex items-center gap-[6px] text-[11px] text-ink-faint">
            <span className="mz-num">{row.code}</span>
            <StatusPill label={TYPE_LABEL[row.type]} tone={TYPE_TONE[row.type]} />
          </span>
        </div>
      ),
    },
    { key: "unit", header: "وحدة", render: (row) => unitLabel(row.baseUnitCode, itemUnits) },
    { key: "salePrice", header: "سعر البيع", align: "end", sortable: true, render: (row) => <Money value={Number(row.salePrice ?? 0)} /> },
    { key: "costPrice", header: "سعر التكلفة", align: "end", sortable: true, render: (row) => <Money value={Number(row.costPrice ?? 0)} /> },
    { key: "status", header: "الحالة", render: (row) => <StatusPill label={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <IconButton
          aria-label={`تعديل ${row.nameAr}`}
          onClick={(event) => {
            event.stopPropagation();
            openEditForm(row);
          }}
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px]">
            <path d="M13.5 3.5 16.5 6.5 7 16H4v-3L13.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </IconButton>
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: totalCount },
    { key: "active", label: "نشط", count: activeCount },
    { key: "inactive", label: "غير نشط", count: totalCount - activeCount },
    { key: "stock", label: "منتج مخزون", count: stockCount },
    { key: "service", label: "خدمة", count: serviceCount },
  ];

  const formPanel = (
    <SidePanel
      open={formOpen}
      onClose={() => setFormOpen(false)}
      title={editingId ? "تعديل صنف" : "إضافة صنف"}
      description="الهوية والتصنيف، التسعير، وحدات القياس، تعيين الحسابات، والفاتورة الإلكترونية"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}

        <SelectField
          label="نوع الصنف"
          required
          value={draft.type}
          onChange={(v) => {
            const type = v as ItemTypeDTO;
            setDraft((d) => ({
              ...d,
              type,
              trackInventory: type === "stock",
              trackBatches: type === "stock" ? d.trackBatches : false,
              baseUnitCode: type === "service" && d.baseUnitCode === "PCS" ? "SVC" : d.baseUnitCode,
            }));
          }}
          options={[
            { value: "stock", label: TYPE_LABEL.stock },
            { value: "service", label: TYPE_LABEL.service },
          ]}
        />

        <TextField label="كود الصنف" value={draft.code} onChange={() => {}} disabled dir="ltr" hint="يُنشأ تلقائياً" />
        <TextField label="اسم الصنف" required value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
        <TextField label="الاسم بالإنجليزي" dir="ltr" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />

        <SelectField
          label="الوحدة الأساسية"
          required
          value={draft.baseUnitCode}
          onChange={(v) => setDraft((d) => ({ ...d, baseUnitCode: v }))}
          options={itemUnits.map((u) => ({ value: u.code, label: `${u.nameAr} (${u.code})` }))}
        />

        <EntityPicker
          label="التصنيف"
          options={categoryOptions}
          value={draft.categoryId ? (categoryOptions.find((o) => o.id === draft.categoryId) ?? null) : NO_CATEGORY_OPTION}
          onChange={(option) => setDraft((d) => ({ ...d, categoryId: !option || option.id === NO_CATEGORY_OPTION.id ? null : option.id }))}
        />
        <TextField label="الماركة" value={draft.brand} onChange={(v) => setDraft((d) => ({ ...d, brand: v }))} />

        <FieldGroup label="وحدات القياس البديلة" hint="مثال: كرتونة = 12 قطعة">
          <div className="flex flex-col gap-[8px]">
            {draft.alternateUnits.map((unit, index) => (
              <div key={index} className="flex items-end gap-[6px]">
                <input
                  aria-label="كود الوحدة"
                  dir="ltr"
                  value={unit.code}
                  onChange={(e) => updateAlternateUnit(index, { code: e.target.value })}
                  placeholder="CTN"
                  className="w-[70px] rounded-md border border-border bg-surface px-[8px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                />
                <input
                  aria-label="اسم الوحدة"
                  value={unit.name}
                  onChange={(e) => updateAlternateUnit(index, { name: e.target.value })}
                  placeholder="كرتونة"
                  className="flex-1 rounded-md border border-border bg-surface px-[8px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                />
                <input
                  aria-label="عامل التحويل"
                  type="number"
                  dir="ltr"
                  min={0}
                  value={unit.factor}
                  onChange={(e) => updateAlternateUnit(index, { factor: Number(e.target.value) })}
                  className="mz-num w-[64px] rounded-md border border-border bg-surface px-[8px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                />
                <IconButton
                  aria-label="حذف الوحدة"
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, alternateUnits: d.alternateUnits.filter((_, i) => i !== index) }))}
                >
                  <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
                    <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              onClick={() => setDraft((d) => ({ ...d, alternateUnits: [...d.alternateUnits, { code: "", name: "", factor: 1 }] }))}
            >
              + إضافة وحدة
            </Button>
          </div>
        </FieldGroup>

        <FieldGroup label="الباركود">
          <div className="flex flex-col gap-[8px]">
            {draft.barcodes.map((barcode, index) => (
              <div key={index} className="flex items-center gap-[6px]">
                <input
                  aria-label="الباركود"
                  dir="ltr"
                  value={barcode}
                  onChange={(e) => updateBarcode(index, e.target.value)}
                  className="mz-num flex-1 rounded-md border border-border bg-surface px-[8px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                />
                <IconButton
                  aria-label="حذف الباركود"
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, barcodes: d.barcodes.filter((_, i) => i !== index) }))}
                >
                  <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
                    <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </div>
            ))}
            <Button type="button" size="sm" onClick={() => setDraft((d) => ({ ...d, barcodes: [...d.barcodes, ""] }))}>
              + إضافة باركود آخر
            </Button>
          </div>
        </FieldGroup>

        <Field label="سعر البيع">
          <MoneyInput aria-label="سعر البيع" value={draft.salePrice} onChange={(v) => setDraft((d) => ({ ...d, salePrice: v }))} />
        </Field>
        <Field label="سعر التكلفة">
          <MoneyInput aria-label="سعر التكلفة" value={draft.costPrice} onChange={(v) => setDraft((d) => ({ ...d, costPrice: v }))} />
        </Field>
        <NumberField label="نسبة الضريبة %" value={draft.taxRatePercent} onChange={(v) => setDraft((d) => ({ ...d, taxRatePercent: v ?? 0 }))} min={0} />

        {draft.type === "stock" ? (
          <Card className="flex flex-col gap-[12px] p-[14px_16px]">
            <ToggleField
              label="تتبع المخزون"
              checked={draft.trackInventory}
              onChange={(v) => setDraft((d) => ({ ...d, trackInventory: v, trackBatches: v ? d.trackBatches : false }))}
              hint="خصم عند البيع، تحديث عند الشراء"
            />
            <SelectField
              label="طريقة التكلفة"
              required
              value={draft.costingMethod}
              onChange={(v) => setDraft((d) => ({ ...d, costingMethod: v as CostingMethodDTO }))}
              options={[
                { value: "WAC", label: COSTING_LABEL.WAC },
                { value: "FIFO", label: COSTING_LABEL.FIFO },
              ]}
            />
            <ToggleField
              label="تتبع الدفعات وتواريخ الصلاحية"
              checked={draft.trackBatches}
              disabled={!draft.trackInventory}
              onChange={(v) => setDraft((d) => ({ ...d, trackBatches: v }))}
              hint="FEFO — الأقدم صلاحية أولاً، للأصناف الغذائية/الدوائية"
            />
            <NumberField label="نقطة إعادة الطلب" value={draft.reorderPoint} onChange={(v) => setDraft((d) => ({ ...d, reorderPoint: v }))} min={0} />
            <NumberField label="كمية إعادة الطلب" value={draft.reorderQty} onChange={(v) => setDraft((d) => ({ ...d, reorderQty: v }))} min={0} />
          </Card>
        ) : null}

        <Card className="flex flex-col gap-[12px] p-[14px_16px]">
          <EntityPicker
            label="حساب الإيراد"
            options={glOptions}
            value={draft.revenueAccountId ? (glOptions.find((o) => o.id === draft.revenueAccountId) ?? null) : DEFAULT_GL_OPTION}
            onChange={(option) => setDraft((d) => ({ ...d, revenueAccountId: !option || option.id === DEFAULT_GL_OPTION.id ? null : option.id }))}
          />
          <EntityPicker
            label="حساب التكلفة"
            options={glOptions}
            value={draft.cogsAccountId ? (glOptions.find((o) => o.id === draft.cogsAccountId) ?? null) : DEFAULT_GL_OPTION}
            onChange={(option) => setDraft((d) => ({ ...d, cogsAccountId: !option || option.id === DEFAULT_GL_OPTION.id ? null : option.id }))}
          />
          <EntityPicker
            label="حساب المخزون"
            options={glOptions}
            value={draft.inventoryAccountId ? (glOptions.find((o) => o.id === draft.inventoryAccountId) ?? null) : DEFAULT_GL_OPTION}
            onChange={(option) => setDraft((d) => ({ ...d, inventoryAccountId: !option || option.id === DEFAULT_GL_OPTION.id ? null : option.id }))}
          />
        </Card>

        <Card className="flex flex-col gap-[12px] p-[14px_16px]">
          <SelectField
            label="نوع الكود (ETA)"
            value={draft.etaCodeType ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, etaCodeType: v === "" ? null : (v as EtaCodeTypeDTO) }))}
            options={[
              { value: "", label: "بدون" },
              { value: "EGS", label: "EGS" },
              { value: "GPC", label: "GPC" },
            ]}
          />
          <TextField label="كود الصنف لدى المصلحة" dir="ltr" value={draft.etaItemCode} onChange={(v) => setDraft((d) => ({ ...d, etaItemCode: v }))} placeholder="EG-XXXXXXXXX-SKU" />
          <TextField label="كود GPC" dir="ltr" value={draft.gpcCode} onChange={(v) => setDraft((d) => ({ ...d, gpcCode: v }))} />
        </Card>

        {editingId ? (
          <SelectField
            label="الحالة"
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v as ItemStatusDTO }))}
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
  );

  if (view === "detail" && selectedItem) {
    const item = selectedItem;
    const tabs: DocumentDetailTab[] = [
      {
        key: "general",
        label: "عام",
        content: (
          <Card className="grid grid-cols-1 gap-0 overflow-hidden sm:grid-cols-2">
            {[
              ["نوع الصنف", TYPE_LABEL[item.type]],
              ["التصنيف", categoryLabel(item.categoryId, itemCategories)],
              ["الماركة", item.brand ?? "—"],
              ["طريقة التكلفة", COSTING_LABEL[item.costingMethod]],
              ["تتبع المخزون", item.trackInventory ? "نعم" : "لا"],
              ["تتبع الدفعات وتواريخ الصلاحية", item.trackBatches || item.trackExpiry ? "نعم" : "لا"],
              ["نقطة إعادة الطلب", item.reorderPoint ?? "—"],
              ["كمية إعادة الطلب", item.reorderQty ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-e border-border p-[13px_15px] [&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(odd)]:border-e">
                <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
                <div className="mt-[5px] text-[13.5px] font-bold text-ink">{value}</div>
              </div>
            ))}
          </Card>
        ),
      },
      {
        key: "units",
        label: "الوحدات والباركود",
        content: (
          <div className="flex flex-col gap-[16px]">
            <Card className="p-[14px_16px]">
              <div className="text-[11px] font-semibold text-ink-faint">الوحدة الأساسية</div>
              <div className="mt-[5px] text-[13.5px] font-bold text-ink">
                {unitLabel(item.baseUnitCode, itemUnits)} ({item.baseUnitCode})
              </div>
            </Card>
            <div>
              <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">الوحدات البديلة</h3>
              {item.alternateUnits.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-[16px] text-center text-[12.5px] text-ink-muted">لا توجد وحدات قياس بديلة</div>
              ) : (
                <Card className="overflow-hidden">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="border-b border-border px-[12px] py-[9px] text-start font-bold text-ink-muted">الوحدة</th>
                        <th className="border-b border-border px-[12px] py-[9px] text-start font-bold text-ink-muted">الكود</th>
                        <th className="border-b border-border px-[12px] py-[9px] text-end font-bold text-ink-muted">التحويل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.alternateUnits.map((unit) => (
                        <tr key={unit.code} className="border-b border-border last:border-b-0">
                          <td className="px-[12px] py-[9px] text-ink">{unit.name}</td>
                          <td className="mz-num px-[12px] py-[9px] text-ink">{unit.code}</td>
                          <td className="mz-num px-[12px] py-[9px] text-end text-ink">
                            1 {unit.code} = {unit.factor} {item.baseUnitCode}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
            <div>
              <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">الباركود</h3>
              {item.barcodes.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-[16px] text-center text-[12.5px] text-ink-muted">لا يوجد باركود مسجل</div>
              ) : (
                <div className="flex flex-wrap gap-[8px]">
                  {item.barcodes.map((barcode) => (
                    <span key={barcode} className="mz-num rounded-sm bg-surface-3 px-[10px] py-[5px] text-[12px] text-ink">
                      {barcode}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "pricing",
        label: "التسعير",
        content: (
          <Card className="grid grid-cols-2 overflow-hidden">
            <div className="border-e border-border p-[15px_17px]">
              <div className="text-[11px] font-semibold text-ink-faint">سعر البيع</div>
              <div className="mt-[6px]">
                <Money value={Number(item.salePrice ?? 0)} />
              </div>
            </div>
            <div className="p-[15px_17px]">
              <div className="text-[11px] font-semibold text-ink-faint">سعر التكلفة</div>
              <div className="mt-[6px]">
                <Money value={Number(item.costPrice ?? 0)} />
              </div>
              <div className="mt-[6px] text-[11px] text-ink-faint">يصبح مشتقاً تلقائياً من حركات المخزون فور ربط دفتر التكاليف (المرحلة الثانية)</div>
            </div>
          </Card>
        ),
      },
      {
        key: "accounting",
        label: "الحسابات",
        content: (
          <div className="flex flex-col gap-[16px]">
            <Card className="grid grid-cols-1 overflow-hidden sm:grid-cols-3">
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">حساب الإيراد</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{glAccountLabel(item.revenueAccountId)}</div>
              </div>
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">حساب التكلفة</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{glAccountLabel(item.cogsAccountId)}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">حساب المخزون</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{glAccountLabel(item.inventoryAccountId)}</div>
              </div>
            </Card>
            <Card className="grid grid-cols-1 overflow-hidden sm:grid-cols-3">
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">نوع كود ETA</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{item.etaCodeType ? ETA_CODE_TYPE_LABEL[item.etaCodeType] : "—"}</div>
              </div>
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">كود الصنف لدى المصلحة</div>
                <div className="mz-num mt-[5px] text-[13px] font-bold text-ink">{item.etaItemCode ?? "—"}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">كود GPC</div>
                <div className="mz-num mt-[5px] text-[13px] font-bold text-ink">{item.gpcCode ?? "—"}</div>
              </div>
            </Card>
          </div>
        ),
      },
      {
        key: "stock",
        label: "المخزون",
        content: (
          <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">
            ستُعرض أرصدة المخزون حسب المستودع هنا فور ربط حركات المخزون بدفتر المخزون (المرحلة الثانية).
          </div>
        ),
      },
    ];

    return (
      <div className="w-full">
        <DocumentDetail
          title={`${item.code} — ${item.nameAr}`}
          statusLabel={STATUS_LABEL[item.status]}
          statusTone={STATUS_TONE[item.status]}
          subtitle={`${TYPE_LABEL[item.type]} · ${categoryLabel(item.categoryId, itemCategories)}`}
          actions={
            <>
              <Button
                onClick={() => {
                  setView("list");
                  setSelectedId(null);
                }}
              >
                رجوع للقائمة
              </Button>
              <Button variant="primary" onClick={() => openEditForm(item)}>
                تعديل
              </Button>
            </>
          }
          summary={[
            { label: "نوع الصنف", value: TYPE_LABEL[item.type] },
            { label: "التصنيف", value: categoryLabel(item.categoryId, itemCategories) },
            { label: "الوحدة", value: unitLabel(item.baseUnitCode, itemUnits) },
            { label: "طريقة التكلفة", value: COSTING_LABEL[item.costingMethod] },
            { label: "سعر البيع", value: <Money value={Number(item.salePrice ?? 0)} /> },
            { label: "سعر التكلفة", value: <Money value={Number(item.costPrice ?? 0)} /> },
          ]}
          tabs={tabs}
          activeTabKey={detailTab}
          onTabChange={setDetailTab}
        />
        {formPanel}
      </div>
    );
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الأصناف.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<ItemDTO>
        eyebrow="Inventory · Items"
        title="الأصناف"
        description="الكتالوج الرئيسي للمنتجات والخدمات — الوحدات، الباركود، التسعير، تعيين الحسابات، وسياسة المخزون"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة صنف
          </Button>
        }
        stats={[
          { label: "إجمالي الأصناف", value: <span className="mz-num">{totalCount}</span> },
          { label: "نشط", value: <span className="mz-num">{activeCount}</span> },
          { label: "أصناف مخزون", value: <span className="mz-num">{stockCount}</span> },
          { label: "أصناف خدمية", value: <span className="mz-num">{serviceCount}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusChipKey}
        onStatusChange={(key) => {
          setStatusChipKey(key);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="بحث بالاسم أو الكود..."
        filterBarExtra={
          <>
            <select
              aria-label="تصفية حسب التصنيف"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
            >
              <option value="all">كل التصنيفات</option>
              {itemCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
            <select
              aria-label="تصفية حسب الوحدة"
              value={unitFilter}
              onChange={(e) => {
                setUnitFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
            >
              <option value="all">كل الوحدات</option>
              {itemUnits.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.nameAr}
                </option>
              ))}
            </select>
          </>
        }
        columns={columns}
        rows={pageRows}
        rowKey={(row) => row.id}
        onRowClick={openDetail}
        sort={sort}
        onSortChange={(key) => setSort((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }))}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSummary={
          <>
            عرض <span className="mz-num">{pageRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</span> من{" "}
            <span className="mz-num">{filtered.length}</span> صنف
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أصناف مطابقة</div>}
      />
      {formPanel}
    </div>
  );
}
