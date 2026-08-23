import { useMemo } from "react";
import { FulcrumRule, Button, Card, Money, StatCard } from "@mezan/ui";
import { useAccounts, useDashboardSummary, useFiscalPeriods } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";

/**
 * المحاسبة hub — reuses the SAME `/dashboard/summary` figures the main
 * dashboard shows (they are already GL-scoped and real), plus counts from
 * `/accounts` and `/fiscal-periods`. Recent activity is the dashboard's own
 * posted-journal-entries feed — already scoped to accounting, no re-derivation.
 */

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

const quickActions: { label: string; screen: ScreenKey }[] = [
  { label: "قيد محاسبي جديد", screen: "journals" },
  { label: "دليل الحسابات", screen: "coa" },
  { label: "ميزان المراجعة", screen: "trial-balance-report" },
  { label: "التقارير المالية", screen: "financial-reports" },
];

export function AccountingHubScreen() {
  const { navigate } = useNavigation();
  const summaryQuery = useDashboardSummary({});
  const accountsQuery = useAccounts();
  const periodsQuery = useFiscalPeriods();

  const summary = summaryQuery.data;
  const accounts = accountsQuery.data ?? [];
  const periods = periodsQuery.data ?? [];
  const openPeriods = useMemo(() => periods.filter((p) => p.status === "open").length, [periods]);
  const netProfit = num(summary?.gl.netProfit);

  const isLoading = summaryQuery.isLoading || accountsQuery.isLoading || periodsQuery.isLoading;
  const isError = summaryQuery.isError || accountsQuery.isError || periodsQuery.isError;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-eyebrow">Accounting</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">المحاسبة</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">دليل الحسابات والقيود والفترات المالية — من القيود المرحلة فعلياً</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات المحاسبة.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="عدد الحسابات" value={isLoading ? "—" : accounts.length} sub="دليل الحسابات" />
        <StatCard label="القيود المحاسبية" value={isLoading ? "—" : (summary?.counts.journalEntries ?? 0)} sub="إجمالي القيود المسجّلة" />
        <StatCard
          label="صافي الربح"
          value={<Money value={netProfit} />}
          sub="الإيرادات − المصروفات"
          subTone={netProfit < 0 ? "down" : "up"}
          valueTone={netProfit < 0 ? "danger" : "default"}
        />
        <StatCard label="الفترات المالية المفتوحة" value={isLoading ? "—" : openPeriods} sub={`من ${periods.length} فترة`} />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">أحدث القيود المرحلة</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">من نفس بيانات لوحة التحكم</div>
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
  );
}
