import { useMemo, useState } from "react";
import { Button, Card, Chip, Money, StatCard } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { useNavigation } from "../navigation";
import type { ScreenKey } from "../App";
import type { ScreenIntent } from "../navigation";
import { useDashboardSummary, type DashboardRange } from "../data/hooks";

type QuickAction = { label: string; screen: ScreenKey; intent?: ScreenIntent; primary?: boolean };

/** Quick-action launchers: each navigates to its screen and opens that screen's create flow. */
const quickActions: QuickAction[] = [
  { label: "فاتورة جديدة", screen: "sales-invoices", intent: "create" },
  { label: "سند نقدي", screen: "treasury-vouchers", intent: "create" },
  { label: "استلام بضاعة", screen: "goods-receipts", intent: "create", primary: true },
  { label: "فاتورة مشتريات جديدة", screen: "purchase-invoices", intent: "create" },
  { label: "أمر شراء جديد", screen: "purchase-orders", intent: "create" },
  { label: "عرض سعر", screen: "quotes", intent: "create" },
];

const RANGE_OPTIONS = [
  { value: "month", label: "هذا الشهر" },
  { value: "year", label: "هذا العام" },
  { value: "all", label: "كل الفترات" },
] as const;
type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function rangeToDates(range: RangeValue, now = new Date()): DashboardRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (range === "month") {
    return { fromDate: isoDate(new Date(Date.UTC(y, m, 1))), toDate: isoDate(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (range === "year") return { fromDate: `${y}-01-01`, toDate: `${y}-12-31` };
  return {};
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

/**
 * لوحة التحكم (Dashboard — Home). Every figure is REAL: KPIs and company-wide
 * totals come from `GET /dashboard/summary` (computed server-side from posted
 * GL journal entries + the entity repos), recent activity from the latest
 * posted entries, and the period control genuinely re-queries the P&L for the
 * chosen date window. Empty/zero states are shown where a tenant has no data
 * yet — never fabricated numbers.
 */
export function DashboardScreen() {
  const { session } = useApi();
  const { navigate } = useNavigation();
  const [range, setRange] = useState<RangeValue>("month");
  const dates = useMemo(() => rangeToDates(range), [range]);
  const query = useDashboardSummary(dates);
  const summary = query.data;

  const greetingName = session ? firstNameOf(session.fullName) : "";
  const gl = summary?.gl;
  const counts = summary?.counts;
  const netProfit = num(gl?.netProfit);

  const systemData = [
    { key: "accounts", label: "حسابات دليل الحسابات", value: counts?.accounts ?? 0 },
    { key: "customers", label: "العملاء", value: counts?.customers ?? 0 },
    { key: "suppliers", label: "الموردون", value: counts?.suppliers ?? 0 },
    { key: "items", label: "الأصناف", value: counts?.items ?? 0 },
    { key: "journalEntries", label: "القيود المحاسبية", value: counts?.journalEntries ?? 0 },
    { key: "users", label: "المستخدمون", value: counts?.users ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Overview</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">مرحباً، {greetingName} · طاب يومك</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">
            الأرقام محسوبة من القيود المحاسبية المرحلة · على مستوى الشركة
          </p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant={action.primary ? "primary" : "default"}
              onClick={() => navigate(action.screen, action.intent)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-[6px]" role="group" aria-label="نطاق الفترة">
        {RANGE_OPTIONS.map((opt) => (
          <Chip key={opt.value} type="button" active={range === opt.value} onClick={() => setRange(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات لوحة التحكم.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="إجمالي الإيرادات" value={<Money value={num(gl?.revenue)} />} sub="من المبيعات المرحلة" subTone="neutral" />
        <StatCard label="المصروفات التشغيلية" value={<Money value={num(gl?.expenses)} />} sub="من القيود المرحلة" subTone="neutral" />
        <StatCard
          label="صافي الربح"
          value={<Money value={netProfit} />}
          sub="الإيرادات − المصروفات"
          subTone={netProfit < 0 ? "down" : "up"}
          valueTone={netProfit < 0 ? "danger" : "default"}
        />
        <StatCard label="السيولة النقدية" value={<Money value={num(gl?.cash)} />} sub="أرصدة الصناديق والبنوك" subTone="neutral" />
      </div>

      <div>
        <div className="mb-[8px] text-[11px] font-bold uppercase tracking-[0.8px] text-ink-faint">على مستوى الشركة</div>
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
          <StatCard label="مبالغ لدى العملاء" value={<Money value={num(gl?.receivables)} />} />
          <StatCard label="مستحقات الموردين" value={<Money value={num(gl?.payables)} />} />
          <StatCard label="قيمة المخزون" value={<Money value={num(gl?.inventoryValue)} />} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
        <Card className="p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">بيانات النظام</h3>
          <div className="mt-[2px] text-[11.5px] text-ink-faint">إجماليات مسجّلة فعلياً</div>
          <dl className="mt-[14px] grid grid-cols-2 gap-[10px] sm:grid-cols-3">
            {systemData.map((row) => (
              <div key={row.key} className="rounded-md border border-border p-[10px_12px]">
                <dt className="text-[11.5px] text-ink-faint">{row.label}</dt>
                <dd className="mt-[2px] mz-num text-[18px] font-bold text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">النشاط الأخير</h3>
          <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">أحدث القيود المرحلة</div>
          {summary && summary.recentActivity.length > 0 ? (
            <ul className="flex flex-col gap-[10px]">
              {summary.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-[10px]">
                  <span aria-hidden className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-brand" />
                  <div>
                    <div className="text-[12.5px] text-ink">{entry.memo || entry.entryNo || entry.id}</div>
                    <div className="mt-[1px] text-[11px] text-ink-faint">
                      <span className="mz-num">{entry.date}</span>
                      {entry.entryNo ? <span className="mz-lat"> · {entry.entryNo}</span> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-muted">لا يوجد نشاط بعد — ستظهر القيود المرحلة هنا.</p>
          )}
        </Card>
      </div>

      <p className="text-[11px] text-ink-faint">
        جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة
      </p>
    </div>
  );
}
