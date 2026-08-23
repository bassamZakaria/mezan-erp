import { useMemo, useState } from "react";
import { Button, Card, LabelSheetView, type LabelSheetEntry, type LabelSheetLayout } from "@mezan/ui";
import type { ItemDTO, LabelLayoutDTO } from "@mezan/contracts";
import { useItems } from "../data/hooks";
import { useItemCategories } from "../data/item-catalog-hooks";
import { useStockAdjustments, useStockTransfers } from "../data/inventory-ops-hooks";
import { useLabelLayouts } from "../data/label-hooks";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";

/**
 * طباعة الملصقات والباركود (label / barcode printing) — docs/catalog/03.
 * Pick items (by search, by category, or from a stock document), pick a
 * sticker layout and copies per item, then print the sheet through the SAME
 * print pipeline every document uses (`LabelSheetView` → `PrintToolbar` →
 * window.print / Electron printToPDF).
 */

type SourceMode = "search" | "category" | "document";

const SOURCE_LABEL: Record<SourceMode, string> = {
  search: "بحث في الأصناف",
  category: "حسب التصنيف",
  document: "من مستند مخزني",
};

function toSheetLayout(layout: LabelLayoutDTO): LabelSheetLayout {
  return {
    pageSize: layout.pageSize,
    columns: layout.columns,
    rows: layout.rows,
    labelWidthMm: layout.labelWidthMm,
    labelHeightMm: layout.labelHeightMm,
    columnGapMm: layout.columnGapMm,
    rowGapMm: layout.rowGapMm,
    marginBlockMm: layout.marginBlockMm,
    marginInlineMm: layout.marginInlineMm,
    showItemName: layout.showItemName,
    showItemCode: layout.showItemCode,
    showPrice: layout.showPrice,
    showUnit: layout.showUnit,
    showBarcode: layout.showBarcode,
    showBarcodeText: layout.showBarcodeText,
    barcodeHeightMm: layout.barcodeHeightMm,
  };
}

/** Qty arrives as an exact decimal string; take its whole part as the copy count. */
function wholePartOf(qty: string): number {
  const whole = Number.parseInt(qty.split(".")[0] ?? "0", 10);
  return Number.isFinite(whole) ? Math.max(1, whole) : 1;
}

