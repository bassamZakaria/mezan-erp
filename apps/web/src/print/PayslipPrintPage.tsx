import { useMemo } from "react";
import { EmptyState, PrintView, resolvePrintTemplateConfig, useFormat, type PrintTemplateConfig } from "@mezan/ui";
import type { PayrollRunDTO, PayslipDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { useBranches, useDepartments, useEmployees, useJobTitles, usePrintTemplateConfig, useSettings } from "../data/hooks";
import { payslipPrintModel } from "./payslip-print";
import { employeeDisplayName } from "../screens/hr-employee-name";
import { EMPTY } from "../lib/empty";

/**
 * كشف الراتب — the printed payslip.
 *
 * Payroll could compute a net and never hand the employee a document showing
 * how it was reached. This is that document, through the SAME nine-tab print
 * template every other document uses, so a payslip carries the company's
 * letterhead and identifiers rather than being a screenshot of a table.
 */
export function PayslipPrintPage({ payslip, run }: { payslip: PayslipDTO; run: PayrollRunDTO }) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const configQuery = usePrintTemplateConfig();
  const settings = useSettings().data ?? null;
  const employees = useEmployees().data ?? EMPTY;
  const departments = useDepartments().data ?? EMPTY;
  const jobTitles = useJobTitles().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;

  const employee = employees.find((e) => e.id === payslip.employeeId);

  const document = useMemo(
    () =>
      payslipPrintModel({
        payslip,
        run,
        employee: {
          code: employee?.code ?? payslip.employeeId,
          name: employee ? employeeDisplayName(employee, locale) : payslip.employeeId,
          jobTitle: jobTitles.find((j) => j.id === employee?.jobTitleId)?.nameAr ?? undefined,
          department: departments.find((d) => d.id === employee?.departmentId)?.nameAr ?? undefined,
        },
        settings,
        branchName: branches.find((b) => b.id === employee?.branchId)?.name,
        currencyLabel: format.currencyLabel,
        documentTypeLabel: t("payslipPrint.documentType"),
        employeeRoleLabel: t("payslipPrint.employee"),
        labels: {
          earning: t("payslipPrint.earning"),
          deduction: t("payslipPrint.deduction"),
          employerContribution: t("payslipPrint.employerContribution"),
          grossEarnings: t("payslipPrint.grossEarnings"),
          totalDeductions: t("payslipPrint.totalDeductions"),
          netPay: t("payslipPrint.netPay"),
          employerContributions: t("payslipPrint.employerContributions"),
          paidDays: t("payslipPrint.paidDays"),
          garnishmentCapped: t("payslipPrint.garnishmentCapped"),
        },
        statutoryNotice: t("payslipPrint.statutoryNotComputed"),
      }),
    [payslip, run, employee, departments, jobTitles, branches, settings, format.currencyLabel, locale, t],
  );

  if (configQuery.isLoading) return null;
  if (!configQuery.data) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState title={t("payslipPrint.unavailableTitle")} description={t("payslipPrint.unavailableBody")} />
      </div>
    );
  }

  const config = resolvePrintTemplateConfig(configQuery.data as PrintTemplateConfig, "PAYSLIP");

  return (
    <div className="w-full">
      <PrintView config={config} document={document} />
    </div>
  );
}
