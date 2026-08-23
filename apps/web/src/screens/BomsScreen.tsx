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
import { TextField, NumberField } from "../settings/form-controls";
import { unitLabel } from "../items-sample-data";

type BomStatus = BomRecord["status"];

const STATUS_LABEL: Record<BomStatus, string> = { active: "نشط", inactive: "غير نشط" };
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
  return (
    <DocumentDetail
      title={`قائمة مواد ${bom.number}`}
      statusLabel={STATUS_LABEL[bom.status]}
      statusTone={STATUS_TONE[bom.status]}
      subtitle={`${itemName(bom.productItemId)} · الإصدار ${bom.version}`}
      actions={
        <>
          {bom.status === "active" ? (
            <Button onClick={onDeactivate} disabled={deactivating}>
              تعطيل
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع لقوائم المواد</Button>
        </>
      }
      summary={[
        { label: "المنتج النهائي", value: itemName(bom.productItemId) },
        { label: "الإصدار", value: <span className="mz-num">{bom.version}</span> },
        { label: "الكمية القياسية", value: <span className="mz-num">{bom.standardQty}</span> },
        { label: "عدد البنود", value: <span className="mz-num">{bom.lines.length}</span> },
        { label: "تكلفة المواد", value: <MoneyValue value={bom.estimate ? num(bom.estimate.materialCost) : 0} /> },
        { label: "إجمالي التكلفة", value: <MoneyValue value={bom.estimate ? num(bom.estimate.totalCost) : 0} /> },
        { label: "تكلفة الوحدة", value: <MoneyValue value={bom.estimate ? num(bom.estimate.unitCost) : 0} /> },
      ]}
      effects={[
        "قائمة المواد وصفة تصنيع فقط — لا تؤثر على المخزون أو الحسابات حتى يُنشأ أمر تصنيع منها.",
        "الكمية المطلوبة تُضخَّم تلقائياً بنسبة الهالك لتغطية الفاقد المتوقع.",
        "إنشاء إصدار جديد يُلغي تنشيط الإصدار السابق (لا يُعدّله).",
      ]}
      tabs={[
        {
          key: "lines",
          label: `بنود المواد الخام (${bom.lines.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية</th>
                    <th className="px-[12px] py-[9px] text-end">نسبة الهالك</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية بعد الهالك</th>
                    <th className="px-[12px] py-[9px] text-end">تكلفة الوحدة</th>
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
    { key: "all", label: "الكل", count: boms.length },
    { key: "active", label: "نشط", count: boms.filter((b) => b.status === "active").length },
    { key: "inactive", label: "غير نشط", count: boms.filter((b) => b.status === "inactive").length },
  ];

  const columns: DocumentListColumn<BomRecord>[] = [
    { key: "number", header: "رقم القائمة", render: (b) => <span className="mz-num font-semibold text-ink">{b.number}</span> },
    { key: "product", header: "المنتج النهائي", render: (b) => itemName(b.productItemId) },
    { key: "version", header: "الإصدار", render: (b) => <span className="mz-num">v{b.version}</span> },
    { key: "lines", header: "عدد البنود", align: "end", render: (b) => <span className="mz-num">{b.lines.length}</span> },
    {
      key: "cost",
      header: "التكلفة التقديرية",
      align: "end",
      render: (b) => <MoneyValue value={b.estimate ? num(b.estimate.totalCost) : 0} />,
    },
    { key: "status", header: "الحالة", render: (b) => <StatusPill label={STATUS_LABEL[b.status]} tone={STATUS_TONE[b.status]} /> },
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
      setFormError(err instanceof Error ? err.message : "تعذّر حفظ قائمة المواد.");
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
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="قائمة مواد جديدة" description="اختر المنتج النهائي والخامات المكوّنة له">
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <EntityPicker
          label="المنتج النهائي *"
          value={product}
          onChange={(opt) => {
            setProduct(opt);
            const item = items.find((i) => i.id === opt?.id);
            if (item) setUnit(item.baseUnitCode);
          }}
          options={itemOptions}
          placeholder="اختر المنتج النهائي…"
        />
        <div className="grid grid-cols-2 gap-[10px]">
          <NumberField label="الكمية القياسية" value={standardQty} min={0} onChange={setStandardQty} />
          <TextField label="الوحدة" value={unit} onChange={setUnit} />
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <NumberField label="تكلفة العمالة" value={laborCost} min={0} onChange={setLaborCost} />
          <NumberField label="تكلفة المصاريف الإضافية" value={overheadCost} min={0} onChange={setOverheadCost} />
        </div>
        <TextField label="ملاحظات الإصدار" value={versionNotes} onChange={setVersionNotes} />
        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">بنود المواد الخام</span>
          {lines.map((line, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <EntityPicker
                label="الصنف"
                value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                onChange={(opt) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "" } : l)))}
                options={itemOptions}
                placeholder="اختر صنفاً…"
              />
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <NumberField label="الكمية" value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
                <NumberField
                  label="نسبة الهالك %"
                  value={line.wastePercent}
                  min={0}
                  onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, wastePercent: v } : l)))}
                />
              </div>
              {lines.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>حذف البند</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1, wastePercent: 0 }])}>إضافة صنف</Button>
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createBom.isPending}>
            حفظ قائمة المواد
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل قوائم المواد.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<BomRecord>
        eyebrow="Manufacturing · BOMs"
        title="قوائم المواد"
        description="وصفة التصنيع (المواد الخام + الهالك + التكلفة القياسية) لكل منتج نهائي — القالب الذي يُبنى منه أمر التصنيع"
        actions={
          <Button variant="primary" onClick={openCreate}>
            قائمة مواد جديدة
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{boms.length}</span> },
          { label: "نشط", value: <span className="mz-num">{boms.filter((b) => b.status === "active").length}</span> },
          { label: "غير نشط", value: <span className="mz-num">{boms.filter((b) => b.status === "inactive").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as BomStatus | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالرقم أو اسم المنتج…"
        columns={columns}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={(b) => setSelectedId(b.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{boms.length}</span> قائمة</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد قوائم مواد مطابقة — أنشئ قائمة جديدة"}
          </div>
        }
      />
      {panel}
    </>
  );
}
