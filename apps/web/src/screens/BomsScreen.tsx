import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import {
  bomCostEstimate,
  bomLineEffectiveQty,
  type Bom,
  type ActivationStatus,
} from "@mezan/domain";
import { demoBoms, mfgItemName, mfgItemUnit, resolveDemoUnitCost } from "../manufacturing-sample-data";

const STATUS_LABEL: Record<ActivationStatus, string> = { active: "نشط", inactive: "غير نشط" };
const STATUS_TONE: Record<ActivationStatus, PillTone> = { active: "success", inactive: "neutral" };
const num = (m: { toString(): string }) => Number(m.toString());

function BomDetail({ bom, onBack }: { bom: Bom; onBack: () => void }) {
  const est = bomCostEstimate(bom, resolveDemoUnitCost);
  return (
    <DocumentDetail
      title={`قائمة مواد ${bom.number}`}
      statusLabel={STATUS_LABEL[bom.status]}
      statusTone={STATUS_TONE[bom.status]}
      subtitle={`${mfgItemName(bom.productItemId)} · الإصدار ${bom.version}`}
      actions={<Button onClick={onBack}>رجوع لقوائم المواد</Button>}
      summary={[
        { label: "المنتج النهائي", value: mfgItemName(bom.productItemId) },
        { label: "الإصدار", value: <span className="mz-num">{bom.version}</span> },
        { label: "الكمية القياسية", value: <span className="mz-num">{bom.standardQty.toString()}</span> },
        { label: "عدد البنود", value: <span className="mz-num">{bom.lines.length}</span> },
        { label: "تكلفة المواد", value: <MoneyValue value={num(est.materialCost)} /> },
        { label: "إجمالي التكلفة", value: <MoneyValue value={num(est.totalCost)} /> },
        { label: "تكلفة الوحدة", value: <MoneyValue value={num(est.unitCost)} /> },
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
                      <td className="px-[12px] py-[10px]">
                        {mfgItemName(l.itemId)}
                        <span className="text-ink-muted"> · {mfgItemUnit(l.itemId)}</span>
                      </td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty.toString()}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.wastePercent}%</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{bomLineEffectiveQty(l).toString()}</td>
                      <td className="px-[12px] py-[10px] text-end">
                        <MoneyValue value={num(resolveDemoUnitCost(l.itemId))} showUnit={false} />
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
  const [boms] = useState<Bom[]>(demoBoms);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActivationStatus | "all">("all");
  const [search, setSearch] = useState("");

  const selected = boms.find((b) => b.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = boms;
    if (statusFilter !== "all") rows = rows.filter((b) => b.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((b) => b.number.toLowerCase().includes(q) || mfgItemName(b.productItemId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [boms, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: boms.length },
    { key: "active", label: "نشط", count: boms.filter((b) => b.status === "active").length },
    { key: "inactive", label: "غير نشط", count: boms.filter((b) => b.status === "inactive").length },
  ];

  const columns: DocumentListColumn<Bom>[] = [
    { key: "number", header: "رقم القائمة", render: (b) => <span className="mz-num font-semibold text-ink">{b.number}</span> },
    { key: "product", header: "المنتج النهائي", render: (b) => mfgItemName(b.productItemId) },
    { key: "version", header: "الإصدار", render: (b) => <span className="mz-num">v{b.version}</span> },
    { key: "lines", header: "عدد البنود", align: "end", render: (b) => <span className="mz-num">{b.lines.length}</span> },
    {
      key: "cost",
      header: "التكلفة التقديرية",
      align: "end",
      render: (b) => <MoneyValue value={num(bomCostEstimate(b, resolveDemoUnitCost).totalCost)} />,
    },
    { key: "status", header: "الحالة", render: (b) => <StatusPill label={STATUS_LABEL[b.status]} tone={STATUS_TONE[b.status]} /> },
  ];

  if (selected) {
    return <BomDetail bom={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <DocumentList<Bom>
      eyebrow="Manufacturing · BOMs"
      title="قوائم المواد"
      description="وصفة التصنيع (المواد الخام + الهالك + التكلفة القياسية) لكل منتج نهائي — القالب الذي يُبنى منه أمر التصنيع"
      actions={<Button variant="primary">قائمة مواد جديدة</Button>}
      stats={[
        { label: "الإجمالي", value: <span className="mz-num">{boms.length}</span> },
        { label: "نشط", value: <span className="mz-num">{boms.filter((b) => b.status === "active").length}</span> },
        { label: "غير نشط", value: <span className="mz-num">{boms.filter((b) => b.status === "inactive").length}</span> },
      ]}
      statusChips={statusChips}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as ActivationStatus | "all")}
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
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد قوائم مواد مطابقة</div>}
    />
  );
}
