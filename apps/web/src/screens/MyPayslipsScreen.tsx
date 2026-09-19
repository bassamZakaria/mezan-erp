import { useState } from "react";
import { Button, Card, EmptyState, Money as MoneyDisplay, type PrintTemplateConfig } from "@mezan/ui";
import type { SelfPayslipRowDTO } from "@mezan/contracts";
import { useSelfPayslipPrint, useSelfPayslips } from "../data/hr-self-hooks";
import { PayslipPrintView } from "../print/PayslipPrintPage";
import { majorOf } from "../lib/money";
import { useAppTranslation } from "../i18n";
import { employeeDisplayName } from "./hr-employee-name";

/** كشوف رواتبي — the caller's own payslips from approved runs, each printable on the company letterhead. */

function periodOf(row: SelfPayslipRowDTO): string {
  return `${row.run.year}-${String(row.run.month).padStart(2, "0")}`;
}

function PayslipPrint({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, locale } = useAppTranslation();
  const query = useSelfPayslipPrint(id);
  const data = query.data;
  return (
    <div className="w-full">
      <div className="mb-[14px] flex gap-[9px] print:hidden">
        <Button onClick={onBack}>{t("common.back")}</Button>
        {data ? (
          <Button variant="primary" onClick={() => window.print()}>
            {t("self.print")}
          </Button>
        ) : null}
      </div>
      {query.isError ? <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("self.payslipsCouldNotLoad")}</p> : null}
      {data ? (
        <PayslipPrintView
          payslip={data.payslip}
          run={data.run}
          employee={{
            code: data.employee.code,
            name: employeeDisplayName(data.employee, locale),
            jobTitle: (locale === "ar" ? data.employee.jobTitleNameAr : data.employee.jobTitleName) ?? data.employee.jobTitleNameAr ?? undefined,
            department: (locale === "ar" ? data.employee.departmentNameAr : data.employee.departmentName) ?? data.employee.departmentNameAr ?? undefined,
          }}
          letterhead={data.company}
          computedFromUnverified={data.statutoryUnverified}
          config={data.printTemplate as PrintTemplateConfig}
          configLoading={false}
        />
      ) : null}
    </div>
  );
}

export function MyPayslipsScreen() {
  const { t } = useAppTranslation();
  const query = useSelfPayslips();
  const [printingId, setPrintingId] = useState<string | null>(null);

  if (printingId) return <PayslipPrint id={printingId} onBack={() => setPrintingId(null)} />;

  const rows = query.data?.payslips ?? [];
  const linked = query.data?.employeeId != null;

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-[16px]">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">{t("self.eyebrow")}</div>
        <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("self.myPayslips")}</h1>
      </div>

      {query.isError ? (
        <Card className="p-[16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("self.payslipsCouldNotLoad")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {!query.isLoading && !query.isError && !linked ? (
        <Card className="p-[16px]">
          <p className="text-[13px] font-semibold text-ink">{t("self.notLinkedTitle")}</p>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("self.notLinkedBody")}</p>
        </Card>
      ) : null}

      {linked && rows.length === 0 && !query.isLoading ? (
        <Card>
          <EmptyState title={t("self.noPayslips")} description={t("self.noPayslipsBody")} />
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-[10px]">
          {rows.map((row) => (
            <Card key={row.payslip.id} className="flex flex-col gap-[10px] p-[14px]">
              <div className="flex items-center justify-between gap-[8px]">
                <div>
                  <div className="mz-num text-[15px] font-bold text-ink">{periodOf(row)}</div>
                  <div className="mz-num text-[11.5px] text-ink-faint">
                    {t("self.runNumber")} {row.run.number} · {row.payslip.number}
                  </div>
                </div>
                <Button size="sm" aria-label={t("self.printPayslipFor", { period: periodOf(row) })} onClick={() => setPrintingId(row.payslip.id)}>
                  {t("self.print")}
                </Button>
              </div>
              <dl className="grid grid-cols-3 gap-[8px] text-[12px]">
                <div>
                  <dt className="text-ink-faint">{t("self.gross")}</dt>
                  <dd>
                    <MoneyDisplay value={majorOf(row.payslip.grossEarnings)} />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{t("self.deductions")}</dt>
                  <dd>
                    <MoneyDisplay value={majorOf(row.payslip.totalDeductions)} />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{t("self.net")}</dt>
                  <dd className="font-bold">
                    <MoneyDisplay value={majorOf(row.payslip.netPay)} />
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
