import type { NewAccountRowDTO } from "@mezan/contracts";
import type { ReportRunnerColumn, ReportRunnerParamField } from "@mezan/ui";
import { SecurityReportScreen } from "./SecurityReportScreen";
import { useAppTranslation } from "../../i18n";

/** حسابات أُنشئت حديثاً — `/security-reports/new-accounts` (P-4). */

export function NewAccountsReportScreen() {
  const { t } = useAppTranslation();

  const paramFields: ReportRunnerParamField[] = [
    { kind: "text", key: "days", label: t("securityReports.lookbackDays") },
    { kind: "text", key: "createdBy", label: t("securityReports.createdBy") },
  ];

  const columns: ReportRunnerColumn<NewAccountRowDTO>[] = [
    { key: "createdAt", header: t("securityReports.createdAt"), value: (r) => r.createdAt },
    { key: "nameAr", header: t("securityReports.accountName"), value: (r) => r.nameAr },
    { key: "email", header: t("securityReports.login"), value: (r) => r.email },
    { key: "createdBy", header: t("securityReports.createdBy"), value: (r) => r.createdBy },
    { key: "status", header: t("securityReports.status"), value: (r) => r.status },
    { key: "lastLoginAt", header: t("securityReports.lastLogin"), value: (r) => r.lastLoginAt },
    { key: "postedDocumentCount", header: t("securityReports.postedDocuments"), format: "qty", align: "end", value: (r) => r.postedDocumentCount, total: true },
    { key: "voidedDocumentCount", header: t("securityReports.voidedDocuments"), format: "qty", align: "end", value: (r) => r.voidedDocumentCount, total: true },
    { key: "credentialResetCount", header: t("securityReports.credentialResets"), format: "qty", align: "end", value: (r) => r.credentialResetCount },
  ];

  return (
    <SecurityReportScreen<NewAccountRowDTO>
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
