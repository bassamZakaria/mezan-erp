import { useMemo, useRef, useState } from "react";
import {
  Button,
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import {
  Money,
  Qty,
  distributeLandedCost,
  type DocumentStatus,
  type FrameworkDocument,
  type LandedCostLine,
  type LandedCostType,
  type LandedCostDistributionMethod,
} from "@mezan/domain";
import { SelectField, NumberField, TextField } from "../settings/form-controls";
import { demoWarehouses } from "../sample-data";
import { demoItems } from "../items-sample-data";
import { createReturnsLandedInstallmentsStore } from "../store/returns-landed-installments-store";
import { demoAccounts, demoOpenPeriod } from "../store/document-demo-shared";

/** التكاليف الإضافية (Landed Costs) — docs/catalog/02. Distributes freight/customs/etc across a purchase invoice's item costs, by value or by quantity. */

const DEMO_PURCHASE_INVOICES = [
  { id: "pi-1", number: "PI-000001", supplierName: "جاري" },
  { id: "pi-2", number: "PI-000002", supplierName: "جاري" },
];

const COST_TYPE_LABEL: Record<LandedCostType, string> = {
  SHIPPING: "شحن",
  CUSTOMS: "جمارك",
  INSURANCE: "تأمين",
  CLEARANCE: "تخليص",
  OTHER: "أخرى",
};

const METHOD_LABEL: Record<LandedCostDistributionMethod, string> = { BY_VALUE: "حسب القيمة", BY_QUANTITY: "حسب الكمية" };

type Doc = FrameworkDocument<LandedCostLine>;

const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "مؤكد",
  posted: "مرحل",
  cancelled: "ملغي",
  reversed: "معكوس",
};
const STATUS_TONE: Record<DocumentStatus, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  posted: "success",
  cancelled: "neutral",
  reversed: "danger",
};

interface CostItemDraft {
  key: string;
  costType: LandedCostType;
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
function blankTarget(): TargetDraft {
  seq += 1;
  const item = demoItems[0];
  return { key: `t${seq}`, itemId: item?.id ?? "", qty: 10, unitCost: Number(item?.costPrice ?? 0) };
}

export function LandedCostsScreen() {
  const storeRef = useRef(createReturnsLandedInstallmentsStore({ accounts: demoAccounts, period: demoOpenPeriod }));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const documents = useMemo(() => storeRef.current.snapshot().landedCosts, [version]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>("all");
  const [warehouseId, setWarehouseId] = useState(demoWarehouses[0]?.id ?? "");
  const [invoiceId, setInvoiceId] = useState(DEMO_PURCHASE_INVOICES[0]?.id ?? "");
  const [method, setMethod] = useState<LandedCostDistributionMethod>("BY_VALUE");
  const [costItems, setCostItems] = useState<CostItemDraft[]>([blankCostItem()]);
  const [targets, setTargets] = useState<TargetDraft[]>([blankTarget()]);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      if (d.status === "confirmed") c.confirmed += 1;
    }
    return c;
  }, [documents]);

  const filtered = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
  const selected = typeof panel === "object" ? documents.find((d) => d.id === panel.id) ?? null : null;

  const totalCost = costItems.reduce((s, c) => s + (c.amount || 0), 0);

  async function submit(confirmAfter: boolean) {
    setError(null);
    const invoice = DEMO_PURCHASE_INVOICES.find((i) => i.id === invoiceId);
    const id = crypto.randomUUID();
    try {
      const items = costItems.filter((c) => c.amount > 0).map((c) => ({ costType: c.costType, description: c.description, amount: Money.fromMajor(String(c.amount)) }));
      const allocated = distributeLandedCost(
        items,
        method,
        targets.map((t) => ({
          itemId: t.itemId,
          warehouseId,
          sourceInvoiceId: invoiceId,
          sourceInvoiceNumber: invoice?.number ?? null,
          qty: Qty.fromMajor(String(t.qty)),
          unitCost: Money.fromMajor(String(t.unitCost)),
        })),
      );
      const lines: LandedCostLine[] = allocated.map((a) => ({ ...a, costItems: items, distributionMethod: method }));
      await storeRef.current.landedCostDocuments.createDraft({ id, date: new Date().toISOString().slice(0, 10), memo: "", lines });
      if (confirmAfter) await storeRef.current.landedCosts.confirm(id, { actor: "demo", actorRoles: ["*"] });
      bump();
      setPanel("none");
      setCostItems([blankCostItem()]);
      setTargets([blankTarget()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmExisting(id: string) {
    try {
      await storeRef.current.landedCosts.confirm(id, { actor: "demo", actorRoles: ["*"] });
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "draft", label: "مسودة", count: counts.draft },
    { key: "confirmed", label: "مؤكد", count: counts.confirmed },
  ];

  const columns: DocumentListColumn<Doc>[] = [
    { key: "docNo", header: "رقم المستند", render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? "مسودة"}</span> },
    { key: "method", header: "طريقة التوزيع", render: (d) => METHOD_LABEL[d.lines[0]?.distributionMethod ?? "BY_VALUE"] },
    {
      key: "total",
      header: "إجمالي التكلفة",
      align: "end",
      render: (d) => <MoneyDisplay value={Number(Money.sum(d.lines.map((l) => l.allocatedAmount)).toString())} />,
    },
    { key: "status", header: "الحالة", render: (d) => <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} /> },
  ];

  return (
    <div className="w-full">
      <DocumentList<Doc>
        eyebrow="Purchases · Landed Costs"
        title="التكاليف الإضافية"
        description="توزيع تكاليف الشحن/الجمارك/التأمين على بنود فاتورة مشتريات مؤكدة، حسب القيمة أو الكمية."
        actions={
          <Button variant="primary" onClick={() => setPanel("create")}>
            مستند تكلفة جديد
          </Button>
        }
        stats={[
          { label: "إجمالي المستندات", value: <span className="mz-num">{counts.all}</span> },
          { label: "مؤكدة", value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatus)}
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
          <SelectField label="المستودع *" value={warehouseId} onChange={setWarehouseId} options={demoWarehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label="الفاتورة المرتبطة *"
            value={invoiceId}
            onChange={setInvoiceId}
            options={DEMO_PURCHASE_INVOICES.map((i) => ({ value: i.id, label: `${i.number} — ${i.supplierName}` }))}
          />
          <SelectField
            label="طريقة التوزيع *"
            value={method}
            onChange={(v) => setMethod(v as LandedCostDistributionMethod)}
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
                    onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, costType: v as LandedCostType } : x)))}
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
            {targets.map((t) => (
              <div key={t.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <SelectField
                    label="الصنف"
                    value={t.itemId}
                    onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === t.key ? { ...x, itemId: v } : x)))}
                    options={demoItems.map((it) => ({ value: it.id, label: it.nameAr }))}
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
            <Button variant="default" onClick={() => setTargets((prev) => [...prev, blankTarget()])}>
              إضافة صنف
            </Button>
          </div>

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
                  <span>{demoItems.find((it) => it.id === l.itemId)?.nameAr ?? l.itemId}</span>
                  <span className="mz-num text-ink-muted">
                    +<MoneyDisplay value={Number(l.allocatedAmount.toString())} /> → تكلفة جديدة <MoneyDisplay value={Number(l.newUnitCost.toString())} />
                  </span>
                </div>
              ))}
            </div>
            {selected.status === "draft" ? (
              <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                تأكيد التوزيع
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
