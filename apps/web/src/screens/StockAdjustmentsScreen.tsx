import { useEffect, useMemo, useState } from "react";
import {
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  Money as MoneyDisplay,
  StatusPill,
  Card,
  Button,
  IconButton,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
} from "@mezan/ui";
import {
  Money,
  ADJUSTMENT_REASON_DEFINITIONS,
  getAdjustmentReasonDefinition,
  stockAdjustmentDocumentType,
  type DocumentStatus,
  type FrameworkDocument,
  type StockAdjustmentDocLine,
  type AdjustmentReason,
  type AdjustmentReasonDefinition,
  type StockMovementDirection,
  type JournalEntry,
} from "@mezan/domain";
import { useInventoryOpsStore } from "../store/useInventoryOpsStore";
import { sharedInventoryOpsStore } from "../store/shared-inventory-ops-store";
import { demoWarehouses } from "../sample-data";
import { demoAccounts } from "../accounts-sample-data";
import { demoItems } from "../items-sample-data";
import { TextField, SelectField } from "../settings/form-controls";

/** The GL tab needs the FULL chart (1200/3100/5900 for this module's postings), not `items-sample-data.ts`'s item-mapping subset. */
function accountLabel(id: string): string {
  const account = demoAccounts.find((a) => a.id === id);
  return account ? account.nameAr : id;
}

/** تسويات المخزون (Stock Adjustments) — docs/catalog/03. List + detail + create, on the document framework. */

type AdjustmentDoc = FrameworkDocument<StockAdjustmentDocLine>;

const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  posted: "مرحل",
  confirmed: "مؤكد",
  reversed: "معكوس",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<DocumentStatus, PillTone> = {
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

function warehouseLabel(id: string): string {
  return demoWarehouses.find((w) => w.id === id)?.name ?? id;
}

function itemLabel(id: string): string {
  const item = demoItems.find((i) => i.id === id);
  return item ? `${item.nameAr} (${item.code})` : id;
}

function headerOf(doc: AdjustmentDoc): { warehouseId: string; reason: AdjustmentReason } {
  const first = doc.lines[0];
  return first ? { warehouseId: first.warehouseId, reason: first.reason } : { warehouseId: "—", reason: "OTHER" };
}

/* -------------------------------------------------------------------- */
/* Create form line state                                               */
/* -------------------------------------------------------------------- */

interface LineDraft {
  key: string;
  itemId: string;
  direction: StockMovementDirection;
  qty: number;
  unitCost: number;
}

let lineSeq = 0;
function blankLine(direction: StockMovementDirection): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", direction, qty: 0, unitCost: 0 };
}

