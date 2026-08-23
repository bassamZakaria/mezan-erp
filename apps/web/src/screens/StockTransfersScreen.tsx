import { useMemo, useState } from "react";
import {
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  StatusPill,
  Card,
  Button,
  IconButton,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
} from "@mezan/ui";
import type { DocumentStatusDTO, StockTransferDocumentDTO } from "@mezan/contracts";
import { Qty, stockTransferDocumentType } from "@mezan/domain";
import { useConfirmStockTransfer, useCreateStockTransfer, useItems, useStockTransfers, useWarehouses } from "../data/hooks";
import { TextField, SelectField } from "../settings/form-controls";

/** تحويلات المخزون (Stock Transfers) — docs/catalog/03. Valuation-neutral, one-way confirm. On the real document-framework API. */

const STATUS_LABEL: Record<DocumentStatusDTO, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  posted: "مرحل",
  confirmed: "مؤكد",
  reversed: "معكوس",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<DocumentStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  posted: "success",
  confirmed: "success",
  reversed: "danger",
  cancelled: "neutral",
};

const STEPPER_STEPS: DocumentStatusStep[] = [
  { key: "draft", label: "مسودة" },
  { key: "confirmed", label: "مؤكد" },
];

function headerOf(doc: StockTransferDocumentDTO): { fromWarehouseId: string; toWarehouseId: string } {
  const first = doc.lines[0];
  return first ? { fromWarehouseId: first.fromWarehouseId, toWarehouseId: first.toWarehouseId } : { fromWarehouseId: "—", toWarehouseId: "—" };
}

/** Rebuilds the domain document (Qty instances) from the wire DTO so the REAL `describeEffects` can run client-side. */
function toDomainDoc(doc: StockTransferDocumentDTO) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      fromWarehouseId: l.fromWarehouseId,
      toWarehouseId: l.toWarehouseId,
      qty: Qty.fromMajor(l.qty),
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

interface LineDraft {
  key: string;
  itemId: string;
  qty: number;
}
let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", qty: 0 };
}

