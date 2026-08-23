import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { Money, Qty, distributeLandedCost, type AllocatedLandedCostLine } from "@mezan/domain";
import type {
  DocumentStatusDTO,
  LandedCostDistributionMethodDTO,
  LandedCostItemEntryDTO,
  LandedCostTargetDTO,
  LandedCostTypeDTO,
} from "@mezan/contracts";
import { SelectField, NumberField, TextField } from "../settings/form-controls";
import {
  useCancelLandedCost,
  useConfirmLandedCost,
  useCreateLandedCost,
  useItems,
  useLandedCosts,
  usePurchaseInvoices,
  useWarehouses,
} from "../data/hooks";

/** التكاليف الإضافية (Landed Costs) — docs/catalog/02. Distributes freight/customs/etc across a confirmed purchase invoice's item costs, by value or by quantity. */

const COST_TYPE_LABEL: Record<LandedCostTypeDTO, string> = {
  SHIPPING: "شحن",
  CUSTOMS: "جمارك",
  INSURANCE: "تأمين",
  CLEARANCE: "تخليص",
  OTHER: "أخرى",
};

const METHOD_LABEL: Record<LandedCostDistributionMethodDTO, string> = { BY_VALUE: "حسب القيمة", BY_QUANTITY: "حسب الكمية" };

const STATUS_LABEL: Record<DocumentStatusDTO, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "مؤكد",
  posted: "مرحل",
  cancelled: "ملغي",
  reversed: "معكوس",
};
const STATUS_TONE: Record<DocumentStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  posted: "success",
  cancelled: "neutral",
  reversed: "danger",
};

const num = (v: string) => Number(v);

interface CostItemDraft {
  key: string;
  costType: LandedCostTypeDTO;
  description: string;
  amount: number;
}
interface TargetDraft {
  key: string;
  itemId: string;
  qty: number;
  unitCost: number;
}
let seq = 0;
function blankCostItem(): CostItemDraft {
  seq += 1;
  return { key: `c${seq}`, costType: "SHIPPING", description: "", amount: 0 };
}
function blankTarget(itemId: string, qty: number, unitCost: number): TargetDraft {
  seq += 1;
  return { key: `t${seq}`, itemId, qty, unitCost };
}