export function StockAdjustmentsScreen() {
  const store = useInventoryOpsStore(sharedInventoryOpsStore);

  const [mode, setMode] = useState<"list" | "reason" | "create" | "detail">("list");
  const [selectedReason, setSelectedReason] = useState<AdjustmentReasonDefinition | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>("all");

  const documents = store.stockAdjustments;

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

  const columns: DocumentListColumn<AdjustmentDoc>[] = [
    {
      key: "docNo",
      header: "رقم التسوية",
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</span>,
    },
    { key: "date", header: "التاريخ", sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    {
      key: "warehouse",
      header: "المستودع / السبب",
      render: (d) => {
        const { warehouseId, reason } = headerOf(d);
        return (
          <span className="text-ink">
            {warehouseLabel(warehouseId)} — {getAdjustmentReasonDefinition(reason).labelAr}
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

  if (mode === "reason") {
    return (
      <div className="w-full">
        <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
          <div>
            <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Inventory · New Stock Adjustment</div>
            <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">اختر سبب التسوية</h1>
            <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">السبب يحدد طريقة إدخال البيانات</p>
          </div>
          <Button onClick={() => setMode("list")}>إلغاء</Button>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {ADJUSTMENT_REASON_DEFINITIONS.map((def) => (
            <button
              key={def.code}
              type="button"
              onClick={() => {
                setSelectedReason(def);
                setMode("create");
              }}
              className="flex flex-col gap-[6px] rounded-lg border border-border bg-surface p-[16px] text-start transition-colors hover:border-brand hover:bg-brand-soft"
            >
              <span className="font-display text-[14px] font-bold text-ink">{def.labelAr}</span>
              <span className="text-[12px] text-ink-muted">{def.descriptionAr}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "create" && selectedReason) {
    return (
      <CreateAdjustmentView
        store={store}
        reason={selectedReason}
        onDone={() => {
          setSelectedReason(null);
          setMode("list");
        }}
        onBack={() => setMode("reason")}
      />
    );
  }

  if (mode === "detail" && selected) {
    const { warehouseId, reason } = headerOf(selected);
    const def = getAdjustmentReasonDefinition(reason);
    const effects = stockAdjustmentDocumentType.describeEffects(selected);
    return (
      <div className="w-full">
        <DocumentDetail
          title={selected.docNo ?? "تسوية مخزون"}
          statusLabel={STATUS_LABEL[selected.status]}
          statusTone={STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_STEPS} currentKey={selected.status} />}
          actions={<Button onClick={() => setMode("list")}>رجوع</Button>}
          summary={[
            { label: "المستودع", value: warehouseLabel(warehouseId) },
            { label: "السبب", value: def.labelAr },
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
              label: "بنود التسوية",
              content: <AdjustmentLinesTable doc={selected} />,
            },
            {
              key: "gl",
              label: "المحاسبة",
              content: <AdjustmentGlTab store={store} docId={selected.id} />,
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <DocumentList<AdjustmentDoc>
        eyebrow="Inventory · Stock Adjustments"
        title="تسويات المخزون"
        description="مسودة ← مؤكد — تسويات تُغيّر كمية المخزون وربما قيمته، على إطار المستندات الموحّد"
        actions={
          <Button variant="primary" onClick={() => setMode("reason")}>
            تسوية جديدة
          </Button>
        }
        stats={[
          { label: "إجمالي التسويات", value: <span className="mz-num">{counts.all}</span> },
          { label: "مسودة", value: <span className="mz-num">{counts.draft}</span> },
          { label: "مؤكد", value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: counts.all },
          { key: "draft", label: "مسودة", count: counts.draft },
          { key: "confirmed", label: "مؤكد", count: counts.confirmed },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatus)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم التسوية..."
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> تسوية
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد تسويات مطابقة</div>}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Lines tab                                                            */
/* -------------------------------------------------------------------- */

function AdjustmentLinesTable({ doc }: { doc: AdjustmentDoc }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الاتجاه</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الكمية</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">سعر التكلفة</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">القيمة</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => {
              const value = l.unitCost ? Money.fromMajor(String(Number(l.qty.toString()) * Number(l.unitCost.toString()))) : null;
              return (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <td className="px-[15px] py-[11px] text-ink">{itemLabel(l.itemId)}</td>
                  <td className="px-[15px] py-[11px]">
                    <StatusPill label={l.direction === "IN" ? "زيادة" : "نقصان"} tone={l.direction === "IN" ? "success" : "danger"} />
                  </td>
                  <td className="px-[15px] py-[11px] text-end mz-num">{l.qty.toString()}</td>
                  <td className="px-[15px] py-[11px] text-end">{l.unitCost ? <MoneyDisplay value={Number(l.unitCost.toString())} /> : "—"}</td>
                  <td className="px-[15px] py-[11px] text-end">{value ? <MoneyDisplay value={Number(value.toString())} /> : "يُحسب بمتوسط التكلفة الحالي"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* GL tab — looks the journal entry up by the adjustment's OWN id        */
/* -------------------------------------------------------------------- */

function AdjustmentGlTab({ store, docId }: { store: ReturnType<typeof useInventoryOpsStore>; docId: string }) {
  const [entry, setEntry] = useState<JournalEntry | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void store.findJournalEntry(docId).then((e) => {
      if (!cancelled) setEntry(e);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, store]);

  if (entry === undefined) return <div className="p-4 text-[12.5px] text-ink-muted">جارٍ التحميل...</div>;
  if (entry === null) {
    return <div className="p-4 text-[12.5px] text-ink-muted">لا يوجد قيد محاسبي لهذه التسوية (لا يوجد فرق قيمة).</div>;
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الحساب</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">مدين</th>
              <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">دائن</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId)}</td>
                <td className="px-[15px] py-[11px] text-end">{l.debit.scaled !== 0n ? <MoneyDisplay value={Number(l.debit.toString())} /> : "—"}</td>
                <td className="px-[15px] py-[11px] text-end">{l.credit.scaled !== 0n ? <MoneyDisplay value={Number(l.credit.toString())} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

function CreateAdjustmentView({
  store,
  reason,
  onDone,
  onBack,
}: {
  store: ReturnType<typeof useInventoryOpsStore>;
  reason: AdjustmentReasonDefinition;
  onDone: () => void;
  onBack: () => void;
}) {
  const [date, setDate] = useState("2026-08-22");
  const [memo, setMemo] = useState("");
  const [warehouseId, setWarehouseId] = useState(demoWarehouses[0]?.id ?? "");
  const defaultDirection: StockMovementDirection = reason.direction === "OUT" ? "OUT" : "IN";
  const [lines, setLines] = useState<LineDraft[]>([blankLine(defaultDirection)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const itemOptions = useMemo(
    () => [{ value: "", label: "اختر صنف..." }, ...demoItems.filter((i) => i.type !== "service").map((i) => ({ value: i.id, label: i.nameAr }))],
    [],
  );
  const warehouseOptions = useMemo(() => demoWarehouses.map((w) => ({ value: w.id, label: w.name })), []);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine(defaultDirection)]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const allLinesValid = lines.every(
    (l) => l.itemId !== "" && l.qty > 0 && (l.direction === "OUT" || l.unitCost > 0),
  );
  const canPost = allLinesValid && warehouseId !== "" && !busy;

  async function handlePost() {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    const result = await store.postAdjustment({
      date,
      memo: memo.trim() || `${reason.labelAr} — ${warehouseLabel(warehouseId)}`,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        warehouseId,
        reason: reason.code,
        direction: l.direction,
        qty: l.qty,
        unitCost: l.direction === "IN" ? l.unitCost : undefined,
      })),
    });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error ?? "تعذر اعتماد التسوية.");
  }

  return (
    <div className="w-full">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Inventory · New Stock Adjustment</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{reason.code === "INITIAL_STOCK" ? "الرصيد الافتتاحي" : `تسوية — ${reason.labelAr}`}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onBack}>رجوع</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            اعتماد التسوية
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
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-3">
            <TextField label="تاريخ التسوية *" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <SelectField label="المستودع *" value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} />
            <TextField label="ملاحظات" value={memo} onChange={setMemo} placeholder="وصف التسوية..." />
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                    {reason.direction === "EITHER" ? (
                      <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الاتجاه</th>
                    ) : null}
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الكمية</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">سعر التكلفة</th>
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
                      {reason.direction === "EITHER" ? (
                        <td className="px-[12px] py-[8px]">
                          <select
                            aria-label={`الاتجاه للسطر ${i + 1}`}
                            value={line.direction}
                            onChange={(e) => updateLine(i, { direction: e.target.value as StockMovementDirection })}
                            className="w-full min-w-[100px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                          >
                            <option value="IN">زيادة</option>
                            <option value="OUT">نقصان</option>
                          </select>
                        </td>
                      ) : null}
                      <td className="px-[12px] py-[8px]">
                        <input
                          type="number"
                          aria-label={`الكمية للسطر ${i + 1}`}
                          value={line.qty || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { qty: e.target.valueAsNumber || 0 })}
                          className="mz-num w-[100px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand"
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <input
                          type="number"
                          aria-label={`سعر التكلفة للسطر ${i + 1}`}
                          value={line.unitCost || ""}
                          min={0}
                          disabled={line.direction === "OUT"}
                          onChange={(e) => updateLine(i, { unitCost: e.target.valueAsNumber || 0 })}
                          className="mz-num w-[110px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-surface-3"
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

        <div className="flex flex-col gap-[16px]">
          <div
            className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
            style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
          >
            <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">تأثيرات هذه التسوية</h3>
            <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {lines.some((l) => l.direction === "IN") ? "ارتفعت قيمة المخزون" : "انخفضت قيمة المخزون"} حسب بنود التسوية
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                لا تأثير على المورد أو العميل
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                ينشئ قيداً محاسبياً موازناً عند وجود فرق قيمة
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
