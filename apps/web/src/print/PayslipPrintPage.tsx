import { useMemo } from "react";
import { EmptyState, PrintView, resolvePrintTemplateConfig, useFormat, type PrintTemplateConfig } from "@mezan/ui";
import type { PayrollRunDTO, PayslipDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { useBranches, useDepartments, useEmployees, useJobTitles, usePrintTemplateConfig, useSettings } from "../data/hooks";
import { payslipPrintModel, type PayslipLetterhead, type PayslipPrintEmployee } from "./payslip-print";
import { useUnverifiedStatutoryCodes } from "../data/hr-payroll-hooks";
import { employeeDisplayName } from "../screens/hr-employee-name";
import { EMPTY } from "../lib/empty";

const PAY_BASIS_KEY = {
  monthly: "payroll.basis.monthly",
  hourly: "payroll.basis.hourly",
  daily: "payroll.basis.daily",
} as const;

/**
 * كشف الراتب — the printed payslip.
 *
 * Payroll could compute a net and never hand the employee a document showing
 * how it was reached. This is that document, through the SAME nine-tab print
 * template every other document uses, so a payslip carries the company's
 * letterhead and identifiers rather than being a screenshot of a table.
 */
export function PayslipPrintPage({ payslip, run }: { payslip: PayslipDTO; run: PayrollRunDTO }) {
  const { locale } = useAppTranslation();
  const configQuery = usePrintTemplateConfig();
  const settings = useSettings().data ?? null;
  const employees = useEmployees().data ?? EMPTY;
  const departments = useDepartments().data ?? EMPTY;
  const jobTitles = useJobTitles().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;

  const employee = employees.find((e) => e.id === payslip.employeeId);
  const unverifiedCodes = useUnverifiedStatutoryCodes();
  const computedFromUnverified = payslip.lines.some((l) => l.referenceId !== null && unverifiedCodes.has(l.referenceId));

  return (
    <PayslipPrintView
      payslip={payslip}
      run={run}
      employee={{
        code: employee?.code ?? payslip.employeeId,
        name: employee ? employeeDisplayName(employee, locale) : payslip.employeeId,
        jobTitle: jobTitles.find((j) => j.id === employee?.jobTitleId)?.nameAr ?? undefined,
        department: departments.find((d) => d.id === employee?.departmentId)?.nameAr ?? undefined,
      }}
      letterhead={settings}
      branchName={branches.find((b) => b.id === employee?.branchId)?.name}
      computedFromUnverified={computedFromUnverified}
      config={configQuery.data as PrintTemplateConfig | undefined}
      configLoading={configQuery.isLoading}
    />
  );
}

export interface PayslipPrintViewProps {
  payslip: PayslipDTO;
  run: Pick<PayrollRunDTO, "number" | "year" | "month" | "periodStart" | "periodEnd"> & { readonly statutoryTableCodes: readonly string[] };
  employee: PayslipPrintEmployee;
  letterhead: PayslipLetterhead | null;
  branchName?: string;
  computedFromUnverified: boolean;
  config: PrintTemplateConfig | undefined;
  configLoading: boolean;
}

/** The payslip on paper, from data the caller already holds — the self-service copy reads it all from one `/hr/self` call. */
export function PayslipPrintView({ payslip, run, employee, letterhead, branchName, computedFromUnverified, config, configLoading }: PayslipPrintViewProps) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const statutory = run.statutoryTableCodes.length > 0;

  const document = useMemo(
    () =>
      payslipPrintModel({
        payslip,
        run,
        employee,
        settings: letterhead,
        branchName,
        currencyLabel: format.currencyLabel,
        documentTypeLabel: t("payslipPrint.documentType"),
        employeeRoleLabel: t("payslipPrint.employee"),
        labels: {
          earning: t("payslipPrint.earning"),
          deduction: t("payslipPrint.deduction"),
          employerContribution: t("payslipPrint.employerContribution"),
          terminationAdjustment: t("payroll.lineKind.termination_adjustment"),
          grossEarnings: t("payslipPrint.grossEarnings"),
          totalDeductions: t("payslipPrint.totalDeductions"),
          netPay: t("payslipPrint.netPay"),
          employerContributions: t("payslipPrint.employerContributions"),
          paidDays: t("payslipPrint.paidDays"),
          statutoryCapped: t("payslipPrint.statutoryCapped"),
          insurableWage: t("payslipPrint.insurableWage"),
          payBasis: t("payroll.payBasis"),
          basisName: payslip.basis ? t(PAY_BASIS_KEY[payslip.basis.payBasis]) : undefined,
          quantityUnit: payslip.basis?.payBasis === "hourly" ? t("payroll.hours") : t("payroll.days"),
          contractCurrency: t("payroll.contractCurrency"),
          fxRate: t("payroll.fxRate"),
          grossInContractCurrency: t("payroll.grossInContractCurrency"),
          netInContractCurrency: t("payroll.netInContractCurrency"),
        },
        formatAmount: (value: string) => format.money(Number(value)),
        statutory,
        statutoryNotice: !statutory
          ? t("payslipPrint.statutoryNotComputed")
          : computedFromUnverified
            ? t("payslipPrint.statutoryUnverified")
            : undefined,
      }),
    [payslip, run, employee, letterhead, branchName, format, t, statutory, computedFromUnverified],
  );

  if (configLoading) return null;
  if (!config) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState title={t("payslipPrint.unavailableTitle")} description={t("payslipPrint.unavailableBody")} />
      </div>
    );
  }

  return (
    <div className="w-full">
      <PrintView config={resolvePrintTemplateConfig(config, "PAYSLIP")} document={document} />
    </div>
  );
}