export function LabelPrintingScreen() {
  const itemsQuery = useItems();
  const categoriesQuery = useItemCategories();
  const layoutsQuery = useLabelLayouts();
  const adjustmentsQuery = useStockAdjustments("confirmed");
  const transfersQuery = useStockTransfers("confirmed");

  const [mode, setMode] = useState<SourceMode>("search");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [layoutId, setLayoutId] = useState("");
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [defaultCopies, setDefaultCopies] = useState(1);
  const [fallbackToCode, setFallbackToCode] = useState(false);

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const categories = categoriesQuery.data ?? [];
  const layouts = useMemo(
    () => (layoutsQuery.data ?? []).filter((l) => l.active),
    [layoutsQuery.data],
  );

  const documents = useMemo(() => {
    const adjustments = (adjustmentsQuery.data ?? []).map((doc) => ({
      id: doc.id,
      label: `تسوية ${doc.docNo ?? doc.id} — ${doc.date}`,
      itemQtys: doc.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    }));
    const transfers = (transfersQuery.data ?? []).map((doc) => ({
      id: doc.id,
      label: `تحويل ${doc.docNo ?? doc.id} — ${doc.date}`,
      itemQtys: doc.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    }));
    return [...adjustments, ...transfers];
  }, [adjustmentsQuery.data, transfersQuery.data]);

  const activeLayout = useMemo(
    () => layouts.find((l) => l.id === layoutId) ?? layouts[0] ?? null,
    [layouts, layoutId],
  );

  const visibleItems = useMemo(() => {
    if (mode === "category") {
      return categoryId === "" ? [] : items.filter((i) => i.categoryId === categoryId);
    }
    if (mode === "document") {
      const doc = documents.find((d) => d.id === documentId);
      if (!doc) return [];
      const ids = new Set(doc.itemQtys.map((l) => l.itemId));
      return items.filter((i) => ids.has(i.id));
    }
    const q = search.trim().toLowerCase();
    if (q === "") return items;
    return items.filter(
      (i) =>
        i.nameAr.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        i.barcodes.some((b) => b.toLowerCase().includes(q)),
    );
  }, [mode, items, search, categoryId, documentId, documents]);

  const selectedItems = useMemo(
    () => items.filter((i) => (copies[i.id] ?? 0) > 0),
    [items, copies],
  );

  const entries: LabelSheetEntry[] = useMemo(
    () =>
      selectedItems.map((item) => ({
        key: item.id,
        name: item.nameAr,
        code: item.code,
        unit: item.baseUnitCode,
        price: item.salePrice,
        barcode: item.barcodes[0] ?? (fallbackToCode ? item.code : null),
        copies: copies[item.id] ?? 0,
      })),
    [selectedItems, copies, fallbackToCode],
  );

  const totalLabels = entries.reduce((sum, e) => sum + e.copies, 0);
  const perPage = activeLayout ? activeLayout.columns * activeLayout.rows : 0;
  const pageCount = perPage > 0 ? Math.ceil(totalLabels / perPage) : 0;

  function toggleItem(item: ItemDTO) {
    setCopies((prev) => {
      const next = { ...prev };
      if ((next[item.id] ?? 0) > 0) delete next[item.id];
      else next[item.id] = defaultCopies;
      return next;
    });
  }

  function setItemCopies(itemId: string, value: number) {
    setCopies((prev) => ({ ...prev, [itemId]: Math.max(0, Math.floor(value) || 0) }));
  }

  function selectAllVisible() {
    setCopies((prev) => {
      const next = { ...prev };
      for (const item of visibleItems) next[item.id] = next[item.id] ?? defaultCopies;
      return next;
    });
  }

  function selectFromDocument() {
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) return;
    setCopies((prev) => {
      const next = { ...prev };
      for (const line of doc.itemQtys) next[line.itemId] = wholePartOf(line.qty);
      return next;
    });
  }

  return (
    <div className="w-full">
      <div className="mb-[22px]">
        <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">
          Inventory · Labels
        </div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">طباعة الملصقات والباركود</h1>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">
          اختر الأصناف وعدد النسخ وتخطيط الملصقات، ثم اطبع الورقة مباشرة.
        </p>
      </div>

      <div className="flex flex-col gap-[16px] xl:flex-row xl:items-start">
        <div className="flex w-full flex-col gap-[14px] xl:max-w-[560px]">
          <Card className="flex flex-col gap-[12px] p-[16px]">
            <div className="flex flex-wrap gap-[6px]">
              {(Object.keys(SOURCE_LABEL) as SourceMode[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`rounded-full border px-[12px] py-[5px] text-[12px] font-semibold transition-colors ${
                    mode === key
                      ? "border-brand bg-brand-soft text-brand-ink"
                      : "border-border bg-surface text-ink-muted hover:text-ink"
                  }`}
                >
                  {SOURCE_LABEL[key]}
                </button>
              ))}
            </div>

            {mode === "search" ? (
              <TextField label="بحث" value={search} onChange={setSearch} placeholder="اسم الصنف أو الكود أو الباركود..." />
            ) : null}
            {mode === "category" ? (
              <SelectField
                label="التصنيف"
                value={categoryId}
                onChange={setCategoryId}
                options={[
                  { value: "", label: "— اختر تصنيفاً —" },
                  ...categories.map((c) => ({ value: c.id, label: c.nameAr })),
                ]}
                hint={categories.length === 0 ? "لا توجد تصنيفات معرّفة بعد." : undefined}
              />
            ) : null}
            {mode === "document" ? (
              <div className="flex flex-col gap-[10px]">
                <SelectField
                  label="المستند المخزني"
                  value={documentId}
                  onChange={setDocumentId}
                  options={[
                    { value: "", label: "— اختر مستنداً —" },
                    ...documents.map((d) => ({ value: d.id, label: d.label })),
                  ]}
                  hint={documents.length === 0 ? "لا توجد مستندات مخزنية مؤكدة." : undefined}
                />
                <div>
                  <Button onClick={selectFromDocument} disabled={documentId === ""}>
                    تحميل أصناف المستند بكمياتها
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-[10px]">
              <div className="w-[150px]">
                <NumberField
                  label="عدد النسخ الافتراضي"
                  min={1}
                  value={defaultCopies}
                  onChange={(v) => setDefaultCopies(Math.max(1, Math.floor(v) || 1))}
                />
              </div>
              <Button onClick={selectAllVisible} disabled={visibleItems.length === 0}>
                تحديد الكل ({visibleItems.length})
              </Button>
              <Button onClick={() => setCopies({})} disabled={selectedItems.length === 0}>
                مسح التحديد
              </Button>
            </div>

            <ToggleField
              label="استخدام كود الصنف كباركود عند عدم وجود باركود"
              checked={fallbackToCode}
              onChange={setFallbackToCode}
            />
          </Card>

          <Card className="overflow-hidden">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="sticky top-0 border-b border-border bg-surface-2 px-[12px] py-[9px] text-start text-[11px] font-bold uppercase text-ink-muted">
                      الصنف
                    </th>
                    <th scope="col" className="sticky top-0 border-b border-border bg-surface-2 px-[12px] py-[9px] text-start text-[11px] font-bold uppercase text-ink-muted">
                      الباركود
                    </th>
                    <th scope="col" className="sticky top-0 border-b border-border bg-surface-2 px-[12px] py-[9px] text-end text-[11px] font-bold uppercase text-ink-muted">
                      النسخ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const itemCopies = copies[item.id] ?? 0;
                    return (
                      <tr key={item.id} className="border-b border-border last:border-b-0">
                        <td className="px-[12px] py-[8px]">
                          <label className="flex items-center gap-[8px] text-ink">
                            <input
                              type="checkbox"
                              checked={itemCopies > 0}
                              onChange={() => toggleItem(item)}
                              className="size-[15px] accent-[var(--mz-brand,#2563eb)]"
                            />
                            <span>
                              {item.nameAr} <span className="mz-num text-ink-faint">({item.code})</span>
                            </span>
                          </label>
                        </td>
                        <td className="px-[12px] py-[8px]">
                          {item.barcodes[0] ? (
                            <span className="mz-num text-ink-muted" dir="ltr">
                              {item.barcodes[0]}
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-ink-faint">لا يوجد</span>
                          )}
                        </td>
                        <td className="px-[12px] py-[6px] text-end">
                          <input
                            type="number"
                            min={0}
                            aria-label={`عدد نسخ ملصق ${item.nameAr}`}
                            value={itemCopies}
                            onChange={(e) => setItemCopies(item.id, e.target.valueAsNumber)}
                            className="mz-num w-[80px] rounded-md border border-border bg-surface px-[8px] py-[6px] text-end text-[12.5px] text-ink outline-none focus:border-brand"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleItems.length === 0 ? (
                <div className="p-[20px] text-center text-[12.5px] text-ink-muted">
                  {itemsQuery.isLoading ? "جارِ التحميل…" : "لا توجد أصناف مطابقة."}
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="flex w-full flex-col gap-[14px]">
          <Card className="flex flex-col gap-[12px] p-[16px]">
            <SelectField
              label="تخطيط الملصقات"
              value={activeLayout?.id ?? ""}
              onChange={setLayoutId}
              options={layouts.map((l) => ({ value: l.id, label: l.nameAr }))}
              hint={
                layouts.length === 0
                  ? "لا توجد تخطيطات ملصقات معرّفة — عرّف تخطيطاً واحداً على الأقل."
                  : undefined
              }
            />
            <div className="flex flex-wrap gap-x-[20px] gap-y-[6px] text-[12px] text-ink-muted">
              <span>
                الأصناف المحددة: <span className="mz-num font-semibold text-ink">{selectedItems.length}</span>
              </span>
              <span>
                إجمالي الملصقات: <span className="mz-num font-semibold text-ink">{totalLabels}</span>
              </span>
              <span>
                ملصقات لكل صفحة: <span className="mz-num font-semibold text-ink">{perPage}</span>
              </span>
              <span>
                عدد الصفحات: <span className="mz-num font-semibold text-ink">{pageCount}</span>
              </span>
            </div>
          </Card>

          {activeLayout ? (
            <LabelSheetView layout={toSheetLayout(activeLayout)} entries={entries} />
          ) : (
            <Card className="p-[20px] text-center text-[12.5px] text-ink-muted">
              {layoutsQuery.isLoading
                ? "جارِ تحميل التخطيطات…"
                : layoutsQuery.isError
                  ? (layoutsQuery.error?.message ?? "تعذّر تحميل تخطيطات الملصقات.")
                  : "لا يوجد تخطيط ملصقات لعرض المعاينة."}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
