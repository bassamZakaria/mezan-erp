import type { PostPostingChangeRowDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen } from "./SecurityReportScreen";
import { useAppTranslation } from "../../i18n";
import { monthStartIso, todayIso } from "../../lib/dates";

/** تقرير التعديلات بعد الترحيل — `/security-reports/post-posting-changes` (P-4). */

const CHANGE_TYPES = ["", "VOID", "REVERSE", "PERIOD_REOPENED", "NUMBERING_ADJUSTED"] as const;

export function PostPostingChangesReportScreen() {
  const { t } = useAppTranslation();

  const paramFields: ReportRunnerParamField[] = [
    { kind: "dateRange", fromKey: "from", toKey: "to", label: t("securityReports.period") },
    { kind: "text", key: "actor", label: t("securityReports.actor") },
    { kind: "text", key: "entityType", label: t("securityReports.entityType") },
    {
      kind: "select",
      key: "changeType",
      label: t("securityReports.changeType"),
      options: CHANGE_TYPES.map((value) => ({
        value,
        label: value === "" ? t("securityReports.anyChangeType") : t(`securityReports.changeType.${value}` as never),
      })),
    },
  ];

  const columns: ReportRunnerColumn<PostPostingChangeRowDTO>[] = [
    { key: "timestamp", header: t("securityReports.timestamp"), value: (r) => r.timestamp },
    { key: "actor", header: t("securityReports.actor"), value: (r) => r.actor },
    { key: "changeTypeLabelAr", header: t("securityReports.changeType"), value: (r) => r.changeTypeLabelAr },
    { key: "entityType", header: t("securityReports.entityType"), value: (r) => r.entityType },
    { key: "docNo", header: t("securityReports.docNo"), value: (r) => r.docNo },
    { key: "reversalId", header: t("securityReports.reversalId"), value: (r) => r.reversalId },
    { key: "reason", header: t("securityReports.reason"), value: (r) => r.reason },
    { key: "branchId", header: t("securityReports.branch"), value: (r) => r.branchId },
  ];

  return (
    <SecurityReportScreen<PostPostingChangeRowDTO>
      reportId="security.post_posting_changes"
      apiPath="/post-posting-changes"
      title={t("securityReports.postPostingTitle")}
      description={t("securityReports.postPostingDescription")}
      paramFields={paramFields}
      defaultParams={{ from: monthStartIso(), to: todayIso(), actor: "", entityType: "", changeType: "" }}
      columns={columns}
      rowKey={(r) => r.rowKey}
    />
  );
}
