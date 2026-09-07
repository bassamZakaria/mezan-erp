import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { matchesSearch } from "@mezan/domain";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  IconButton,
  RowMenu,
  Money,
  Qty,
  MoneyInput,
  Select,
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
import {
  useAccounts,
  useCreateItem,
  useItemBrands,
  useItemCategories,
  useItemSeasons,
  useItemStock,
  useItemUnits,
  useItems,
  useItemCounts,
  useItemStats,
  type ItemListFilter,
  useUpdateItem,
  usePriceLists,
  useSuppliers,
  useWarehouses,
  useEntityAudit,
  useItemMovements,
  useUpdatePriceList,
} from "../data/hooks";
import { useItemSpecifications } from "../data/item-catalog-hooks";
import { entityName, useEntityName } from "../lib/entity-names";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { useAttachments } from "../data/attachment-hooks";
import { FormColumns, FormError, FormPage, SectionCard, TextAreaField } from "../settings/form-controls";

import { categoryLabel, unitLabel } from "../lib/item-labels";
import { Field, FieldGroup, NumberField, SelectField, TextField, ToggleField } from "./item-form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { sumMajor } from "../lib/money";
import { useNavigation, useSubPage } from "../navigation";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

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
const PAGE_SIZES = [5, 10, 25, 50, 100] as const;

/** Draft shape for the add/edit panel. Money fields are plain numbers here (MoneyInput's contract) — converted to/from the ItemDTO's decimal-string wire shape on submit/load. */
/**
 * A draft alternate-unit row, carrying a client-only `rowId`.
 *
 * The row is three text inputs the user edits and can delete from the middle
 * of the list, and `AlternateUnitDTO` has no stable field to key it by — the
 * code is what they are typing, so it is empty on a new row and changes on
 * every keystroke. Keyed by array index instead, deleting row 1 of 3 shifts
 * rows 2 and 3 up onto the previous indices: React reuses the DOM nodes and
 * the caret jumps to a different row mid-edit.
 *
 * `rowId` never leaves this screen — `toCommand` strips it before the item is
 * sent, since the wire contract has no such field and a zod schema would drop
 * it silently anyway.
 */
type DraftAlternateUnit = AlternateUnitDTO & { rowId: string };

const newAlternateUnitRow = (): DraftAlternateUnit => ({
  rowId: crypto.randomUUID(),
  code: "",
  name: "",
  factor: 1,
});

const withRowIds = (units: readonly AlternateUnitDTO[]): DraftAlternateUnit[] =>
  units.map((u) => ({ ...u, rowId: crypto.randomUUID() }));

const stripRowIds = (units: readonly DraftAlternateUnit[]): AlternateUnitDTO[] =>
  units.map(({ rowId: _rowId, ...unit }) => unit);

interface ItemDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: ItemTypeDTO;
  baseUnitCode: string;
  alternateUnits: DraftAlternateUnit[];
  barcodes: string[];
  categoryId: string | null;
  brandId: string;
  description: string;
  defaultSupplierId: string;
  seasonId: string;
  specifications: { code: string; value: string }[];
  costingMethod: CostingMethodDTO;
  salePrice: number | null;
  costPrice: number | null;
  taxRatePercent: number;
  trackInventory: boolean;
  trackBatches: boolean;
  reorderPoint: number | null;
  imageAttachmentId: string | null;
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
  brandId: "",
  description: "",
  defaultSupplierId: "",
  seasonId: "",
  specifications: [],
  costingMethod: "WAC",
  salePrice: null,
  costPrice: null,
  taxRatePercent: 14,
  trackInventory: true,
  trackBatches: false,
  reorderPoint: null,
  imageAttachmentId: null,
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
    alternateUnits: withRowIds(item.alternateUnits),
    barcodes: item.barcodes,
    categoryId: item.categoryId,
    brandId: item.brandId ?? "",
    description: item.description ?? "",
    defaultSupplierId: item.defaultSupplierId ?? "",
    seasonId: item.seasonId ?? "",
    specifications: [...(item.specifications ?? [])],
    costingMethod: item.costingMethod,
    salePrice: item.salePrice === null ? null : Number(item.salePrice),
    costPrice: item.costPrice === null ? null : Number(item.costPrice),
    taxRatePercent: item.taxRatePercent,
    trackInventory: item.trackInventory,
    trackBatches: item.trackBatches || item.trackExpiry,
    reorderPoint: item.reorderPoint,
    imageAttachmentId: item.imageAttachmentId,
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
    alternateUnits: stripRowIds(draft.alternateUnits),
    barcodes: draft.barcodes,
    categoryId: draft.categoryId,
    brandId: draft.brandId === "" ? null : draft.brandId,
    description: draft.description.trim() === "" ? null : draft.description.trim(),
    defaultSupplierId: draft.defaultSupplierId === "" ? null : draft.defaultSupplierId,
    seasonId: draft.seasonId === "" ? null : draft.seasonId,
    // Blank values are absent values, not a specification set to "".
    specifications: draft.specifications.filter((spec) => spec.value.trim() !== ""),
    costingMethod: draft.costingMethod,
    salePrice: draft.salePrice === null ? null : draft.salePrice.toFixed(2),
    costPrice: draft.costPrice === null ? null : draft.costPrice.toFixed(2),
    taxRatePercent: draft.taxRatePercent,
    trackInventory: itemTypeTracksStock(draft.type) ? draft.trackInventory : false,
    trackBatches: itemTypeTracksStock(draft.type) && draft.trackInventory ? draft.trackBatches : false,
    trackExpiry: itemTypeTracksStock(draft.type) && draft.trackInventory ? draft.trackBatches : false,
    reorderPoint: draft.reorderPoint,
    imageAttachmentId: draft.imageAttachmentId,
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

