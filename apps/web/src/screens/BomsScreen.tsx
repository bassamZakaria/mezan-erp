import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EntityPicker,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { useBoms, useCreateBom, useDeactivateBom, useItems, type BomRecord } from "../data/hooks";
import { useUnitLabel } from "../lib/item-labels";
import { TextField, NumberField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

type BomStatus = BomRecord["status"];

const STATUS_KEY: Record<BomStatus, AppTranslationKey> = { active: "boms.status.active", inactive: "boms.status.inactive" };
const STATUS_TONE: Record<BomStatus, PillTone> = { active: "success", inactive: "neutral" };
const num = (v: string) => Number(v);

/** grossUpForWaste (packages/domain/src/manufacturing/bom.ts): effective qty = qty × (1 + wastePercent/100). */
function effectiveQty(qty: string, wastePercent: number): number {
  return num(qty) * (1 + wastePercent / 100);
}

interface DraftLine {
  itemId: string;
  qty: number;
  wastePercent: number;
}

function BomDetail({
  bom,
  itemName,
  itemUnitCost,
  onBack,
  onDeactivate,
  deactivating,
}: {
  bom: BomRecord;
  itemName: (id: string) => string;
  itemUnitCost: (id: string) => number;
  onBack: () => void;
  onDeactivate: () => void;
  deactivating: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <DocumentDetail
      title={t("boms.detailTitle", { number: bom.number })}
      statusLabel={t(STATUS_KEY[bom.status])}
      statusTone={STATUS_TONE[bom.status]}
      subtitle={t("boms.subtitle", { product: itemName(bom.productItemId), version: bom.version })}
      actions={
        <>
          {bom.status === "active" ? (
            <Button onClick={onDeactivate} disabled={deactivating}>
              {t("boms.deactivate")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("boms.backToBillsOfMaterials")}</Button>
        </>
      }
      summary={[
        { label: t("boms.finishedProduct"), value: itemName(bom.productItemId) },
        { label: t("boms.version"), value: <span className="mz-num">{bom.version}</span> },
        { label: t("boms.standardQuantity"), value: <span className="mz-num">{bom.standardQty}</span> },
        { label: t("boms.lines"), value: <span className="mz-num">{bom.lines.length}</span> },
        { label: t("boms.materialCost"), value: <MoneyValue value={bom.estimate ? num(bom.estimate.materialCost) : 0} /> },
        { label: t("boms.totalCost"), value: <MoneyValue value={bom.estimate ? num(bom.estimate.totalCost) : 0} /> },
        { label: t("boms.unitCost"), value: <MoneyValue value={bom.estimate ? num(bom.estimate.unitCost) : 0} /> },
      ]}
      effects={[
        t("boms.aBillOfMaterialsIs"),
        t("boms.theRequiredQuantityIsScaled"),
        t("boms.creatingANewVersionDeactivates"),
      ]}
      tabs={[
        {
          key: "lines",
          label: t("boms.tab.lines", { count: bom.lines.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.qty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("boms.scrapRate")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("boms.quantityAfterScrap")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("boms.unitCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.wastePercent}%</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{effectiveQty(l.qty, l.wastePercent).toFixed(2)}</td>
                      <td className="px-[12px] py-[10px] text-end">
                        <MoneyValue value={itemUnitCost(l.itemId)} showUnit={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
      ]}
    />
  );
}

export function BomsScreen() {
  const { t } = useAppTranslation();
  const query = useBoms();
  const itemsQuery = useItems();
  const createBom = useCreateBom();
  const deactivateBom = useDeactivateBom();

  const boms = query.data ?? [];
  const items = itemsQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const itemUnitCost = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.costPrice ? Number(i.costPrice) : 0]));
    return (id: string) => map.get(id) ?? 0;
  }, [items]);
  const unitLabel = useUnitLabel();
  const itemOptions: EntityPickerOption[] = items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: unitLabel(i.baseUnitCode) }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BomStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [product, setProduct] = useState<EntityPickerOption | null>(null);
  const [standardQty, setStandardQty] = useState(1);
  const [unit, setUnit] = useState("PCS");
  const [laborCost, setLaborCost] = useState(0);
  const [overheadCost, setOverheadCost] = useState(0);
  const [versionNotes, setVersionNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, wastePercent: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = boms.find((b) => b.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = boms;
    if (statusFilter !== "all") rows = rows.filter((b) => b.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((b) => b.number.toLowerCase().includes(q) || itemName(b.productItemId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [boms, statusFilter, search, itemName]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: boms.length },
    { key: "active", label: t("common.active"), count: boms.filter((b) => b.status === "active").length },
    { key: "inactive", label: t("common.inactive"), count: boms.filter((b) => b.status === "inactive").length },
  ];

  const columns: DocumentListColumn<BomRecord>[] = [
    { key: "number", header: t("boms.bomNumber"), render: (b) => <span className="mz-num font-semibold text-ink">{b.number}</span> },
    { key: "product", header: t("boms.finishedProduct"), render: (b) => itemName(b.productItemId) },
    { key: "version", header: t("boms.version"), render: (b) => <span className="mz-num">v{b.version}</span> },
    { key: "lines", header: t("boms.lines"), align: "end", render: (b) => <span className="mz-num">{b.lines.length}</span> },
    {
      key: "cost",
      header: t("boms.estimatedCost"),
      align: "end",
      render: (b) => <MoneyValue value={b.estimate ? num(b.estimate.totalCost) : 0} />,
    },
    { key: "status", header: t("common.status"), render: (b) => <StatusPill label={t(STATUS_KEY[b.status])} tone={STATUS_TONE[b.status]} /> },
  ];

  function openCreate() {
    setProduct(null);
    setStandardQty(1);
    setUnit("PCS");
    setLaborCost(0);
    setOverheadCost(0);
    setVersionNotes("");
    setLines([{ itemId: "", qty: 1, wastePercent: 0 }]);
    setFormError(null);
    setPanelOpen(true);
  }

  const canSave = product !== null && lines.some((l) => l.itemId !== "" && l.qty > 0);

  async function save() {
    if (!product) return;
    setFormError(null);
    try {
      await createBom.mutateAsync({
        id: crypto.randomUUID(),
        productItemId: product.id,
        standardQty: String(standardQty),
        unit,
        laborCost: String(laborCost || 0),
        overheadCost: String(overheadCost || 0),
        versionNotes: versionNotes.trim() === "" ? null : versionNotes.trim(),
        lines: lines
          .filter((l) => l.itemId !== "" && l.qty > 0)
          .map((l) => ({ itemId: l.itemId, qty: String(l.qty), wastePercent: l.wastePercent })),
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("boms.theBillOfMaterialsCould"));
    }
  }

  async function deactivate(id: string) {
    try {
      await deactivateBom.mutateAsync(id);
    } catch {
      // The list/detail re-render from the failed mutation's settled cache; nothing further to do here.
    }
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("boms.newBillOfMaterials")} description={t("boms.chooseTheFinishedProductAnd")}>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <EntityPicker
          label={t("boms.finishedProduct2")}
          value={product}
          onChange={(opt) => {
            setProduct(opt);
            const item = items.find((i) => i.id === opt?.id);
            if (item) setUnit(item.baseUnitCode);
          }}
          options={itemOptions}
          placeholder={t("boms.chooseTheFinishedProduct")}
        />
        <div className="grid grid-cols-2 gap-[10px]">
          <NumberField label={t("boms.standardQuantity")} value={standardQty} min={0} onChange={setStandardQty} />
          <TextField label={t("common.unit")} value={unit} onChange={setUnit} />
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <NumberField label={t("boms.labourCost")} value={laborCost} min={0} onChange={setLaborCost} />
          <NumberField label={t("boms.overheadCost")} value={overheadCost} min={0} onChange={setOverheadCost} />
        </div>
        <TextField label={t("boms.versionNotes")} value={versionNotes} onChange={setVersionNotes} />
        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("boms.rawMaterialLines")}</span>
          {lines.map((line, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <EntityPicker
                label={t("common.item")}
                value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                onChange={(opt) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "" } : l)))}
                options={itemOptions}
                placeholder={t("boms.chooseAnItem")}
              />
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <NumberField label={t("common.qty")} value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
                <NumberField
                  label={t("boms.scrapRate2")}
                  value={line.wastePercent}
                  min={0}
                  onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, wastePercent: v } : l)))}
                />
              </div>
              {lines.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>{t("boms.removeLine")}</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1, wastePercent: 0 }])}>{t("boms.addItem")}</Button>
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createBom.isPending}>
            {t("boms.saveBillOfMaterials")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <BomDetail
          bom={selected}
          itemName={itemName}
          itemUnitCost={itemUnitCost}
          onBack={() => setSelectedId(null)}
          onDeactivate={() => deactivate(selected.id)}
          deactivating={deactivateBom.isPending}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("boms.billsOfMaterialsCouldNot")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<BomRecord>
        eyebrow="Manufacturing · BOMs"
        title={t("boms.billsOfMaterials")}
        description={t("boms.theManufacturingRecipeRawMaterials")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("boms.newBillOfMaterials")}
          </Button>
        }
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{boms.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{boms.filter((b) => b.status === "active").length}</span> },
          { label: t("common.inactive"), value: <span className="mz-num">{boms.filter((b) => b.status === "inactive").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as BomStatus | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("boms.searchByNumberOrProduct")}
        columns={columns}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={(b) => setSelectedId(b.id)}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{boms.length}</span> {t("boms.bills")}</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? t("common.loading") : t("boms.noMatchingBillsOfMaterials")}
          </div>
        }
      />
      {panel}
    </>
  );
}
