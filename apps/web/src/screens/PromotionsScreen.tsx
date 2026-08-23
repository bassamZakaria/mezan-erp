import { useMemo, useState } from "react";
import { Button, Card, DocumentList, Money as MoneyDisplay, StatusPill, SidePanel, type DocumentListColumn, type DocumentListStatusChip } from "@mezan/ui";
import type { PromotionDTO, PromotionTypeDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useCreatePromotion, usePromotionUsageReport, usePromotions } from "../data/hooks";

const TYPE_LABEL: Record<PromotionTypeDTO, string> = {
  percentage: "نسبة خصم",
  fixed_amount: "خصم مبلغ",
  special_price: "سعر خاص",
  buy_x_get_y: "اشتر واحصل على",
  bundle: "حزمة",
};

type DerivedState = "active" | "scheduled" | "expiring" | "ended";

function deriveState(p: PromotionDTO, today = new Date().toISOString().slice(0, 10)): DerivedState {
  if (today < p.startDate) return "scheduled";
  if (today > p.endDate) return "ended";
  const daysLeft = (new Date(p.endDate).getTime() - new Date(today).getTime()) / 86_400_000;
  if (daysLeft <= 7) return "expiring";
  return "active";
}

const STATE_LABEL: Record<DerivedState, string> = {
  active: "فعال",
  scheduled: "مجدول",
  expiring: "قرب الانتهاء",
  ended: "منتهي",
};
const STATE_TONE: Record<DerivedState, "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  scheduled: "info",
  expiring: "warning",
  ended: "neutral",
};

/**
 * العروض / Promotions (docs/catalog/01 — رمز الخصم, النوع, النطاق, الفترة).
 * Real data only: list + create go through `GET/POST /promotions`. Active /
 * scheduled / expiring-soon are derived client-side from start/end dates,
 * same as the reference screen's KPI cards.
 */
/**
 * تقرير استخدام العروض — what each campaign actually granted, read from the
 * promotion snapshot every confirmed invoice stamped on itself. «المعكوس» is
 * the share taken back by confirmed sales returns against those invoices.
 */
