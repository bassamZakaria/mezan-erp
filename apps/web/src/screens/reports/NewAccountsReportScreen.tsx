import type { NewAccountRowDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen, securityCopy } from "./SecurityReportScreen";
import { useAppTranslation } from "../../i18n";

/** حسابات أُنشئت حديثاً — `/security-reports/new-accounts` (P-4). */

const REPORT = "newAccounts" as const;

export function NewAccountsReportScreen() {
  const { t } = useAppTranslation();

  const paramFields: ReportRunnerParamField[] = [
    { kind: "text", key: "days", label: t("securityReports.lookbackDays") },
    { kind: "text", key: "createdBy", label: t("securityReports.createdBy") },
  ];

  const columns: ReportRunnerColumn<NewAccountRowDTO>[] = [
    { key: "createdAt", header: securityCopy(REPORT, "col", "createdAt", "تاريخ الإنشاء", t), value: (r) => r.createdAt },
    { key: "nameAr", header: securityCopy(REPORT, "col", "nameAr", "الاسم", t), value: (r) => r.nameAr },
    { key: "email", header: securityCopy(REPORT, "col", "email", "البريد/اسم الدخول", t), value: (r) => r.email },
    { key: "createdBy", header: securityCopy(REPORT, "col", "createdBy", "أنشأه", t), value: (r) => r.createdBy },
    { key: "status", header: securityCopy(REPORT, "col", "status", "الحالة", t), value: (r) => r.status },
    { key: "lastLoginAt", header: securityCopy(REPORT, "col", "lastLoginAt", "آخر دخول", t), value: (r) => r.lastLoginAt },
    {
      key: "postedDocumentCount",
      header: securityCopy(REPORT, "col", "postedDocumentCount", "مستندات رحّلها", t),
      format: "qty",
      align: "end",
      value: (r) => r.postedDocumentCount,
      total: true,
    },
    {
      key: "voidedDocumentCount",
      header: securityCopy(REPORT, "col", "voidedDocumentCount", "مستندات ألغاها", t),
      format: "qty",
      align: "end",
      value: (r) => r.voidedDocumentCount,
      total: true,
    },
    {
      key: "credentialResetCount",
      header: securityCopy(REPORT, "col", "credentialResetCount", "إعادة تعيين بيانات الدخول", t),
      value: (r) => r.credentialResetCount,
    },
  ];

  return (
    <SecurityReportScreen<NewAccountRowDTO>
      report={REPORT}
      reportId="security.new_accounts"
      apiPath="/new-accounts"
      title={t("securityReports.newAccountsTitle")}
      description={t("securityReports.newAccountsDescription")}
      paramFields={paramFields}
      defaultParams={{ days: "90", createdBy: "" }}
      columns={columns}
      rowKey={(r) => r.userId}
    />
  );
}