export function LandedCostsScreen() {
  const query = useLandedCosts();
  const invoicesQuery = usePurchaseInvoices();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const createLandedCost = useCreateLandedCost();
  const confirmLandedCost = useConfirmLandedCost();
  const cancelLandedCost = useCancelLandedCost();

  const documents = query.data ?? [];
  const invoices = (invoicesQuery.data ?? []).filter((i) => i.status === "confirmed");
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [method, setMethod] = useState<LandedCostDistributionMethodDTO>("BY_VALUE");
  const [costItems, setCostItems] = useState<CostItemDraft[]>([]);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Defaults the create form's invoice/warehouse pickers once their queries resolve —
  // `openCreate` alone can't do this if the panel is opened before `invoices`/`warehouses` load.
  useEffect(() => {
    if (panel !== "create" || invoiceId !== "") return;
    const firstInvoice = invoices[0];
    if (!firstInvoice) return;
    setInvoiceId(firstInvoice.id);
    const firstLine = firstInvoice.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
  }, [panel, invoices, invoiceId]);

  useEffect(() => {
    if (panel !== "create" || warehouseId !== "") return;
    const firstWarehouse = warehouses[0];
    if (firstWarehouse) setWarehouseId(firstWarehouse.id);
  }, [panel, warehouses, warehouseId]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const invoiceStockLines = useMemo(
    () => (selectedInvoice?.lines ?? []).filter((l) => l.kind === "inventory" && l.itemId !== null),
    [selectedInvoice],
  );

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      if (d.status === "confirmed") c.confirmed += 1;
    }
    return c;
  }, [documents]);

  const filtered = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
  const selected = typeof panel === "object" ? (documents.find((d) => d.id === panel.id) ?? null) : null;

  const totalCost = costItems.reduce((s, c) => s + (c.amount || 0), 0);

  const preview: AllocatedLandedCostLine[] | null = useMemo(() => {
    const usableCosts = costItems.filter((c) => c.amount > 0);
    if (usableCosts.length === 0 || targets.length === 0) return null;
    try {
      return distributeLandedCost(
        usableCosts.map((c) => ({ costType: c.costType, description: c.description, amount: Money.fromMajor(String(c.amount)) })),
        method,
        targets.map((t) => ({
          itemId: t.itemId,
          warehouseId,
          sourceInvoiceId: invoiceId,
          sourceInvoiceNumber: selectedInvoice?.number ?? null,
          qty: Qty.fromMajor(String(t.qty)),
          unitCost: Money.fromMajor(String(t.unitCost)),
        })),
      );
    } catch {
      return null;
    }
  }, [costItems, method, targets, warehouseId, invoiceId, selectedInvoice]);

  function openCreate() {
    setError(null);
    const firstInvoice = invoices[0] ?? null;
    setInvoiceId(firstInvoice?.id ?? "");
    setWarehouseId(warehouses[0]?.id ?? "");
    setMethod("BY_VALUE");
    setCostItems([blankCostItem()]);
    const firstLine = firstInvoice?.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
    setPanel("create");
  }

  function changeInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((i) => i.id === id) ?? null;
    const firstLine = invoice?.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
  }

  function changeTargetItem(key: string, itemId: string) {
    const line = invoiceStockLines.find((l) => l.itemId === itemId);
    setTargets((prev) =>
      prev.map((t) => (t.key === key ? { ...t, itemId, qty: line ? Number(line.qty) : t.qty, unitCost: line ? Number(line.unitCost) : t.unitCost } : t)),
    );
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    if (!invoiceId || !warehouseId) {
      setError("اختر الفاتورة المرتبطة والمستودع.");
      return;
    }
    const usableCosts = costItems.filter((c) => c.amount > 0);
    const usableTargets = targets.filter((t) => t.itemId !== "" && t.qty > 0);
    if (usableCosts.length === 0 || usableTargets.length === 0) {
      setError("أضف بند تكلفة واحداً على الأقل وصنفاً مستهدفاً واحداً على الأقل.");
      return;
    }
    const costItemEntries: LandedCostItemEntryDTO[] = usableCosts.map((c) => ({ costType: c.costType, description: c.description, amount: String(c.amount) }));
    const targetEntries: LandedCostTargetDTO[] = usableTargets.map((t) => ({
      itemId: t.itemId,
      warehouseId,
      sourceInvoiceId: invoiceId,
      sourceInvoiceNumber: selectedInvoice?.number ?? null,
      qty: String(t.qty),
      unitCost: String(t.unitCost),
    }));
    try {
      const id = crypto.randomUUID();
      const created = await createLandedCost.mutateAsync({
        id,
        date: new Date().toISOString().slice(0, 10),
        memo: "",
        distributionMethod: method,
        costItems: costItemEntries,
        targets: targetEntries,
      });
      if (confirmAfter) await confirmLandedCost.mutateAsync(created.id);
      setPanel("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmExisting(id: string) {
    setError(null);
    try {
      await confirmLandedCost.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelExisting(id: string) {
    setError(null);
    try {
      await cancelLandedCost.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "draft", label: "مسودة", count: counts.draft },
    { key: "confirmed", label: "مؤكد", count: counts.confirmed },
  ];

  const columns: DocumentListColumn<(typeof documents)[number]>[] = [
    { key: "docNo", header: "رقم المستند", render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "مسودة"}</span> },
    { key: "method", header: "طريقة التوزيع", render: (d) => METHOD_LABEL[d.lines[0]?.distributionMethod ?? "BY_VALUE"] },
    { key: "total", header: "إجمالي التكلفة", align: "end", render: (d) => <MoneyDisplay value={d.lines.reduce((s, l) => s + num(l.allocatedAmount), 0)} /> },
    { key: "status", header: "الحالة", render: (d) => <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل مستندات التكاليف الإضافية.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<(typeof documents)[number]>
        eyebrow="Purchases · Landed Costs"
        title="التكاليف الإضافية"
        description="توزيع تكاليف الشحن/الجمارك/التأمين على بنود فاتورة مشتريات مؤكدة، حسب القيمة أو الكمية."
        actions={
          <Button variant="primary" onClick={openCreate}>
            مستند تكلفة جديد
          </Button>
        }
        stats={[
          { label: "إجمالي المستندات", value: <span className="mz-num">{counts.all}</span> },
          { label: "مؤكدة", value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> مستند
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات</div>}
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title="مستند تكلفة إضافية جديد">
        <div className="flex flex-col gap-4 p-5">
          <SelectField label="المستودع *" value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label="الفاتورة المرتبطة *"
            value={invoiceId}
            onChange={changeInvoice}
            options={invoices.map((i) => ({ value: i.id, label: i.number }))}
          />
          <SelectField
            label="طريقة التوزيع *"
            value={method}
            onChange={(v) => setMethod(v as LandedCostDistributionMethodDTO)}
            options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))}
          />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">بنود التكلفة</span>
            {costItems.map((c) => (
              <div key={c.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="w-[110px]">
                  <SelectField
                    label="النوع"
                    value={c.costType}
                    onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, costType: v as LandedCostTypeDTO } : x)))}
                    options={Object.entries(COST_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                </div>
                <div className="flex-1">
                  <TextField label="الوصف" value={c.description} onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, description: v } : x)))} />
                </div>
                <div className="w-[100px]">
                  <NumberField label="المبلغ" value={c.amount} onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} min={0} />
                </div>
                <Button variant="ghost" onClick={() => setCostItems((prev) => prev.filter((x) => x.key !== c.key))} disabled={costItems.length === 1}>
                  حذف
                </Button>
              </div>
            ))}
            <Button variant="default" onClick={() => setCostItems((prev) => [...prev, blankCostItem()])}>
              إضافة بند
            </Button>
            <div className="text-end text-[13px] font-bold text-ink">
              إجمالي التكلفة: <MoneyDisplay value={totalCost} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">أصناف الفاتورة المستهدفة</span>
            {invoiceStockLines.length === 0 ? (
              <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-ink-muted">لا توجد أصناف مخزنية في هذه الفاتورة</div>
            ) : null}
            {targets.map((t) => (
              <div key={t.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <SelectField
                    label="الصنف"
                    value={t.itemId}
                    onChange={(v) => changeTargetItem(t.key, v)}
                    options={invoiceStockLines.map((sl) => ({ value: sl.itemId as string, label: itemName(sl.itemId as string) }))}
                  />
                </div>
                <div className="w-[80px]">
                  <NumberField label="الكمية" value={t.qty} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === t.key ? { ...x, qty: v } : x)))} min={0} />
                </div>
                <div className="w-[90px]">
                  <NumberField label="التكلفة الحالية" value={t.unitCost} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === t.key ? { ...x, unitCost: v } : x)))} min={0} />
                </div>
                <Button variant="ghost" onClick={() => setTargets((prev) => prev.filter((x) => x.key !== t.key))} disabled={targets.length === 1}>
                  حذف
                </Button>
              </div>
            ))}
            <Button
              variant="default"
              disabled={invoiceStockLines.length === 0}
              onClick={() => {
                const first = invoiceStockLines[0];
                setTargets((prev) => [...prev, blankTarget((first?.itemId as string) ?? "", first ? Number(first.qty) : 1, first ? Number(first.unitCost) : 0)]);
              }}
            >
              إضافة صنف
            </Button>
          </div>

          {preview ? (
            <div className="rounded-lg border border-border bg-surface p-[12px]">
              <div className="mb-[8px] text-[12.5px] font-semibold text-ink">معاينة التوزيع</div>
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="py-[7px]">{itemName(p.itemId)}</td>
                      <td className="mz-num py-[7px] text-end">+<MoneyDisplay value={Number(p.allocatedAmount.toString())} showUnit={false} /></td>
                      <td className="mz-num py-[7px] text-end"><MoneyDisplay value={Number(p.newUnitCost.toString())} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => submit(false)}>
              حفظ
            </Button>
            <Button variant="primary" onClick={() => submit(true)}>
              حفظ وتأكيد التوزيع
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? "مستند تكلفة إضافية"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>{itemName(l.itemId)}</span>
                  <span className="mz-num text-ink-muted">
                    +<MoneyDisplay value={num(l.allocatedAmount)} /> → تكلفة جديدة <MoneyDisplay value={num(l.newUnitCost)} />
                  </span>
                </div>
              ))}
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {selected.status === "draft" ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                  تأكيد التوزيع
                </Button>
                <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                  إلغاء
                </Button>
              </div>
            ) : null}
            {selected.status === "confirmed" ? (
              <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                إلغاء المستند
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
