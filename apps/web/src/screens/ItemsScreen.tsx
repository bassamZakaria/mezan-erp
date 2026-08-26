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
  Select,
  SidePanel,
  StatusPill,
  TextInput,
  type DocumentDetailTab,
  type DocumentListColumn,
  type DocumentListSort,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { AlternateUnitDTO, CostingMethodDTO, EtaCodeTypeDTO, ItemDTO, ItemStatusDTO, ItemTypeDTO } from "@mezan/contracts";
import { ITEM_TYPES, itemTypeTracksStock } from "@mezan/domain";
import { useAccounts, useCreateItem, useItemCategories, useItemStock, useItemUnits, useItems, useUpdateItem, useWarehouses } from "../data/hooks";
import { categoryLabel, unitLabel } from "../lib/item-labels";
import { Field, FieldGroup, NumberField, SelectField, TextField, ToggleField } from "./item-form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { sumMajor } from "../lib/money";

const TYPE_KEY: Record<ItemTypeDTO, AppTranslationKey> = {
  stock: "items.stockProduct",
  service: "items.service",
  raw_material: "items.type.rawMaterial",
  finished_good: "items.type.finishedGood",
  consumable: "items.type.consumable",
  recipe: "items.type.recipe",
};
const TYPE_TONE: Record<ItemTypeDTO, PillTone> = {
  stock: "info",
  service: "neutral",
  raw_material: "warning",
  finished_good: "success",
  consumable: "neutral",
  recipe: "info",
};
const STATUS_KEY: Record<ItemStatusDTO, AppTranslationKey> = { active: "common.active", inactive: "common.inactive" };
const STATUS_TONE: Record<ItemStatusDTO, PillTone> = { active: "success", inactive: "neutral" };
const COSTING_KEY: Record<CostingMethodDTO, AppTranslationKey> = { WAC: "items.weightedAverageWac", FIFO: "items.oldestFirstFifo" };
const ETA_CODE_TYPE_LABEL: Record<EtaCodeTypeDTO, string> = { EGS: "EGS", GPC: "GPC" };

const NO_CATEGORY_ID = "__none__";
const NO_CATEGORY_KEY = "common.uncategorized" as const;
const DEFAULT_GL_ID = "__default__";
const DEFAULT_GL_KEY = "items.defaultForTheItemType" as const;
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
 * a type that cannot hold stock can't track inventory, batch/expiry tracking requires
 * trackInventory. The server re-validates on save; this runs first so the form
 * shows the same messages inline without importing the whole domain package
 * into the web bundle.
 */
