import type { PostPostingChangeRowDTO } from "@mezan/contracts";
import { formatDateTime, type ReportRunnerColumn } from "@mezan/ui";
import { SecurityReportScreen, useUserFilterField, type SecurityParamField, securityCopy } from "./SecurityReportScreen";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { useAuditLabels } from "../enh/audit-ledger/audit-changes";
import { monthStartIso, todayIso } from "../../lib/dates";

/** تقرير التعديلات بعد الترحيل — `/security-reports/post-posting-changes` (P-4). */

const REPORT = "postPosting" as const;

const CHANGE_TYPES = ["", "VOID", "REVERSE", "PERIOD_REOPENED", "NUMBERING_ADJUSTED"] as const;

export function PostPostingChangesReportScreen() {
  const { t, locale } = useAppTranslation();
  const labels = useAuditLabels();

  const userFilter = useUserFilterField("actor", t("securityReports.actor"));
  const paramFields: SecurityParamField[] = [
    { kind: "dateRange", fromKey: "from", toKey: "to", label: t("securityReports.period") },
    userFilter,
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
    { key: "timestamp", header: securityCopy(REPORT, "col", "timestamp", "التاريخ والوقت", t), value: (r) => formatDateTime(new Date(r.timestamp), { locale }) },
    { key: "actor", header: securityCopy(REPORT, "col", "actor", "المستخدم", t), value: (r) => r.actorNameAr },
    {
      key: "changeTypeLabelAr",
      header: securityCopy(REPORT, "col", "changeTypeLabelAr", "نوع التعديل", t),
      value: (r) => t(`securityReports.changeType.${r.changeType}` as AppTranslationKey),
    },
    { key: "entityType", header: securityCopy(REPORT, "col", "entityType", "نوع المستند", t), value: (r) => labels.entityLabel(r.entityType) },
    { key: "docNo", header: securityCopy(REPORT, "col", "docNo", "رقم المستند", t), value: (r) => r.docNo },
    { key: "reversalId", header: securityCopy(REPORT, "col", "reversalId", "مستند العكس", t), value: (r) => r.reversalId },
    { key: "reason", header: securityCopy(REPORT, "col", "reason", "السبب", t), value: (r) => r.reason },
    { key: "branchId", header: securityCopy(REPORT, "col", "branchId", "الفرع", t), value: (r) => r.branchId },
  ];

  return (
    <SecurityReportScreen<PostPostingChangeRowDTO>
      report={REPORT}
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
