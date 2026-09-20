import type { SodConflictRowDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen, securityCopy } from "./SecurityReportScreen";
import { useAppTranslation } from "../../i18n";
import { monthStartIso, todayIso } from "../../lib/dates";

/** تقرير تعارض الفصل بين المهام — `/security-reports/sod` (ENH-051). */

const REPORT = "sod" as const;

const KIND_LABELS_AR: Record<SodConflictRowDTO["kind"], string> = {
  role: "على مستوى الدور",
  user: "على مستوى المستخدم",
  transactional: "من سجل المراجعة",
};

export function SodReportScreen() {
  const { t } = useAppTranslation();

  const paramFields: ReportRunnerParamField[] = [
    { kind: "dateRange", fromKey: "from", toKey: "to", label: t("securityReports.period") },
  ];

  const columns: ReportRunnerColumn<SodConflictRowDTO>[] = [
    {
      key: "kind",
      header: t("securityReports.sod.kindTitle"),
      value: (r) => KIND_LABELS_AR[r.kind],
    },
    { key: "conflictLabelAr", header: securityCopy(REPORT, "col", "conflictLabelAr", "التعارض", t), value: (r) => r.conflictLabelAr },
    { key: "subjectLabelAr", header: securityCopy(REPORT, "col", "subjectLabelAr", "الدور/المستخدم", t), value: (r) => r.subjectLabelAr },
    { key: "roleCode", header: securityCopy(REPORT, "col", "roleCode", "رمز الدور", t), value: (r) => r.roleCode },
    { key: "sideAActor", header: securityCopy(REPORT, "col", "sideAActor", "الطرف الأول", t), value: (r) => r.sideAActor },
    { key: "sideBActor", header: securityCopy(REPORT, "col", "sideBActor", "الطرف الثاني", t), value: (r) => r.sideBActor },
  ];

  return (
    <SecurityReportScreen<SodConflictRowDTO>
      report={REPORT}
      reportId="security.sod"
      apiPath="/sod"
      title={t("securityReports.sodTitle")}
      description={t("securityReports.sodDescription")}
      paramFields={paramFields}
      defaultParams={{ from: monthStartIso(), to: todayIso() }}
      columns={columns}
      rowKey={(r) => r.rowKey}
    />
  );
}