/** الأصناف (Items) — docs/archive/catalog/03-inventory.md. List (KPI strip + filters + table + pager), item detail (tabs), add/edit form. */
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
  const totalReserved = sumMajor(positions.map((p) => p.reserved));
  const totalAvailable = sumMajor(positions.map((p) => p.available));
  const totalValue = sumMajor(positions.map((p) => p.totalValue));

  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
          <tr>
            <th className="px-[15px] py-[9px] text-start">{t("items.stock.warehouse")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.onHand")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.reserved")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.available")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.averageCost")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.stock.value")}</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.warehouseId} className="border-t border-border">
              <td className="px-[15px] py-[10px] text-ink">{warehouseName(position.warehouseId)}</td>
              <td className="mz-num px-[15px] py-[10px] text-end">{Number(position.onHand)}</td>
              <td className="mz-num px-[15px] py-[10px] text-end text-ink-muted">{Number(position.reserved)}</td>
              <td className="mz-num px-[15px] py-[10px] text-end font-semibold">{Number(position.available)}</td>
              <td className="px-[15px] py-[10px] text-end"><Money value={Number(position.averageCost)} /></td>
              <td className="px-[15px] py-[10px] text-end"><Money value={Number(position.totalValue)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-surface-2 font-bold">
            <td className="px-[15px] py-[10px]">{t("common.total")}</td>
            <td className="mz-num px-[15px] py-[10px] text-end">{totalOnHand}</td>
            <td className="mz-num px-[15px] py-[10px] text-end">{totalReserved}</td>
            <td className="mz-num px-[15px] py-[10px] text-end">{totalAvailable}</td>
            <td />
            <td className="px-[15px] py-[10px] text-end"><Money value={totalValue} /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/**
 * قوائم الأسعار — where this item is priced, and how far each list sits from
 * its own base price (R5.5). Derived from the price lists rather than stored
 * on the item, so a list edited elsewhere cannot leave a stale figure here.
 */
/**
 * Every price list quoting this item, one row per volume TIER (R3.11), each
 * editable in place (R5.4).
 *
 * Saving sends the list's whole `lines` array because that is the shape the
 * route takes — so every other line is carried through byte for byte, and only
 * the edited tier's price changes. Rewriting a list from a partial view is how
 * an edit to one item silently drops every other item's price.
 */
function ItemPriceListsTab({ item }: { item: ItemDTO }) {
  const { t } = useAppTranslation();
  const priceLists = usePriceLists().data ?? [];
  const updatePriceList = useUpdatePriceList();
  const base = Number(item.salePrice ?? 0);
  // Keyed per row, never a mutation-wide flag: one saving row must not disable
  // the others.
  const [editing, setEditing] = useState<Record<string, number>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = priceLists.flatMap((list) =>
    list.lines
      .filter((line) => line.itemId === item.id)
      .map((line) => ({ list, line, key: `${list.id}:${line.minQty ?? "0"}` })),
  );

  if (rows.length === 0) {
    return <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("items.priceLists.empty")}</div>;
  }

  async function save(list: (typeof priceLists)[number], minQty: string | null | undefined, key: string) {
    const next = editing[key];
    if (next === undefined) return;
    setSavingKey(key);
    setError(null);
    try {
      await updatePriceList.mutateAsync({
        id: list.id,
        patch: {
          lines: list.lines.map((line) =>
            line.itemId === item.id && (line.minQty ?? "0") === (minQty ?? "0")
              ? { itemId: line.itemId, unitCode: line.unitCode, minQty: line.minQty ?? undefined, price: next.toFixed(2) }
              : { itemId: line.itemId, unitCode: line.unitCode, minQty: line.minQty ?? undefined, price: line.price },
          ),
        },
      });
      setEditing((prev) => {
        const { [key]: _saved, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("items.priceLists.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      {error ? <p className="border-b border-border px-[15px] py-[8px] text-[12px] font-semibold text-danger-ink">{error}</p> : null}
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
          <tr>
            <th className="px-[15px] py-[9px] text-start">{t("items.priceLists.list")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.priceLists.tier")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.priceLists.basePrice")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.priceLists.customPrice")}</th>
            <th className="px-[15px] py-[9px] text-end">{t("items.priceLists.delta")}</th>
            <th className="px-[15px] py-[9px] text-end" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ list, line, key }) => {
            const stored = Number(line.price);
            const shown = editing[key] ?? stored;
            const delta = shown - base;
            const dirty = editing[key] !== undefined && editing[key] !== stored;
            return (
              <tr key={key} className="border-t border-border">
                <td className="px-[15px] py-[10px] text-ink">
                  {list.nameAr}
                  {list.isBase ? <span className="ms-[6px] text-[11px] text-ink-faint">({t("items.priceLists.baseList")})</span> : null}
                </td>
                <td className="mz-num px-[15px] py-[10px] text-end text-ink-muted">{line.minQty ?? "0"}</td>
                <td className="px-[15px] py-[10px] text-end"><Money value={base} /></td>
                <td className="px-[15px] py-[10px] text-end">
                  <MoneyInput
                    value={shown}
                    onChange={(v) => setEditing((prev) => ({ ...prev, [key]: v ?? 0 }))}
                    aria-label={`${list.nameAr} — ${t("items.priceLists.customPrice")}`}
                    disabled={savingKey === key}
                  />
                </td>
                <td className={`px-[15px] py-[10px] text-end ${delta > 0 ? "text-success-ink" : delta < 0 ? "text-danger-ink" : "text-ink-faint"}`}>
                  {delta === 0 ? "—" : <Money value={delta} />}
                </td>
                <td className="px-[15px] py-[10px] text-end">
                  {dirty ? (
                    <Button size="sm" variant="primary" disabled={savingKey === key} onClick={() => save(list, line.minQty, key)}>
                      {t("items.priceLists.save")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** طبقات التكلفة — the immutable WAC layers still holding stock (D43, R5.5). */
/**
 * The item's own specification values, named by the catalogue definition rather
 * than by the raw code. The definition carries nameEn, so the label follows the
 * reading language instead of printing Arabic into the English UI (D49).
 */
/**
 * The item's picture, chosen from the item's OWN attachments. The bytes live in
 * the attachments resource, which already owns storage, permissions and
 * deletion — the item record holds only the id. A brand-new item has nothing to
 * attach to yet, which is why it gets a hint instead of a dead control.
 */
function ItemImageField({
  itemId,
  value,
  onChange,
}: {
  itemId: string | null;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useAppTranslation();
  const attachments = useAttachments("item", itemId).data ?? [];
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));

  if (!itemId) {
    return (
      <div className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12px] text-ink-muted">
        {t("items.image.newItem")}
      </div>
    );
  }
  if (images.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12px] text-ink-muted">
        {t("items.image.noImages")}
      </div>
    );
  }
  return (
    <SelectField
      label={t("items.field.image")}
      value={value ?? ""}
      onChange={(v) => onChange(v === "" ? null : v)}
      options={[{ value: "", label: t("items.image.none") }, ...images.map((a) => ({ value: a.id, label: a.fileName }))]}
      hint={t("items.image.hint")}
    />
  );
}

function ItemSpecificationsTab({ item }: { item: ItemDTO }) {
  const { t, locale } = useAppTranslation();
  const definitions = useItemSpecifications().data ?? [];
  const values = (item.specifications ?? []).filter((spec) => spec.value.trim() !== "");
  if (values.length === 0) {
    return <p className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("items.specifications.empty")}</p>;
  }
  const nameOf = (code: string) => entityName(definitions.find((d) => d.code === code), locale, code);
  const unitOf = (code: string) => definitions.find((d) => d.code === code)?.unit ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
            <th className="px-[12px] py-[9px] text-start">{t("items.specifications.col.spec")}</th>
            <th className="px-[12px] py-[9px] text-start">{t("items.specifications.col.value")}</th>
          </tr>
        </thead>
        <tbody>
          {values.map((spec) => {
            const unit = unitOf(spec.code);
            return (
              <tr key={spec.code} className="border-b border-border last:border-b-0">
                <td className="px-[12px] py-[10px] text-ink">{nameOf(spec.code)}</td>
                <td className="px-[12px] py-[10px] text-ink">{unit ? `${spec.value} ${unit}` : spec.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ItemMovementsTab({ itemId }: { itemId: string }) {
  const { t } = useAppTranslation();
  const stock = useItemStock(itemId);
  const warehouses = useWarehouses().data ?? [];
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;
  const warehouseIds = useMemo(() => (stock.data?.positions ?? []).map((p) => p.warehouseId), [stock.data]);
  const query = useItemMovements(itemId, warehouseIds);
  const movements = query.data ?? [];

  if (movements.length === 0) {
    return <p className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("items.movements.empty")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
            <th className="px-[12px] py-[9px] text-start">{t("common.date")}</th>
            <th className="px-[12px] py-[9px] text-start">{t("items.movements.col.source")}</th>
            <th className="px-[12px] py-[9px] text-start">{t("stockBalance.filter.warehouse")}</th>
            <th className="px-[12px] py-[9px] text-start">{t("items.movements.col.direction")}</th>
            <th className="px-[12px] py-[9px] text-end">{t("common.qty")}</th>
            <th className="px-[12px] py-[9px] text-end">{t("items.costPrice")}</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-b-0">
              <td className="mz-num px-[12px] py-[10px]">{m.occurredAt.slice(0, 10)}</td>
              <td className="px-[12px] py-[10px] text-ink">{m.sourceDocNumber ?? m.sourceDocId ?? "—"}</td>
              <td className="px-[12px] py-[10px] text-ink-muted">{warehouseName(m.warehouseId)}</td>
              <td className="px-[12px] py-[10px]">
                {m.direction.toUpperCase() === "IN" ? t("items.movements.in") : t("items.movements.out")}
              </td>
              <td className="mz-num px-[12px] py-[10px] text-end">{m.qty}</td>
              <td className="mz-num px-[12px] py-[10px] text-end">
                <Money value={Number(m.unitCost)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemAuditTab({ itemId }: { itemId: string }) {
  const { t } = useAppTranslation();
  const query = useEntityAudit("ITEM", itemId);
  const events = query.data ?? [];
  if (events.length === 0) {
    return <p className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("items.audit.empty")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
            <th className="px-[12px] py-[9px] text-start">{t("audit.dateAndTime")}</th>
            <th className="px-[12px] py-[9px] text-start">{t("audit.action")}</th>
            <th className="px-[12px] py-[9px] text-start">{t("audit.user")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              <td className="mz-num px-[12px] py-[10px]">{e.timestamp}</td>
              <td className="px-[12px] py-[10px]">{e.action}</td>
              <td className="px-[12px] py-[10px]">{e.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

/**
 * The sortable columns the ROUTE can order by. The order is applied server-side
 * because the list is a page now, and sorting a page instead of the set
 * reorders rows within a page while leaving the pages themselves arbitrary. A
 * column outside this set falls back to the document code rather than silently
 * asking for an order the server does not have.
 */
const SERVER_SORT_KEYS = ["code", "nameAr", "salePrice", "costPrice"] as const;
function serverSortKey(key: string): (typeof SERVER_SORT_KEYS)[number] {
  return SERVER_SORT_KEYS.find((k) => k === key) ?? "code";
}

export function ItemsScreen() {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const { openScreenAt, navigate } = useNavigation();
  const brands = useItemBrands().data ?? [];
  const suppliers = useSuppliers().data ?? [];
  const seasons = useItemSeasons().data ?? [];
  const specifications = useItemSpecifications().data ?? [];
  const brandName = (id: string | null | undefined) => (id ? nameOf(brands.find((b) => b.id === id), id) : "—");
  const seasonName = (id: string | null | undefined) => (id ? nameOf(seasons.find((x) => x.id === id), id) : "—");
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const accountsQuery = useAccounts();
  const unitsQuery = useItemUnits();
  const categoriesQuery = useItemCategories();
  const glAccounts = accountsQuery.data ?? EMPTY;
  const itemUnits = unitsQuery.data ?? [];
  const itemCategories = categoriesQuery.data ?? EMPTY;

  function glAccountLabel(id: string | null): string {
    if (!id) return t("items.defaultForTheItemType");
    const account = glAccounts.find((a) => a.id === id);
    return account ? `${account.code} — ${nameOf(account)}` : id;
  }

  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("general");

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusChipKey, setStatusChipKey] = useState("all");
  const [brandFilter, setBrandFilter] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useUrlParam("category", "all") as [
    string,
    (next: string) => void,
  ];
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [sort, setSort] = useState<DocumentListSort>({ key: "code", direction: "asc" });
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 5);

  /**
   * The form is a sub-page: `…/items/items/new` adds and
   * `…/items/items/<code>` edits. The target is READ from the address instead
   * of being set by the click that opened a panel, so an edit form survives a
   * reload and can be linked to.
   */
  const subPage = useSubPage();
  const [formSegment] = subPage.segments;
  const isEditing = formSegment !== undefined && formSegment !== "new";
  const [draft, setDraft] = useState<ItemDraft>(BLANK_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1). All three
   * used to be derived in the browser from `baseRows` — everything narrowed
   * EXCEPT the chip — which is right for a chip and wrong for the strip: the
   * tiles went on reporting the whole catalogue while a chip narrowed the
   * table beneath them.
   */
  const filter = useMemo<ItemListFilter>(
    () => ({
      status: statusChipKey,
      categoryId: categoryFilter,
      brandId: brandFilter || undefined,
      seasonId: seasonFilter || undefined,
      unitCode: unitFilter,
      search: search.trim() || undefined,
    }),
    [statusChipKey, categoryFilter, brandFilter, seasonFilter, unitFilter, search],
  );

  // Only the ROWS query carries the page and the sort (Q-9): the screen used
  // to fetch the whole catalogue and slice it here, and the chips and the KPI
  // strip still speak for the whole filtered set.
  const query = useItems({ ...filter, page, pageSize, sort: serverSortKey(sort.key), sortDir: sort.direction });
  const items = query.data ?? EMPTY;
  const counts = useItemCounts(filter).data ?? {};
  const stats = useItemStats(filter).data ?? {};

  const totalCount = counts.all ?? 0;
  const activeCount = counts.active ?? 0;
  const lowStockCount = counts.low_stock ?? 0;
  const outOfStockCount = counts.out_of_stock ?? 0;

  // What the server returned IS the page, already in the requested order.
  const filtered = items;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageRows = filtered;

  const activeFilterCount =
    (statusChipKey !== "all" ? 1 : 0) +
    (categoryFilter !== "all" ? 1 : 0) +
    (brandFilter !== "" ? 1 : 0) +
    (seasonFilter !== "" ? 1 : 0) +
    (unitFilter !== "all" ? 1 : 0);

  const categoryOptions: EntityPickerOption[] = useMemo(
    () => [{ id: NO_CATEGORY_ID, label: t(NO_CATEGORY_KEY) }, ...itemCategories.map((c) => ({ id: c.id, label: nameOf(c) }))],
    [itemCategories, t, nameOf],
  );
  const glOptions: EntityPickerOption[] = useMemo(
    () => [{ id: DEFAULT_GL_ID, label: t(DEFAULT_GL_KEY) }, ...glAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${nameOf(a)}` }))],
    [glAccounts, t, nameOf],
  );

  const selectedItem = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;

  /**
   * The address carries the item CODE — `IT-0001` reads, a uuid does not — but
   * a uuid still resolves, so links written against the internal id keep
   * working.
   */
  const editingItem = isEditing ? (items.find((i) => i.code === formSegment || i.id === formSegment) ?? null) : null;
  const editingId = editingItem?.id ?? null;

  /**
   * Seeds the draft from whatever the address names, once per target.
   *
   * The ref guard is load-bearing: `items` is refetched after every mutation
   * and on window focus, and re-seeding on each of those would wipe out what
   * the user had typed mid-edit. It re-seeds only when the ADDRESS changes —
   * or when a reloaded edit URL's item finally arrives from the server, which
   * is the case a panel opened by a click never had to handle.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (formSegment === undefined) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === formSegment) return;
    if (formSegment === "new") {
      // NOT before the catalogue has loaded: `nextItemCode([])` is ITM-000001,
      // which is already taken, and the guard below would then keep that wrong
      // code for the life of the form.
      if (query.isLoading) return;
      setDraft({ ...BLANK_DRAFT, code: nextItemCode(items) });
    } else if (editingItem) {
      setDraft(draftFromItem(editingItem));
    } else {
      return;
    }
    seededFor.current = formSegment;
    setFormError(null);
  }, [formSegment, editingItem, items, query.isLoading]);

  function openCreateForm() {
    subPage.open("new");
  }

  function openEditForm(item: ItemDTO) {
    subPage.open(item.code);
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
      subPage.close();
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
    {
      key: "stock",
      header: t("items.col.stock"),
      align: "end",
      render: (row) =>
        // Null, not zero, for an item that holds no stock — a service has no
        // balance to be low on.
        row.onHand === null || row.onHand === undefined ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <div className="flex items-center justify-end gap-[8px]">
            <Qty value={row.onHand} />
            {row.stockState === "out" ? <StatusPill label={t("items.stockState.out")} tone="danger" /> : null}
            {row.stockState === "low" ? <StatusPill label={t("items.stockState.low")} tone="warning" /> : null}
          </div>
        ),
    },
    { key: "salePrice", header: t("items.salePrice"), align: "end", sortable: true, render: (row) => <Money value={Number(row.salePrice ?? 0)} /> },
    { key: "costPrice", header: t("items.costPrice"), align: "end", sortable: true, render: (row) => <Money value={Number(row.costPrice ?? 0)} /> },
    { key: "status", header: t("common.status"), render: (row) => <StatusPill label={t(STATUS_KEY[row.status])} tone={STATUS_TONE[row.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <div className="flex items-center justify-end gap-[4px]">
          <RowMenu
            label={t("items.editLabel", { name: row.nameAr })}
            items={[
              // Offered only where it applies: an item already holding stock
              // does not need an opening balance, and one that holds none at
              // all cannot have one (R5.3).
              ...(row.stockState === "out"
                ? [
                    {
                      key: "opening-balance",
                      label: t("items.action.setOpeningBalance"),
                      onSelect: () =>
                        openScreenAt("stock-adjustments", ["new", "INITIAL_STOCK", row.id]),
                    },
                  ]
                : []),
            ]}
          />
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
        </div>
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: totalCount },
    { key: "active", label: t("common.active"), count: activeCount },
    { key: "inactive", label: t("common.inactive"), count: counts.inactive ?? 0 },
    // The type axis shares one `status` parameter with the state axis, so the
    // route answers for it under a `type:` prefix.
    ...ITEM_TYPES.map((type) => ({ key: type, label: t(TYPE_KEY[type]), count: counts[`type:${type}`] ?? 0 })),
    { key: "low_stock", label: t("items.chip.lowStock"), count: lowStockCount },
    { key: "out_of_stock", label: t("items.chip.outOfStock"), count: outOfStockCount },
  ];

  const accountFields = (
    <>
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
    </>
  );

  const etaFields = (
    <>
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
    </>
  );

  const formPage = (
    <FormPage
      eyebrow={t("eyebrow.items.catalogue")}
      title={editingId ? t("items.editItem") : t("items.addItem")}
      description={t("items.identityAndCategoryPricingUnits")}
      actions={
        <>
          <Button type="button" onClick={subPage.close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="item-form" variant="primary">
            {editingId ? t("common.save") : t("common.add")}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormError message={formError} />

        <FormColumns
          aside={
            <>
              <SectionCard title={t("items.section.accounts")} description={t("items.section.accountsHint")} columns={1}>
                {accountFields}
              </SectionCard>
              <SectionCard title={t("items.section.eta")} columns={1}>
                {etaFields}
              </SectionCard>
              {editingId ? (
                <SectionCard title={t("items.section.status")} columns={1}>
                  <SelectField
                    label={t("common.status")}
                    value={draft.status}
                    onChange={(v) => setDraft((d) => ({ ...d, status: v as ItemStatusDTO }))}
                    options={[
                      { value: "active", label: t("common.active") },
                      { value: "inactive", label: t("common.inactive") },
                    ]}
                  />
                </SectionCard>
              ) : null}
            </>
          }
        >
        <SectionCard title={t("items.section.identity")} description={t("items.section.identityHint")}>
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

        </SectionCard>

        <SectionCard title={t("items.section.classification")}>
        <EntityPicker
          label={t("common.category")}
          options={categoryOptions}
          value={draft.categoryId ? (categoryOptions.find((o) => o.id === draft.categoryId) ?? null) : (categoryOptions[0] ?? null)}
          onChange={(option) => setDraft((d) => ({ ...d, categoryId: !option || option.id === NO_CATEGORY_ID ? null : option.id }))}
        />
        <SelectField
          label={t("items.defaultSupplier")}
          value={draft.defaultSupplierId}
          onChange={(v) => setDraft((d) => ({ ...d, defaultSupplierId: v }))}
          options={[
            { value: "", label: t("items.noDefaultSupplier") },
            ...suppliers.map((sup) => ({ value: sup.id, label: nameOf(sup) })),
          ]}
        />
        <SelectField
          label={t("items.brand")}
          value={draft.brandId}
          onChange={(v) => setDraft((d) => ({ ...d, brandId: v }))}
          options={[{ value: "", label: t("items.noBrand") }, ...brands.map((b) => ({ value: b.id, label: nameOf(b) }))]}
        />
        <SelectField
          label={t("items.season")}
          value={draft.seasonId}
          onChange={(v) => setDraft((d) => ({ ...d, seasonId: v }))}
          options={[{ value: "", label: t("items.noSeason") }, ...seasons.map((x) => ({ value: x.id, label: nameOf(x) }))]}
        />
        <div className="sm:col-span-2">
          <TextAreaField
            label={t("items.description")}
            value={draft.description}
            onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
          />
        </div>
        </SectionCard>

        {/* One control per specification the tenant defined, so an item's
            values are checked against the registry rather than typed free-hand
            (R5.10). A card of its own: as a single cell of the grid above, it
            stacked four controls down the start edge against dead space. */}
        {specifications.length > 0 ? (
          <SectionCard title={t("items.specifications")}>
            {specifications.map((spec) => {
                const current = draft.specifications.find((value) => value.code === spec.code)?.value ?? "";
                const setValue = (value: string) =>
                  setDraft((d) => ({
                    ...d,
                    specifications: [
                      ...d.specifications.filter((entry) => entry.code !== spec.code),
                      ...(value === "" ? [] : [{ code: spec.code, value }]),
                    ],
                  }));
                return spec.type === "select" ? (
                  <SelectField
                    key={spec.code}
                    label={spec.nameAr}
                    value={current}
                    onChange={setValue}
                    options={[{ value: "", label: "—" }, ...spec.values.map((value) => ({ value, label: value }))]}
                  />
                ) : (
                  <TextField
                    key={spec.code}
                    label={spec.unit ? `${spec.nameAr} (${spec.unit})` : spec.nameAr}
                    value={current}
                    onChange={setValue}
                  />
                );
            })}
          </SectionCard>
        ) : null}

        <SectionCard title={t("items.section.units")} description={t("items.section.unitsHint")}>
        <SelectField
          label={t("items.baseUnit")}
          required
          value={draft.baseUnitCode}
          onChange={(v) => setDraft((d) => ({ ...d, baseUnitCode: v }))}
          options={itemUnits.map((u) => ({ value: u.code, label: `${nameOf(u)} (${u.code})` }))}
        />

        <FieldGroup label={t("items.alternateUnitsOfMeasure")} hint={t("items.forExampleCarton12Pieces")} className="sm:col-span-2">
          <div className="flex flex-col gap-[8px]">
            {draft.alternateUnits.map((unit, index) => (
              <div key={unit.rowId} className="flex items-end gap-[6px]">
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
              onClick={() => setDraft((d) => ({ ...d, alternateUnits: [...d.alternateUnits, newAlternateUnitRow()] }))}
            >
              {t("items.addUnit")}
            </Button>
          </div>
        </FieldGroup>

        </SectionCard>

        <SectionCard title={t("items.section.barcodes")} columns={1}>
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

        </SectionCard>

        <SectionCard title={t("items.section.pricing")}>
        <Field label={t("items.salePrice")}>
          <MoneyInput aria-label={t("items.salePrice")} value={draft.salePrice} onChange={(v) => setDraft((d) => ({ ...d, salePrice: v }))} />
        </Field>
        <Field label={t("items.costPrice")}>
          <MoneyInput aria-label={t("items.costPrice")} value={draft.costPrice} onChange={(v) => setDraft((d) => ({ ...d, costPrice: v }))} />
        </Field>
        <NumberField label={t("items.taxRate")} value={draft.taxRatePercent} onChange={(v) => setDraft((d) => ({ ...d, taxRatePercent: v ?? 0 }))} min={0} />

        </SectionCard>

        {draft.type === "stock" ? (
          <SectionCard title={t("items.section.stockPolicy")}>
            <div className="sm:col-span-2">
              <ToggleField
                label={t("items.trackStock")}
                checked={draft.trackInventory}
                onChange={(v) => setDraft((d) => ({ ...d, trackInventory: v, trackBatches: v ? d.trackBatches : false }))}
                hint={t("items.deductedOnSaleToppedUp")}
              />
            </div>
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
            <div className="sm:col-span-2">
              <ToggleField
                label={t("items.trackBatchesAndExpiryDates")}
                checked={draft.trackBatches}
                disabled={!draft.trackInventory}
                onChange={(v) => setDraft((d) => ({ ...d, trackBatches: v }))}
                hint={t("items.fefoEarliestExpiryFirstFor")}
              />
            </div>
            <NumberField label={t("items.reorderPoint")} value={draft.reorderPoint} onChange={(v) => setDraft((d) => ({ ...d, reorderPoint: v }))} min={0} />
            <NumberField label={t("items.reorderQuantity")} value={draft.reorderQty} onChange={(v) => setDraft((d) => ({ ...d, reorderQty: v }))} min={0} />
            <div className="sm:col-span-2">
              <ItemImageField
                itemId={editingId}
                value={draft.imageAttachmentId}
                onChange={(id) => setDraft((d) => ({ ...d, imageAttachmentId: id }))}
              />
            </div>
          </SectionCard>
        ) : null}


        </FormColumns>
      </form>
    </FormPage>
  );

  /**
   * An edit address whose item never resolves must say so. Falling through to
   * the list would silently discard the edit the URL asked for.
   */
  if (formSegment === "new") return formPage;
  if (isEditing) {
    if (editingItem) return formPage;
    if (query.isLoading) return <div className="w-full p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>;
    return (
      <div className="w-full p-8 text-center text-sm text-ink-muted">
        {t("items.notFound")}
        <div className="mt-3">
          <Button variant="default" onClick={subPage.close}>
            {t("items.backToList")}
          </Button>
        </div>
      </div>
    );
  }

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
              [t("items.brand"), brandName(item.brandId)],
              [t("items.description"), item.description ?? "—"],
              [t("items.defaultSupplier"), item.defaultSupplierId ? (suppliers.find((sup) => sup.id === item.defaultSupplierId)?.nameAr ?? item.defaultSupplierId) : "—"],
              [t("items.season"), seasonName(item.seasonId)],
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
      {
        key: "priceLists",
        label: t("items.tab.priceLists"),
        content: <ItemPriceListsTab item={item} />,
      },
      {
        key: "specifications",
        label: t("items.tab.specifications"),
        content: <ItemSpecificationsTab item={item} />,
      },
      {
        key: "attachments",
        label: t("attachments.tab"),
        content: <AttachmentsTab entityType="item" entityId={item.id} />,
      },
      {
        key: "movements",
        label: t("items.tab.movements"),
        content: <ItemMovementsTab itemId={item.id} />,
      },
      {
        key: "audit",
        label: t("items.tab.audit"),
        content: <ItemAuditTab itemId={item.id} />,
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
              {/* `any` in the reason slot: the item is known, the reason is the
                  user's to choose, and it decides which account absorbs it. */}
              <Button onClick={() => openScreenAt("stock-adjustments", ["new", "any", item.id])}>
                {t("items.action.adjustStock")}
              </Button>
              <Button onClick={() => openScreenAt("stock-transfers", ["new", item.id])}>
                {t("items.action.transfer")}
              </Button>
              {/* This product has no requisition document; the purchase order IS
                  the request. "any" leaves the supplier open — on an item, the
                  buyer is precisely what has not been decided. */}
              <Button onClick={() => openScreenAt("purchase-orders", ["new", "any", item.id])}>
                {t("items.action.purchaseRequest")}
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
        loadFailed={query.isError}
        title={t("items.items")}
        description={t("items.theMasterCatalogueOfProducts")}
        actions={
          <>
            {/* Label printing is an action ON items, not a shelf of the
                workspace — it is how the list reaches `#/labels`, which no
                longer carries a nav row of its own. */}
            <Button onClick={() => navigate("labels")}>{t("items.printLabels")}</Button>
            <Button variant="primary" onClick={openCreateForm}>
              {t("items.addItem")}
            </Button>
          </>
        }
        listKey="items"
        statsCollapsible
        stats={[
          { label: t("items.totalItems"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("common.active"), value: <span className="mz-num">{stats.active ?? 0}</span> },
          { label: t("items.stockItems"), value: <span className="mz-num">{stats.stockTracked ?? 0}</span> },
          { label: t("items.nonStockItems"), value: <span className="mz-num">{stats.nonStock ?? 0}</span> },
        ]}
        attentionBanners={[
          {
            key: "out_of_stock",
            label: t("items.banner.outOfStock", { count: outOfStockCount }),
            count: outOfStockCount,
            tone: "danger",
            onApply: () => {
              setStatusChipKey("out_of_stock");
              setPage(1);
            },
          },
          {
            key: "low_stock",
            label: t("items.banner.lowStock", { count: lowStockCount }),
            count: lowStockCount,
            tone: "warning",
            onApply: () => {
              setStatusChipKey("low_stock");
              setPage(1);
            },
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusChipKey}
        onStatusChange={(key) => {
          setStatusChipKey(key);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("items.searchByNameOrCode")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
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
              className="w-[170px]"
              aria-label={t("items.filter.brand")}
              value={brandFilter}
              onChange={(value) => {
                setBrandFilter(value);
                setPage(1);
              }}
              options={[
                { value: "", label: t("items.filter.allBrands") },
                ...brands.map((b) => ({ value: b.id, label: nameOf(b) })),
              ]}
            />
            <Select
              size="sm"
              className="w-[170px]"
              aria-label={t("items.filter.season")}
              value={seasonFilter}
              onChange={(value) => {
                setSeasonFilter(value);
                setPage(1);
              }}
              options={[
                { value: "", label: t("items.filter.allSeasons") },
                ...seasons.map((x) => ({ value: x.id, label: nameOf(x) })),
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
        loading={query.isLoading}
        rowKey={(row) => row.id}
        onRowClick={openDetail}
        sort={sort}
        onSortChange={(key) => setSort((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }))}
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
            {t("common.show")} <span className="mz-num">{pageRows.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)}</span> {t("common.of")}{" "}
            <span className="mz-num">{filtered.length}</span> {t("items.items2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("items.noMatchingItems")}
            description={t("items.emptyBody")}
            action={{ label: t("items.addItem"), onClick: openCreateForm }}
          />
        }
      />
    </div>
  );
}
