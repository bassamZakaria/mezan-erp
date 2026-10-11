import {
  Button,
  EmptyState,
  PaginatedTable,
  PrintToolbar,
  type PaginatedTableColumn,
} from "@mezan/ui";
import type { SubCertificateWorkLineDTO } from "@mezan/contracts";
import { useProjects, useTenantSettings } from "../../../data/hooks";
import { useSubCertificate } from "../../../data/contracting-subcontracts-hooks";
import { useAppTranslation } from "../../../i18n";
import { EMPTY } from "../../../lib/empty";
import { unitLabel } from "../../../lib/boq-unit-label";
import { formatPercent } from "../../../lib/percent";
import { trimScale } from "./subcontract-common";

/**
 * المستخلص المطبوع لمقاول الباطن — portrait, because unlike the client
 * certificate there are no تشوينات lines and the column count is lower.
 *
 * Every Arabic sentence on the page comes from an i18n template with named
 * placeholders, and every figure is the server's `computed` block — nothing
 * here recomputes money.
 */

const SCALE = 1_000_000n;

/** Two decimals, always — the piastre boundary the server posts and prints on. */
function money(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const frac = ((match[3] ?? "") + "000000").slice(0, 6);
  const scaled = BigInt(match[2] ?? "0") * SCALE + BigInt(frac);
  const whole = (scaled / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = ((scaled % SCALE) / 10_000n).toString().padStart(2, "0");
  const rendered = `${whole}.${cents}`;
  // A deduction is a subtraction. Printed unsigned it reads as an addition to
  // the party who has to sign the sheet.
  return match[1] === "-" ? `(${rendered})` : rendered;
}

export function SubCertificatePrintPage({
  certificateId,
  onBack,
}: {
  certificateId: string;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const query = useSubCertificate(certificateId);
  const settings = useTenantSettings().data ?? null;
  const projects = useProjects().data ?? EMPTY;

  const certificate = query.data;
  if (!certificate) {
    return query.isLoading ? null : (
      <EmptyState
        title={t("subCertificates.notFound")}
        description={t("subCertificates.notFoundHint")}
        action={{ label: t("common.back"), onClick: onBack }}
      />
    );
  }

  const projectName = projects.find((p) => p.id === certificate.projectId)?.nameAr ?? certificate.projectId;
  const computed = certificate.computed;

  const columns: PaginatedTableColumn<SubCertificateWorkLineDTO>[] = [
    { key: "code", header: t("subCertificates.col.item"), render: (r) => `${r.code} — ${r.descriptionAr}` },
    { key: "unit", header: t("subCertificates.col.unit"), render: (r) => unitLabel(r.unit, t) },
    {
      key: "contracted",
      header: t("subCertificates.col.contractedQty"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.contractedQty)}</span>,
    },
    {
      key: "rate",
      header: t("subCertificates.col.unitRate"),
      align: "end",
      render: (r) => <span className="mz-num">{money(r.unitRate)}</span>,
    },
    {
      key: "previous",
      header: t("subCertificates.col.previous"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.previousCumulativeQty)}</span>,
    },
    {
      key: "thisPeriod",
      header: t("subCertificates.col.thisPeriod"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.thisPeriodQty)}</span>,
    },
    {
      key: "cumulative",
      header: t("subCertificates.col.cumulative"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.cumulativeQty)}</span>,
    },
    {
      key: "completion",
      header: t("subCertificates.col.completion"),
      align: "end",
      render: (r) => <span className="mz-num">{formatPercent(r.completionPercent)}%</span>,
    },
    {
      key: "value",
      header: t("subCertificates.col.value"),
      align: "end",
      render: (r) => <span className="mz-num">{money(r.cumulativeValue)}</span>,
      carry: (r) => r.cumulativeValue,
    },
  ];

  const identityHeader = (
    <header className="flex flex-col gap-[6px] border-b-2 border-border pb-[10px]">
      <div className="flex items-start justify-between gap-[14px]">
        <div>
          <div className="font-display text-[17px] font-bold text-ink">{settings?.companyName ?? ""}</div>
          <p className="text-[11px] text-ink-muted">
            {t("subCertificatePrint.title", { serial: String(certificate.serial), docNo: certificate.docNo })}
          </p>
        </div>
        <div className="text-end text-[10.5px] text-ink-muted">
          <div>{t("subCertificatePrint.subcontract", { docNo: certificate.subcontractDocNo })}</div>
          <div>{t("subCertificatePrint.subcontractor", { name: certificate.supplierNameAr })}</div>
          <div>{t("subCertificatePrint.project", { name: projectName })}</div>
          <div>
            {t("subCertificatePrint.contractorTaxNumber", {
              value: settings?.taxRegistrationNumber || t("common.notSet"),
            })}
          </div>
          <div>
            {t("subCertificatePrint.subcontractorTaxNumber", {
              value: certificate.supplierTaxNumber || t("common.notSet"),
            })}
          </div>
        </div>
      </div>
      <p className="text-[10.5px] text-ink-muted">
        {t("subCertificatePrint.period", {
          from: certificate.periodFrom,
          to: certificate.periodTo,
          executionDate: certificate.executionDate,
        })}
      </p>
      <p className="text-[10.5px] font-semibold text-ink">{t("subCertificatePrint.cumulativeBasis")}</p>
    </header>
  );

  const totalsRow = (label: string, value: string, strong = false) => (
    <div
      key={label}
      className={`flex items-baseline justify-between gap-[10px] border-b border-border py-[5px] ${strong ? "font-bold" : ""}`}
    >
      <span className="text-[11px] text-ink">{label}</span>
      <span className="mz-num text-[11.5px] text-ink">{money(value)}</span>
    </div>
  );

  /**
   * A cumulative-basis sheet argues in three columns. Printing only «هذا
   * المستخلص» per deduction gives the subcontractor no way to check the
   * cumulative against the previous certificate, which is the whole argument.
   */
  const deductionRow = (labelAr: string, percent: string | null, previous: string, thisCert: string, cumulative: string) => (
    <div key={labelAr} className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-[8px] border-b border-border py-[4px]">
      <span className="text-[11px] text-ink">{percent ? `${labelAr} — ${formatPercent(percent)}%` : labelAr}</span>
      <span className="mz-num w-[72px] text-end text-[11px] text-ink-muted">{money(previous)}</span>
      <span className="mz-num w-[72px] text-end text-[11px] text-ink">{money(thisCert)}</span>
      <span className="mz-num w-[80px] text-end text-[11px] text-ink">{money(cumulative)}</span>
    </div>
  );

  const footer = (
    <div className="mt-[10px] flex flex-col gap-[12px]">
      <section className="grid gap-[18px] sm:grid-cols-2">
        <div>
          {totalsRow(t("subCertificates.block.grossWorks"), computed.grossWorks)}
          {totalsRow(t("subCertificates.block.certificateTotal"), computed.certificateTotal, true)}
          {totalsRow(t("subCertificates.block.netCertified"), computed.netCertified, true)}
          {totalsRow(t("subCertificates.block.previousNetCertified"), computed.previousNetCertified)}
          {totalsRow(t("subCertificates.block.thisNetCertified"), computed.thisCertificateNetCertified, true)}
          {totalsRow(
            t("subCertificatePrint.vatBasis", {
              statutory: formatPercent(computed.vatStatutoryRatePercent),
              effective: formatPercent(computed.vatEffectiveRatePercent),
            }),
            computed.vat,
          )}
        </div>
        <div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-[8px] border-b-2 border-border pb-[4px] text-[10px] font-semibold text-ink-muted">
            <span>{t("subCertificates.block.deductions")}</span>
            <span className="w-[72px] text-end">{t("subCertificates.col.previous")}</span>
            <span className="w-[72px] text-end">{t("subCertificates.col.thisPeriod")}</span>
            <span className="w-[80px] text-end">{t("subCertificates.col.cumulative")}</span>
          </div>
          {computed.deductions.map((deduction) =>
            deductionRow(
              deduction.labelAr,
              deduction.percent,
              deduction.previous,
              deduction.thisCertificate,
              deduction.cumulative,
            ),
          )}
          {totalsRow(t("subCertificates.block.deductionsThis"), computed.deductionsThisCertificate, true)}
          {totalsRow(t("subCertificates.block.vat", { percent: formatPercent(computed.vatEffectiveRatePercent) }), computed.vat)}
          {totalsRow(t("subCertificates.block.netPayable"), computed.netPayableThisCertificate, true)}
        </div>
      </section>
    </div>
  );

  const signatures = (
    <div className="mt-[18px] grid grid-cols-2 gap-[24px] pt-[18px]">
      {[t("subCertificatePrint.signature.subcontractor"), t("subCertificatePrint.signature.contractor")].map((label) => (
        <div key={label} className="border-t border-border pt-[6px] text-center text-[10.5px] text-ink-muted">
          {label}
        </div>
      ))}
    </div>
  );

  return (
    <div className="mz-print-root w-full">
      <style>{`@page { size: A4 portrait; margin: 14mm 12mm; }`}</style>
      <div className="mb-[10px] flex items-center gap-[9px] print:hidden">
        <Button onClick={onBack}>{t("common.back")}</Button>
        <PrintToolbar pageSize="A4" landscape={false} />
      </div>
      <div dir="rtl" className="mx-auto bg-surface p-[14mm_12mm] text-[12px] text-ink print:m-0" style={{ width: "210mm" }}>
        <PaginatedTable<SubCertificateWorkLineDTO>
          columns={columns}
          rows={certificate.workLines}
          rowKey={(row) => row.id}
          rowsPerPage={22}
          identityHeader={identityHeader}
          footer={footer}
          signatures={signatures}
        />
      </div>
    </div>
  );
}