function PromotionUsageReport() {
  const query = usePromotionUsageReport();
  const rows = query.data ?? [];

  return (
    <Card className="p-[18px_20px]">
      <h2 className="font-display text-[15px] font-bold text-ink">استخدام العروض</h2>
      <p className="mb-[12px] text-[12.5px] text-ink-muted">
        ما منحته كل حملة فعلياً على الفواتير المؤكدة، وما استُرد منه بالمرتجعات.
      </p>
      {query.isLoading ? (
        <div className="p-4 text-center text-sm text-ink-muted">جارِ التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-center text-sm text-ink-muted">لا توجد عروض في الفترة.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-[12px] text-ink-muted">
                <th className="p-[10px] text-start font-semibold">العرض</th>
                <th className="p-[10px] text-end font-semibold">مرات الاستخدام</th>
                <th className="p-[10px] text-end font-semibold">الخصم الممنوح</th>
                <th className="p-[10px] text-end font-semibold">المعكوس بالمرتجعات</th>
                <th className="p-[10px] text-end font-semibold">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border">
                  <td className="p-[10px] text-ink">
                    <div className="mz-num font-semibold">{row.code}</div>
                    <div className="text-[11px] text-ink-muted">{row.nameAr}</div>
                  </td>
                  <td className="mz-num p-[10px] text-end text-ink">{row.usageCount}</td>
                  <td className="p-[10px] text-end">
                    <MoneyDisplay value={Number(row.discountGranted)} />
                  </td>
                  <td className="p-[10px] text-end">
                    <MoneyDisplay value={Number(row.reversedDiscount)} />
                  </td>
                  <td className="p-[10px] text-end font-semibold">
                    <MoneyDisplay value={Number(row.netDiscount)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function PromotionsScreen() {
  const query = usePromotions();
  const promotions = query.data ?? [];
  const create = useCreatePromotion();

  const [panelOpen, setPanelOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<PromotionTypeDTO>("percentage");
  const [percentValue, setPercentValue] = useState(10);
  const [priority, setPriority] = useState(1);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiresCoupon, setRequiresCoupon] = useState(false);

  const counts = useMemo(() => {
    const c = { active: 0, scheduled: 0, expiring: 0, ended: 0 };
    for (const p of promotions) c[deriveState(p)] += 1;
    return c;
  }, [promotions]);

  const [statusFilter, setStatusFilter] = useState<"all" | DerivedState>("all");
  const filtered = statusFilter === "all" ? promotions : promotions.filter((p) => deriveState(p) === statusFilter);

  function resetForm() {
    setCode("");
    setNameAr("");
    setType("percentage");
    setPercentValue(10);
    setPriority(1);
    setRequiresCoupon(false);
  }

  async function submit() {
    if (!code.trim() || !nameAr.trim()) return;
    await create.mutateAsync({
      code: code.trim(),
      nameAr: nameAr.trim(),
      type,
      percentValue: type === "percentage" ? percentValue : null,
      priority,
      startDate,
      endDate,
      requiresCoupon,
      scope: { type: "all", ids: [] },
    });
    setPanelOpen(false);
    resetForm();
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: promotions.length },
    { key: "active", label: "فعال", count: counts.active },
    { key: "scheduled", label: "مجدول", count: counts.scheduled },
    { key: "expiring", label: "قرب الانتهاء", count: counts.expiring },
  ];

  const columns: DocumentListColumn<PromotionDTO>[] = [
    {
      key: "code",
      header: "الرمز",
      render: (p) => (
        <div>
          <div className="mz-num font-semibold text-ink">{p.code}</div>
          <div className="text-[11px] text-ink-muted">{p.nameAr}</div>
        </div>
      ),
    },
    { key: "type", header: "النوع", render: (p) => TYPE_LABEL[p.type] },
    { key: "period", header: "الفترة", render: (p) => <span className="mz-num">{`${p.startDate} → ${p.endDate}`}</span> },
    { key: "priority", header: "الأولوية", align: "end", render: (p) => <span className="mz-num">{p.priority}</span> },
    {
      key: "status",
      header: "الحالة",
      render: (p) => {
        const s = deriveState(p);
        return <StatusPill label={STATE_LABEL[s]} tone={STATE_TONE[s]} />;
      },
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<PromotionDTO>
        eyebrow="Sales · Promotions"
        title="العروض"
        description="خصومات وقواعد تسعير آلية تُطبّق على فواتير المبيعات — نسبة خصم، مبلغ ثابت، سعر خاص، اشتر واحصل على، أو حزمة."
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            إضافة عرض
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{promotions.length}</span> },
          { label: "فعال", value: <span className="mz-num">{counts.active}</span> },
          { label: "مجدول", value: <span className="mz-num">{counts.scheduled}</span> },
          { label: "قرب الانتهاء", value: <span className="mz-num">{counts.expiring}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DerivedState)}
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{promotions.length}</span> عرض
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">{query.isLoading ? "جارِ التحميل…" : "لا توجد عروض"}</div>
        }
      />

      <div className="mt-[16px]">
        <PromotionUsageReport />
      </div>

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إضافة عرض">
        <div className="flex flex-col gap-4 p-5">
          <TextField label="الرمز *" value={code} onChange={setCode} placeholder="SUMMER25" />
          <TextField label="الاسم *" value={nameAr} onChange={setNameAr} placeholder="خصم الصيف" />
          <SelectField
            label="النوع *"
            value={type}
            onChange={(v) => setType(v as PromotionTypeDTO)}
            options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          />
          {type === "percentage" ? (
            <NumberField label="قيمة الخصم % *" value={percentValue} onChange={setPercentValue} min={0} max={100} />
          ) : null}
          <NumberField label="الأولوية" value={priority} onChange={setPriority} min={0} />
          <TextField label="تاريخ البداية *" type="text" value={startDate} onChange={setStartDate} placeholder="YYYY-MM-DD" />
          <TextField label="تاريخ الانتهاء *" type="text" value={endDate} onChange={setEndDate} placeholder="YYYY-MM-DD" />
          <ToggleField label="يتطلب كوبون" checked={requiresCoupon} onChange={setRequiresCoupon} hint="بدون تفعيل، يُطبّق العرض تلقائياً على الفواتير المطابقة." />

          {create.isError ? (
            <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{create.error.message}</div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => setPanelOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" onClick={submit} disabled={create.isPending || !code.trim() || !nameAr.trim()}>
              إضافة
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
