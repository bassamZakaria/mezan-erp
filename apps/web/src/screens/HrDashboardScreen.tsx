import { Button, Card, DonutChart, StatCard, TrendChart, type DonutSegment } from "@mezan/ui";
import { useBranches, useHrDashboard } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { LEAVE_TYPE_KEY } from "./hr-leave-labels";

/** لوحة الموارد البشرية (HR Dashboard) — docs/catalog/06 §"لوحة الموارد البشرية". Headcount/attendance/leave KPIs, four charts (department, branch, attendance mix, headcount movement), the leave-consumption table and alert tiles (R10.1). */

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

const ATTENDANCE_SLICE_KEY: Record<string, AppTranslationKey> = {
  present: "attendanceStatus.present",
  late: "attendanceStatus.late",
  half_day: "attendanceStatus.half_day",
  absent: "attendanceStatus.absent",
  on_leave: "attendanceStatus.on_leave",
};

export function HrDashboardScreen() {
  const { t, locale } = useAppTranslation();
  const query = useHrDashboard();
  const branchesQuery = useBranches();
  const summary = query.data;
  const branches = branchesQuery.data ?? [];

  function branchName(id: string): string {
    return branches.find((b) => b.id === id)?.name ?? id;
  }

  const departmentSegments: DonutSegment[] = (summary?.byDepartment ?? []).map((row, i) => ({
    key: row.departmentId,
    label: locale === "ar" ? (row.departmentNameAr ?? row.departmentName) : row.departmentName,
    value: row.count,
    color: CHART_COLORS[i % CHART_COLORS.length]!,
  }));

  const branchSegments: DonutSegment[] = (summary?.byBranch ?? []).map((row, i) => ({
    key: row.branchId,
    label: branchName(row.branchId),
    value: row.count,
    color: CHART_COLORS[i % CHART_COLORS.length]!,
  }));

  const attendance = summary?.attendance;
  const attendanceSegments: DonutSegment[] = [
    { key: "present", value: attendance?.daysPresent ?? 0 },
    { key: "late", value: attendance?.daysLate ?? 0 },
    { key: "half_day", value: attendance?.halfDays ?? 0 },
    { key: "absent", value: attendance?.daysAbsent ?? 0 },
    { key: "on_leave", value: attendance?.daysOnLeave ?? 0 },
  ].map((row, i) => ({
    key: row.key,
    label: t(ATTENDANCE_SLICE_KEY[row.key]!),
    value: row.value,
    color: CHART_COLORS[i % CHART_COLORS.length]!,
  }));

  const trend = summary?.headcountTrend ?? [];

  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">{t("eyebrow.hr.dashboard")}</div>
        <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("hrDashboard.hrDashboard")}</h1>
        <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("hrDashboard.anOverviewOfTheWorkforce")}</p>
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("hrDashboard.couldNotLoadTheHr")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("hrDashboard.activeEmployees")} value={<span className="mz-num">{summary?.activeEmployees ?? 0}</span>} />
        <StatCard label={t("hrDashboard.onLeave")} value={<span className="mz-num">{summary?.onLeave ?? 0}</span>} />
        <StatCard label={t("hrDashboard.hiresThisMonth")} value={<span className="mz-num">{summary?.hiresThisMonth ?? 0}</span>} />
        <StatCard label={t("hrDashboard.leaversThisMonth")} value={<span className="mz-num">{summary?.terminationsThisMonth ?? 0}</span>} />
      </div>

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard
          label={t("hrDashboard.absenceRate")}
          value={<span className="mz-num">{attendance?.absenceRatePercent ?? 0}%</span>}
          sub={t("hrDashboard.overTheLast30Days")}
          valueTone={(attendance?.absenceRatePercent ?? 0) >= 10 ? "danger" : "default"}
        />
        <StatCard
          label={t("hrDashboard.lateArrivals")}
          value={<span className="mz-num">{attendance?.daysLate ?? 0}</span>}
          sub={t("hrDashboard.percentOfAttendedDays", { percent: attendance?.lateArrivalRatePercent ?? 0 })}
          valueTone={(attendance?.lateArrivalRatePercent ?? 0) >= 15 ? "danger" : "default"}
        />
        <StatCard
          label={t("hrDashboard.contractsEndingWithin30Days")}
          value={<span className="mz-num">{summary?.contractsExpiringSoon ?? 0}</span>}
          valueTone={(summary?.contractsExpiringSoon ?? 0) > 0 ? "danger" : "default"}
        />
        <StatCard
          label={t("hrDashboard.probationEndingSoon")}
          value={<span className="mz-num">{summary?.probationEndingSoon ?? 0}</span>}
          valueTone={(summary?.probationEndingSoon ?? 0) > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
        <DonutChart
          title={t("hrDashboard.employeesByDepartment")}
          segments={departmentSegments}
          centerLabel={String(summary?.activeEmployees ?? 0)}
          centerSub={t("hrDashboard.employee")}
        />
        <DonutChart title={t("hrDashboard.employeesByBranch")} segments={branchSegments} centerLabel={String(summary?.activeEmployees ?? 0)} centerSub={t("hrDashboard.employee")} />
        <DonutChart
          title={t("hrDashboard.attendanceMix")}
          hint={t("hrDashboard.overTheLast30Days")}
          segments={attendanceSegments}
          centerLabel={String(attendance?.workingDays ?? 0)}
          centerSub={t("hrDashboard.day")}
        />
        <TrendChart
          title={t("hrDashboard.headcountMovement")}
          hint={t("hrDashboard.overTheLast12Months")}
          categories={trend.map((row) => row.month.slice(5))}
          series={[
            { key: "hires", label: t("hrDashboard.hires"), color: "var(--chart-1)", values: trend.map((row) => row.hires) },
            { key: "leavers", label: t("hrDashboard.leavers"), color: "var(--chart-4)", values: trend.map((row) => row.leavers) },
          ]}
        />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("hrDashboard.leaveTaken")}</h3>
        <div className="mt-[14px] overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-start text-ink-faint">
                <th className="px-[10px] py-[8px] text-start font-semibold">{t("hrDashboard.leaveType")}</th>
                <th className="px-[10px] py-[8px] text-end font-semibold">{t("hrDashboard.entitled")}</th>
                <th className="px-[10px] py-[8px] text-end font-semibold">{t("hrDashboard.taken")}</th>
                <th className="px-[10px] py-[8px] text-end font-semibold">{t("hrDashboard.pending")}</th>
                <th className="px-[10px] py-[8px] text-end font-semibold">{t("hrDashboard.usedPercent")}</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.leaveConsumption ?? []).map((row) => (
                <tr key={row.leaveType} className="border-b border-border last:border-0">
                  <td className="px-[10px] py-[8px] font-semibold text-ink">{t(LEAVE_TYPE_KEY[row.leaveType])}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end text-ink">{row.entitled ?? "—"}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end text-ink">{row.used}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end text-ink">{row.pending}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end text-ink">{row.usedPercent === null ? "—" : `${row.usedPercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