function validateDraft(
  draft: ItemDraft,
  existing: ItemDTO[],
  editingId: string | null,
  t: (key: AppTranslationKey, params?: Record<string, string | number>) => string,
): string | null {
  if (!editingId && existing.some((i) => i.code === draft.code)) {
    return t("items.codeInUse", { code: draft.code });
  }
  if (draft.nameAr.trim() === "") return t("items.theItemNeedsAName");
  if (!itemTypeTracksStock(draft.type) && draft.trackInventory) {
    return t("items.typeCannotTrackStock", { type: t(TYPE_KEY[draft.type]) });
  }
  const seenUnitCodes = new Set<string>();
  for (const unit of draft.alternateUnits) {
    if (unit.code.trim() === "" || unit.name.trim() === "") return t("items.anAlternateUnitNeedsBoth");
    if (unit.code === draft.baseUnitCode) return t("items.unitMatchesBase", { code: unit.code });
    if (seenUnitCodes.has(unit.code)) return t("items.duplicateUnitCode", { code: unit.code });
    seenUnitCodes.add(unit.code);
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) return t("items.unitFactorPositive", { code: unit.code });
  }
  const seenBarcodes = new Set<string>();
  for (const barcode of draft.barcodes) {
    if (barcode.trim() === "") return t("items.aBarcodeCannotBeLeft");
    if (seenBarcodes.has(barcode)) return t("items.duplicateBarcode", { code: barcode });
    seenBarcodes.add(barcode);
  }
  if (draft.reorderPoint !== null && draft.reorderPoint < 0) return t("items.theReorderPointCannotBe");
  if (draft.reorderQty !== null && draft.reorderQty < 0) return t("items.theReorderQuantityCannotBe");
  if (draft.taxRatePercent < 0) return t("items.theTaxRateCannotBe");
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
    trackInventory: itemTypeTracksStock(draft.type) ? draft.trackInventory : false,
    trackBatches: itemTypeTracksStock(draft.type) && draft.trackInventory ? draft.trackBatches : false,
    trackExpiry: itemTypeTracksStock(draft.type) && draft.trackInventory ? draft.trackBatches : false,
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
/** المخزون حسب المستودع — where this item's stock actually sits (D43). */
function ItemStockTab({ itemId }: { itemId: string }) {
  const { t } = useAppTranslation();
  const query = useItemStock(itemId);
  const warehouses = useWarehouses().data ?? [];
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;
  const positions = query.data?.positions ?? [];

  if (query.isLoading) return <div className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("common.loading")}</div>;
  if (positions.length === 0) {
    return <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("items.stock.empty")}</div>;
  }

  const totalOnHand = sumMajor(positions.map((p) => p.onHand));
  const totalValue = sumMajor(positions.map((p) => p.totalValue));

  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
          <tr>
            <th className="px-[15px] py-[9px] text-start">{t("items.stock.warehouse")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.onHand")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.averageCost")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.value")}</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.warehouseId} className="border-t border-border">
              <td className="px-[15px] py-[10px] text-ink">{warehouseName(position.warehouseId)}</td>
              <td className="mz-num px-[15px] py-[10px] text-end">{Number(position.onHand)}</td>
              <td className="px-[15px] py-[10px] text-end"><Money value={Number(position.averageCost)} /></td>
              <td className="px-[15px] py-[10px] text-end"><Money value={Number(position.totalValue)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-surface-2 font-bold">
            <td className="px-[15px] py-[10px]">{t("common.total")}</td>
            <td className="mz-num px-[15px] py-[10px] text-end">{totalOnHand}</td>
            <td />
            <td className="px-[15px] py-[10px] text-end"><Money value={totalValue} /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/** طبقات التكلفة — the immutable WAC layers still holding stock (D43, R5.5). */
function ItemCostLayersTab({ itemId }: { itemId: string }) {
  const { t } = useAppTranslation();
  const query = useItemStock(itemId);
  const warehouses = useWarehouses().data ?? [];
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;
  const layers = query.data?.layers ?? [];

  if (query.isLoading) return <div className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("common.loading")}</div>;
  if (layers.length === 0) {
    return <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("items.costLayers.empty")}</div>;
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
          <tr>
            <th className="px-[15px] py-[9px] text-start">{t("items.stock.warehouse")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.costLayers.remaining")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.costLayers.unitCost")}</th>
            <th className="px-[15px] py-[9px] text-start">{t("items.costLayers.source")}</th>
            <th className="px-[15px] py-[9px] text-start">{t("common.date")}</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((layer) => (
            <tr key={layer.id} className="border-t border-border">
              <td className="px-[15px] py-[10px] text-ink">{warehouseName(layer.warehouseId)}</td>
              <td className="mz-num px-[15px] py-[10px] text-end">
                {Number(layer.remainingQty)} / {Number(layer.originalQty)}
              </td>
              <td className="px-[15px] py-[10px] text-end"><Money value={Number(layer.unitCost)} /></td>
              <td className="mz-num px-[15px] py-[10px]">{layer.sourceDocNumber ?? layer.sourceDocType}</td>
              <td className="mz-num px-[15px] py-[10px]">{layer.createdAt.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ItemsScreen() {
  const { t } = useAppTranslation();
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
    if (!id) return t("items.defaultForTheItemType");
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
  const typeCounts = useMemo(() => {
    const counts = new Map<ItemTypeDTO, number>();
    for (const item of items) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    return counts;
  }, [items]);

  // Counted by capability, not by the literal type "stock": raw materials,
  // finished goods and consumables all hold stock too (R5.1).
  const stockTrackedCount = items.filter((i) => itemTypeTracksStock(i.type)).length;

  const filtered = useMemo(() => {
    let rows = items;
    if (statusChipKey === "active" || statusChipKey === "inactive") rows = rows.filter((i) => i.status === statusChipKey);
    if (ITEM_TYPES.includes(statusChipKey as ItemTypeDTO)) rows = rows.filter((i) => i.type === statusChipKey);
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
    () => [{ id: NO_CATEGORY_ID, label: t(NO_CATEGORY_KEY) }, ...itemCategories.map((c) => ({ id: c.id, label: c.nameAr }))],
    [itemCategories, t],
  );
  const glOptions: EntityPickerOption[] = useMemo(
    () => [{ id: DEFAULT_GL_ID, label: t(DEFAULT_GL_KEY) }, ...glAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))],
    [glAccounts, t],
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
    const error = validateDraft(draft, items, editingId, t);
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
      setFormError(err instanceof Error ? err.message : t("common.failed"));
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
      header: t("items.itemName"),
      sortable: true,
      render: (row) => (
        <div className="flex flex-col gap-[3px]">
          <span className="font-semibold text-ink">{row.nameAr}</span>
          <span className="flex items-center gap-[6px] text-[11px] text-ink-faint">
            <span className="mz-num">{row.code}</span>
            <StatusPill label={t(TYPE_KEY[row.type])} tone={TYPE_TONE[row.type]} />
          </span>
        </div>
      ),
    },
    { key: "unit", header: t("items.unit"), render: (row) => unitLabel(row.baseUnitCode, itemUnits) },
    { key: "salePrice", header: t("items.salePrice"), align: "end", sortable: true, render: (row) => <Money value={Number(row.salePrice ?? 0)} /> },
    { key: "costPrice", header: t("items.costPrice"), align: "end", sortable: true, render: (row) => <Money value={Number(row.costPrice ?? 0)} /> },
    { key: "status", header: t("common.status"), render: (row) => <StatusPill label={t(STATUS_KEY[row.status])} tone={STATUS_TONE[row.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <IconButton
          aria-label={t("items.editLabel", { name: row.nameAr })}
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
    { key: "all", label: t("common.all"), count: totalCount },
    { key: "active", label: t("common.active"), count: activeCount },
    { key: "inactive", label: t("common.inactive"), count: totalCount - activeCount },
    ...ITEM_TYPES.map((type) => ({ key: type, label: t(TYPE_KEY[type]), count: typeCounts.get(type) ?? 0 })),
  ];

  const formPanel = (
    <SidePanel
      open={formOpen}
      onClose={() => setFormOpen(false)}
      title={editingId ? t("items.editItem") : t("items.addItem")}
      description={t("items.identityAndCategoryPricingUnits")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}

        <SelectField
          label={t("items.itemType")}
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
            ...ITEM_TYPES.map((type) => ({ value: type, label: t(TYPE_KEY[type]) })),
          ]}
        />

        <TextField label={t("items.itemCode")} value={draft.code} onChange={() => {}} disabled dir="ltr" hint={t("items.generatedAutomatically")} />
        <TextField label={t("items.itemName")} required value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
        <TextField label={t("items.nameInEnglish")} dir="ltr" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />

        <SelectField
          label={t("items.baseUnit")}
          required
          value={draft.baseUnitCode}
          onChange={(v) => setDraft((d) => ({ ...d, baseUnitCode: v }))}
          options={itemUnits.map((u) => ({ value: u.code, label: `${u.nameAr} (${u.code})` }))}
        />

        <EntityPicker
          label={t("common.category")}
          options={categoryOptions}
          value={draft.categoryId ? (categoryOptions.find((o) => o.id === draft.categoryId) ?? null) : (categoryOptions[0] ?? null)}
          onChange={(option) => setDraft((d) => ({ ...d, categoryId: !option || option.id === NO_CATEGORY_ID ? null : option.id }))}
        />
        <TextField label={t("items.brand")} value={draft.brand} onChange={(v) => setDraft((d) => ({ ...d, brand: v }))} />

        <FieldGroup label={t("items.alternateUnitsOfMeasure")} hint={t("items.forExampleCarton12Pieces")}>
          <div className="flex flex-col gap-[8px]">
            {draft.alternateUnits.map((unit, index) => (
              <div key={index} className="flex items-end gap-[6px]">
                <TextInput
                  size="sm"
                  className="w-[70px]"
                  aria-label={t("items.unitCode")}
                  dir="ltr"
                  value={unit.code}
                  onChange={(e) => updateAlternateUnit(index, { code: e.target.value })}
                  placeholder="CTN"
                />
                <TextInput
                  size="sm"
                  className="flex-1"
                  aria-label={t("items.unitName")}
                  value={unit.name}
                  onChange={(e) => updateAlternateUnit(index, { name: e.target.value })}
                  placeholder={t("items.carton")}
                />
                <TextInput
                  size="sm"
                  numeric
                  className="w-[64px]"
                  aria-label={t("items.conversionFactor")}
                  type="number"
                  dir="ltr"
                  min={0}
                  value={unit.factor}
                  onChange={(e) => updateAlternateUnit(index, { factor: Number(e.target.value) })}
                />
                <IconButton
                  aria-label={t("items.removeUnit")}
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
              {t("items.addUnit")}
            </Button>
          </div>
        </FieldGroup>

        <FieldGroup label={t("items.barcode")}>
          <div className="flex flex-col gap-[8px]">
            {draft.barcodes.map((barcode, index) => (
              <div key={index} className="flex items-center gap-[6px]">
                <TextInput
                  size="sm"
                  numeric
                  className="flex-1"
                  aria-label={t("items.barcode")}
                  dir="ltr"
                  value={barcode}
                  onChange={(e) => updateBarcode(index, e.target.value)}
                />
                <IconButton
                  aria-label={t("items.removeBarcode")}
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
              {t("items.addAnotherBarcode")}
            </Button>
          </div>
        </FieldGroup>

        <Field label={t("items.salePrice")}>
          <MoneyInput aria-label={t("items.salePrice")} value={draft.salePrice} onChange={(v) => setDraft((d) => ({ ...d, salePrice: v }))} />
        </Field>
        <Field label={t("items.costPrice")}>
          <MoneyInput aria-label={t("items.costPrice")} value={draft.costPrice} onChange={(v) => setDraft((d) => ({ ...d, costPrice: v }))} />
        </Field>
        <NumberField label={t("items.taxRate")} value={draft.taxRatePercent} onChange={(v) => setDraft((d) => ({ ...d, taxRatePercent: v ?? 0 }))} min={0} />

        {draft.type === "stock" ? (
          <Card className="flex flex-col gap-[12px] p-[14px_16px]">
            <ToggleField
              label={t("items.trackStock")}
              checked={draft.trackInventory}
              onChange={(v) => setDraft((d) => ({ ...d, trackInventory: v, trackBatches: v ? d.trackBatches : false }))}
              hint={t("items.deductedOnSaleToppedUp")}
            />
            <SelectField
              label={t("items.costingMethod")}
              required
              value={draft.costingMethod}
              onChange={(v) => setDraft((d) => ({ ...d, costingMethod: v as CostingMethodDTO }))}
              options={[
                { value: "WAC", label: t(COSTING_KEY.WAC) },
                { value: "FIFO", label: t(COSTING_KEY.FIFO) },
              ]}
            />
            <ToggleField
              label={t("items.trackBatchesAndExpiryDates")}
              checked={draft.trackBatches}
              disabled={!draft.trackInventory}
              onChange={(v) => setDraft((d) => ({ ...d, trackBatches: v }))}
              hint={t("items.fefoEarliestExpiryFirstFor")}
            />
            <NumberField label={t("items.reorderPoint")} value={draft.reorderPoint} onChange={(v) => setDraft((d) => ({ ...d, reorderPoint: v }))} min={0} />
            <NumberField label={t("items.reorderQuantity")} value={draft.reorderQty} onChange={(v) => setDraft((d) => ({ ...d, reorderQty: v }))} min={0} />
          </Card>
        ) : null}

        <Card className="flex flex-col gap-[12px] p-[14px_16px]">
          <EntityPicker
            label={t("items.revenueAccount")}
            options={glOptions}
            value={draft.revenueAccountId ? (glOptions.find((o) => o.id === draft.revenueAccountId) ?? null) : (glOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, revenueAccountId: !option || option.id === DEFAULT_GL_ID ? null : option.id }))}
          />
          <EntityPicker
            label={t("items.costAccount")}
            options={glOptions}
            value={draft.cogsAccountId ? (glOptions.find((o) => o.id === draft.cogsAccountId) ?? null) : (glOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, cogsAccountId: !option || option.id === DEFAULT_GL_ID ? null : option.id }))}
          />
          <EntityPicker
            label={t("items.inventoryAccount")}
            options={glOptions}
            value={draft.inventoryAccountId ? (glOptions.find((o) => o.id === draft.inventoryAccountId) ?? null) : (glOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, inventoryAccountId: !option || option.id === DEFAULT_GL_ID ? null : option.id }))}
          />
        </Card>

        <Card className="flex flex-col gap-[12px] p-[14px_16px]">
          <SelectField
            label={t("items.codeTypeEta")}
            value={draft.etaCodeType ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, etaCodeType: v === "" ? null : (v as EtaCodeTypeDTO) }))}
            options={[
              { value: "", label: t("items.none") },
              { value: "EGS", label: "EGS" },
              { value: "GPC", label: "GPC" },
            ]}
          />
          <TextField label={t("items.itemCodeWithTheAuthority")} dir="ltr" value={draft.etaItemCode} onChange={(v) => setDraft((d) => ({ ...d, etaItemCode: v }))} placeholder="EG-XXXXXXXXX-SKU" />
          <TextField label={t("items.gpcCode")} dir="ltr" value={draft.gpcCode} onChange={(v) => setDraft((d) => ({ ...d, gpcCode: v }))} />
        </Card>

        {editingId ? (
          <SelectField
            label={t("common.status")}
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v as ItemStatusDTO }))}
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
  );

  if (view === "detail" && selectedItem) {
    const item = selectedItem;
    const tabs: DocumentDetailTab[] = [
      {
        key: "general",
        label: t("items.general"),
        content: (
          <Card className="grid grid-cols-1 gap-0 overflow-hidden sm:grid-cols-2">
            {[
              [t("items.itemType"), t(TYPE_KEY[item.type])],
              [t("common.category"), categoryLabel(item.categoryId, itemCategories, t("common.uncategorized"))],
              [t("items.brand"), item.brand ?? "—"],
              [t("items.costingMethod"), t(COSTING_KEY[item.costingMethod])],
              [t("items.trackStock"), item.trackInventory ? t("items.yes") : t("items.no")],
              [t("items.trackBatchesAndExpiryDates"), item.trackBatches || item.trackExpiry ? t("items.yes") : t("items.no")],
              [t("items.reorderPoint"), item.reorderPoint ?? "—"],
              [t("items.reorderQuantity"), item.reorderQty ?? "—"],
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
        label: t("items.unitsAndBarcodes"),
        content: (
          <div className="flex flex-col gap-[16px]">
            <Card className="p-[14px_16px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("items.baseUnit")}</div>
              <div className="mt-[5px] text-[13.5px] font-bold text-ink">
                {unitLabel(item.baseUnitCode, itemUnits)} ({item.baseUnitCode})
              </div>
            </Card>
            <div>
              <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("items.alternateUnits")}</h3>
              {item.alternateUnits.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-[16px] text-center text-[12.5px] text-ink-muted">{t("items.noAlternateUnitsOfMeasure")}</div>
              ) : (
                <Card className="overflow-hidden">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="border-b border-border px-[12px] py-[9px] text-start font-bold text-ink-muted">{t("common.unit")}</th>
                        <th className="border-b border-border px-[12px] py-[9px] text-start font-bold text-ink-muted">{t("common.code")}</th>
                        <th className="border-b border-border px-[12px] py-[9px] text-end font-bold text-ink-muted">{t("items.conversion")}</th>
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
              <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("items.barcode")}</h3>
              {item.barcodes.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-[16px] text-center text-[12.5px] text-ink-muted">{t("items.noBarcodesRecorded")}</div>
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
        label: t("items.pricing"),
        content: (
          <Card className="grid grid-cols-2 overflow-hidden">
            <div className="border-e border-border p-[15px_17px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("items.salePrice")}</div>
              <div className="mt-[6px]">
                <Money value={Number(item.salePrice ?? 0)} />
              </div>
            </div>
            <div className="p-[15px_17px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("items.costPrice")}</div>
              <div className="mt-[6px]">
                <Money value={Number(item.costPrice ?? 0)} />
              </div>
            </div>
          </Card>
        ),
      },
      {
        key: "accounting",
        label: t("items.accounts"),
        content: (
          <div className="flex flex-col gap-[16px]">
            <Card className="grid grid-cols-1 overflow-hidden sm:grid-cols-3">
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">{t("items.revenueAccount")}</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{glAccountLabel(item.revenueAccountId)}</div>
              </div>
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">{t("items.costAccount")}</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{glAccountLabel(item.cogsAccountId)}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("items.inventoryAccount")}</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{glAccountLabel(item.inventoryAccountId)}</div>
              </div>
            </Card>
            <Card className="grid grid-cols-1 overflow-hidden sm:grid-cols-3">
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">{t("items.etaCodeType")}</div>
                <div className="mt-[5px] text-[13px] font-bold text-ink">{item.etaCodeType ? ETA_CODE_TYPE_LABEL[item.etaCodeType] : "—"}</div>
              </div>
              <div className="border-b border-e border-border p-[13px_15px] sm:border-b-0">
                <div className="text-[11px] font-semibold text-ink-faint">{t("items.itemCodeWithTheAuthority")}</div>
                <div className="mz-num mt-[5px] text-[13px] font-bold text-ink">{item.etaItemCode ?? "—"}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("items.gpcCode")}</div>
                <div className="mz-num mt-[5px] text-[13px] font-bold text-ink">{item.gpcCode ?? "—"}</div>
              </div>
            </Card>
          </div>
        ),
      },
      {
        key: "stock",
        label: t("items.stock"),
        content: <ItemStockTab itemId={item.id} />,
      },
      {
        key: "costLayers",
        label: t("items.tab.costLayers"),
        content: <ItemCostLayersTab itemId={item.id} />,
      },
    ];

    return (
      <div className="w-full">
        <DocumentDetail
          title={`${item.code} — ${item.nameAr}`}
          statusLabel={t(STATUS_KEY[item.status])}
          statusTone={STATUS_TONE[item.status]}
          subtitle={`${t(TYPE_KEY[item.type])} · ${categoryLabel(item.categoryId, itemCategories, t("common.uncategorized"))}`}
          actions={
            <>
              <Button
                onClick={() => {
                  setView("list");
                  setSelectedId(null);
                }}
              >
                {t("items.backToTheList")}
              </Button>
              <Button variant="primary" onClick={() => openEditForm(item)}>
                {t("common.edit")}
              </Button>
            </>
          }
          summary={[
            { label: t("items.itemType"), value: t(TYPE_KEY[item.type]) },
            { label: t("common.category"), value: categoryLabel(item.categoryId, itemCategories, t("common.uncategorized")) },
            { label: t("common.unit"), value: unitLabel(item.baseUnitCode, itemUnits) },
            { label: t("items.costingMethod"), value: t(COSTING_KEY[item.costingMethod]) },
            { label: t("items.salePrice"), value: <Money value={Number(item.salePrice ?? 0)} /> },
            { label: t("items.costPrice"), value: <Money value={Number(item.costPrice ?? 0)} /> },
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
          <p className="text-[13px] font-semibold text-danger-ink">{t("items.itemsCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<ItemDTO>
        title={t("items.items")}
        description={t("items.theMasterCatalogueOfProducts")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("items.addItem")}
          </Button>
        }
        stats={[
          { label: t("items.totalItems"), value: <span className="mz-num">{totalCount}</span> },
          { label: t("common.active"), value: <span className="mz-num">{activeCount}</span> },
          { label: t("items.stockItems"), value: <span className="mz-num">{stockTrackedCount}</span> },
          { label: t("items.nonStockItems"), value: <span className="mz-num">{totalCount - stockTrackedCount}</span> },
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
        searchPlaceholder={t("items.searchByNameOrCode")}
        filterBarExtra={
          <>
            <Select
              size="sm"
              className="w-[180px]"
              aria-label={t("items.filterByCategory")}
              value={categoryFilter}
              onChange={(value) => {
                setCategoryFilter(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: t("items.allCategories") },
                ...itemCategories.map((c) => ({ value: c.id, label: c.nameAr })),
              ]}
            />
            <Select
              size="sm"
              className="w-[160px]"
              aria-label={t("items.filterByUnit")}
              value={unitFilter}
              onChange={(value) => {
                setUnitFilter(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: t("items.allUnits") },
                ...itemUnits.map((u) => ({ value: u.code, label: u.nameAr })),
              ]}
            />
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
            {t("common.show")} <span className="mz-num">{pageRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</span> {t("common.of")}{" "}
            <span className="mz-num">{filtered.length}</span> {t("items.items2")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("items.noMatchingItems")}</div>}
      />
      {formPanel}
    </div>
  );
}