export function StockTransfersScreen() {
  const query = useStockTransfers();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const documents = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function warehouseLabel(id: string): string {
    return warehouses.find((w) => w.id === id)?.name ?? id;
  }
  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  const [mode, setMode] = useState<"list" | "create" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      else if (d.status === "confirmed") c.confirmed += 1;
    }
    return c;
  }, [documents]);

  const filtered = useMemo(() => {
    let rows = documents;
    if (statusFilter !== "all") rows = rows.filter((d) => d.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((d) => (d.docNo ?? "").toLowerCase().includes(q) || d.memo.toLowerCase().includes(q));
    }
    return rows;
  }, [documents, statusFilter, search]);

  const selected = selectedId ? documents.find((d) => d.id === selectedId) ?? null : null;

  const columns: DocumentListColumn<StockTransferDocumentDTO>[] = [
    {
      key: "docNo",
      header: "رقم التحويل",
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</span>,
    },
    { key: "date", header: "التاريخ", sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    {
      key: "route",
      header: "المسار",
      render: (d) => {
        const { fromWarehouseId, toWarehouseId } = headerOf(d);
        return (
          <span className="text-ink">
            {warehouseLabel(fromWarehouseId)} ← {warehouseLabel(toWarehouseId)}
          </span>
        );
      },
    },
    { key: "lines", header: "عدد البنود", align: "end", render: (d) => <span className="mz-num">{d.lines.length}</span> },
    { key: "status", header: "الحالة", render: (d) => <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} /> },
  ];

  function openDetail(id: string) {
    setSelectedId(id);
    setMode("detail");
  }

  if (mode === "create") {
    return <CreateTransferView warehouses={warehouses} items={items} onDone={() => setMode("list")} />;
  }

  if (mode === "detail" && selected) {
    const { fromWarehouseId, toWarehouseId } = headerOf(selected);
    const effects = stockTransferDocumentType.describeEffects(toDomainDoc(selected));
    return (
      <div className="w-full">
        <DocumentDetail
          title={selected.docNo ?? "تحويل مخزون"}
          statusLabel={STATUS_LABEL[selected.status]}
          statusTone={STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_STEPS} currentKey={selected.status} />}
          actions={<Button onClick={() => setMode("list")}>رجوع</Button>}
          summary={[
            { label: "المستودع المصدر", value: warehouseLabel(fromWarehouseId) },
            { label: "المستودع الوجهة", value: warehouseLabel(toWarehouseId) },
            { label: "التاريخ", value: <span className="mz-num">{selected.date}</span> },
            { label: "عدد البنود", value: <span className="mz-num">{selected.lines.length}</span> },
          ]}
          effects={effects.effects.map((e) => (
            <span key={e.description}>
              {e.description}
              {e.detail ? <span className="block text-[11.5px] text-ink-muted">{e.detail}</span> : null}
            </span>
          ))}
          tabs={[
            {
              key: "lines",
              label: "البنود",
              content: (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[400px] border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الكمية</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                            <td className="px-[15px] py-[11px] text-end mz-num">{l.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ),
            },
          ]}
        />
        {selected.status === "confirmed" ? (
          <div className="mt-[16px] rounded-md border border-border bg-surface-2 px-[14px] py-[11px] text-[12px] text-ink-muted">
            لا يمكن إلغاء تحويل مؤكد — بعد تأكيد التحويل لا يمكن إلغاؤه. لعكس الحركة، أنشئ تحويلاً جديداً بالاتجاه المعاكس.
          </div>
        ) : null}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل تحويلات المخزون.</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      <DocumentList<StockTransferDocumentDTO>
        eyebrow="Inventory · Stock Transfers"
        title="تحويلات المخزون"
        description="مسودة ← مؤكد — نقل كمية بين مستودعين دون أي أثر على قيمة المخزون الإجمالية"
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            تحويل جديد
          </Button>
        }
        stats={[
          { label: "إجمالي التحويلات", value: <span className="mz-num">{counts.all}</span> },
          { label: "مسودة", value: <span className="mz-num">{counts.draft}</span> },
          { label: "مؤكد", value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: counts.all },
          { key: "draft", label: "مسودة", count: counts.draft },
          { key: "confirmed", label: "مؤكد", count: counts.confirmed },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم التحويل..."
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> تحويل
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد تحويلات مطابقة</div>}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

function CreateTransferView({
  warehouses,
  items,
  onDone,
}: {
  warehouses: ReturnType<typeof useWarehouses>["data"];
  items: ReturnType<typeof useItems>["data"];
  onDone: () => void;
}) {
  const createTransfer = useCreateStockTransfer();
  const confirmTransfer = useConfirmStockTransfer();
  const warehouseList = warehouses ?? [];
  const itemList = items ?? [];

  const [date, setDate] = useState("2026-08-22");
  const [memo, setMemo] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouseList[0]?.id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState(warehouseList[1]?.id ?? warehouseList[0]?.id ?? "");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);

  function warehouseLabel(id: string): string {
    return warehouseList.find((w) => w.id === id)?.name ?? id;
  }

  const itemOptions = useMemo(
    () => [{ value: "", label: "اختر صنف..." }, ...itemList.filter((i) => i.type !== "service").map((i) => ({ value: i.id, label: i.nameAr }))],
    [itemList],
  );
  const warehouseOptions = useMemo(() => warehouseList.map((w) => ({ value: w.id, label: w.name })), [warehouseList]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const sameWarehouse = fromWarehouseId !== "" && fromWarehouseId === toWarehouseId;
  const allLinesValid = lines.every((l) => l.itemId !== "" && l.qty > 0);
  const busy = createTransfer.isPending || confirmTransfer.isPending;
  const canPost = allLinesValid && fromWarehouseId !== "" && toWarehouseId !== "" && !sameWarehouse && !busy;

  async function handlePost() {
    if (!canPost) return;
    setError(null);
    try {
      const draft = await createTransfer.mutateAsync({
        id: crypto.randomUUID(),
        date,
        memo: memo.trim() || `تحويل من ${warehouseLabel(fromWarehouseId)} إلى ${warehouseLabel(toWarehouseId)}`,
        lines: lines.map((l) => ({ itemId: l.itemId, fromWarehouseId, toWarehouseId, qty: String(l.qty) })),
      });
      await confirmTransfer.mutateAsync(draft.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ التحويل.");
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Inventory · New Stock Transfer</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">تحويل مخزون جديد</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>إلغاء</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            حفظ
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-2">
            <TextField label="التاريخ *" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <TextField label="ملاحظات" value={memo} onChange={setMemo} placeholder="وصف التحويل..." />
            <SelectField label="المستودع المصدر *" value={fromWarehouseId} onChange={setFromWarehouseId} options={warehouseOptions} />
            <SelectField label="المستودع الوجهة *" value={toWarehouseId} onChange={setToWarehouseId} options={warehouseOptions} />
          </Card>
          {sameWarehouse ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              يجب أن يختلف المستودع المصدر عن مستودع الوجهة.
            </div>
          ) : null}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">كمية التحويل</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[8px]">
                        <select
                          aria-label={`الصنف للسطر ${i + 1}`}
                          value={line.itemId}
                          onChange={(e) => updateLine(i, { itemId: e.target.value })}
                          className="w-full min-w-[160px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                        >
                          {itemOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <input
                          type="number"
                          aria-label={`كمية التحويل للسطر ${i + 1}`}
                          value={line.qty || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { qty: e.target.valueAsNumber || 0 })}
                          className="mz-num w-[110px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand"
                        />
                      </td>
                      <td className="px-[12px] py-[8px] text-center">
                        <IconButton aria-label={`حذف السطر ${i + 1}`} disabled={lines.length <= 1} onClick={() => removeLine(i)}>
                          ✕
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border p-[12px]">
              <Button size="sm" onClick={addLine}>
                إضافة بند
              </Button>
            </div>
          </Card>
        </div>

        <div
          className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
          style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
        >
          <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">تأثيرات هذا التحويل</h3>
          <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
            <li className="flex items-start gap-[8px]">
              <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
              خصم الكميات من المستودع المصدر وإضافتها للمستودع الوجهة
            </li>
            <li className="flex items-start gap-[8px]">
              <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
              لا يتغير إجمالي قيمة المخزون
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
