import { Button, Card, DonutChart, StatCard, type DonutSegment } from "@mezan/ui";
import { useBranches, useHrDashboard } from "../data/hooks";

/** لوحة الموارد البشرية (HR Dashboard) — docs/catalog/06 §"لوحة الموارد البشرية". Headcount/attendance/leave KPIs, department/branch breakdowns, leave-consumption table, and alert chips. */

const LEAVE_TYPE_LABEL: Record<string, string> = { annual: "إجازة سنوية", sick: "إجازة مرضية", personal: "الإجازة الشخصية" };
const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export function HrDashboardScreen() {
  const query = useHrDashboard();
  const branchesQuery = useBranches();
  const summary = query.data;
  const branches = branchesQuery.data ?? [];

  function branchName(id: string): string {
    return branches.find((b) => b.id === id)?.name ?? id;
  }

  const departmentSegments: DonutSegment[] = (summary?.byDepartment ?? []).map((row, i) => ({
    key: row.departmentId,
    label: row.departmentName,
    value: row.count,
    color: CHART_COLORS[i % CHART_COLORS.length]!,
  }));

  const branchSegments: DonutSegment[] = (summary?.byBranch ?? []).map((row, i) => ({
    key: row.branchId,
    label: branchName(row.branchId),
    value: row.count,
    color: CHART_COLORS[i % CHART_COLORS.length]!,
  }));

  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">HR · Dashboard</div>
        <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">لوحة الموارد البشرية</h1>
        <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">نظرة عامة على القوى العاملة، العقود والإجازات</p>
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات لوحة الموارد البشرية.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="الموظفون النشطون" value={<span className="mz-num">{summary?.activeEmployees ?? 0}</span>} />
        <StatCard label="في إجازة" value={<span className="mz-num">{summary?.onLeave ?? 0}</span>} />
        <StatCard label="التعيينات هذا الشهر" value={<span className="mz-num">{summary?.hiresThisMonth ?? 0}</span>} />
        <StatCard label="إنهاء الخدمة هذا الشهر" value={<span className="mz-num">{summary?.terminationsThisMonth ?? 0}</span>} />
      </div>

      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <StatCard
          label="عقود تنتهي خلال 30 يوماً"
          value={<span className="mz-num">{summary?.contractsExpiringSoon ?? 0}</span>}
          valueTone={(summary?.contractsExpiringSoon ?? 0) > 0 ? "danger" : "default"}
        />
        <StatCard
          label="انتهاء الفترة التجريبية قريباً"
          value={<span className="mz-num">{summary?.probationEndingSoon ?? 0}</span>}
          valueTone={(summary?.probationEndingSoon ?? 0) > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
        <DonutChart
          title="الموظفون حسب القسم"
          segments={departmentSegments}
          centerLabel={String(summary?.activeEmployees ?? 0)}
          centerSub="موظف"
        />
        <DonutChart title="الموظفون حسب الفرع" segments={branchSegments} centerLabel={String(summary?.activeEmployees ?? 0)} centerSub="موظف" />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">استهلاك الإجازات</h3>
        <div className="mt-[14px] overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-start text-ink-faint">
                <th className="px-[10px] py-[8px] text-start font-semibold">نوع الإجازة</th>
                <th className="px-[10px] py-[8px] text-end font-semibold">المستخدم</th>
                <th className="px-[10px] py-[8px] text-end font-semibold">قيد الانتظار</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.leaveConsumption ?? []).map((row) => (
                <tr key={row.leaveType} className="border-b border-border last:border-0">
                  <td className="px-[10px] py-[8px] font-semibold text-ink">{LEAVE_TYPE_LABEL[row.leaveType] ?? row.leaveType}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end text-ink">{row.used}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end text-ink">{row.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
