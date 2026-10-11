import {
  Button,
  EmptyState,
  PaginatedTable,
  PrintToolbar,
  type PaginatedTableColumn,
} from "@mezan/ui";
import type { CertificateWorkLineDTO } from "@mezan/contracts";
import { useCustomers, useProjects, useTenantSettings } from "../../../data/hooks";
import { useProgressCertificate } from "../../../data/contracting-certificates-hooks";
import { useAppTranslation } from "../../../i18n";
import { EMPTY } from "../../../lib/empty";
import { unitLabel } from "../../../lib/boq-unit-label";
import { formatPercent } from "../../../lib/percent";
import { trimScale } from "./certificate-common";

/**
 * The printed مستخلص — the document the module exists to produce.
 *
 * Landscape, because nine columns per BOQ line do not fit across 210mm, and
 * paginated by `PaginatedTable` so every page carries the identity header, the
 * page number, «ما قبله» and «يُرحل». The signatures block belongs to the
 * document and prints on the last page only.
 *
 * Every Arabic sentence on the page comes from an i18n template with named
 * placeholders. Assembling one from fragments at render time is how an Arabic
 * document ends up with a dangling إضافة or a number on the wrong side.
 */

const SCALE = 1_000_000n;

/**
 * A figure SUBTRACTED on the sheet prints in brackets, the way every Egyptian
 * certificate prints it. Printed bare, نسبة الممارسة and the whole deductions
 * column read as additions, and the block stops adding up on paper even when
 * it adds up in the ledger.
 */
function money(value: string, negative = false): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const frac = ((match[3] ?? "") + "000000").slice(0, 6);
  const scaled = BigInt(match[2] ?? "0") * SCALE + BigInt(frac);
  const whole = (scaled / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = ((scaled % SCALE) / 10_000n).toString().padStart(2, "0");
  const plain = `${whole}.${cents}`;
  const sign = match[1] === "-";
  if (negative !== sign) return `(${plain})`;
  return plain;
}

export function CertificatePrintPage({
  certificateId,
  onBack,
}: {
  certificateId: string;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const query = useProgressCertificate(certificateId);
  const settings = useTenantSettings().data ?? null;
  const projects = useProjects().data ?? EMPTY;
  const customers = useCustomers().data ?? EMPTY;

  const certificate = query.data;
  if (!certificate) {
    return query.isLoading ? null : (
      <EmptyState
        title={t("certificates.notFound")}
        description={t("certificates.notFoundHint")}
        action={{ label: t("common.back"), onClick: onBack }}
      />
    );
  }

  const projectName = projects.find((p) => p.id === certificate.projectId)?.nameAr ?? certificate.projectId;
  const customerName = customers.find((c) => c.id === certificate.customerId)?.nameAr ?? certificate.customerId;
  const computed = certificate.computed;

  const columns: PaginatedTableColumn<CertificateWorkLineDTO>[] = [
    { key: "code", header: t("certificates.col.item"), render: (r) => `${r.code} — ${r.descriptionAr}` },
    { key: "unit", header: t("certificates.col.unit"), render: (r) => unitLabel(r.unit, t) },
    {
      key: "contracted",
      header: t("certificates.col.contractedQty"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.contractedQty)}</span>,
    },
    {
      key: "rate",
      header: t("certificates.col.unitRate"),
      align: "end",
      render: (r) => <span className="mz-num">{money(r.unitRate)}</span>,
    },
    {
      key: "previous",
      header: t("certificates.col.previous"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.previousCumulativeQty)}</span>,
    },
    {
      key: "thisPeriod",
      header: t("certificates.col.thisPeriod"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.thisPeriodQty)}</span>,
    },
    {
      key: "cumulative",
      header: t("certificates.col.cumulative"),
      align: "end",
      render: (r) => <span className="mz-num">{trimScale(r.cumulativeQty)}</span>,
    },
    {
      key: "completion",
      header: t("certificates.col.completion"),
      align: "end",
      render: (r) => <span className="mz-num">{formatPercent(r.completionPercent)}%</span>,
    },
    {
      key: "value",
      header: t("certificates.col.value"),
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
            {t(certificate.isFinal ? "certificatePrint.titleFinal" : "certificatePrint.title", {
              serial: String(certificate.serial),
              docNo: certificate.docNo,
            })}
          </p>
        </div>
        <div className="text-end text-[10.5px] text-ink-muted">
          <div>{t("certificatePrint.contract", { docNo: certificate.contractDocNo })}</div>
          <div>{t("certificatePrint.employer", { name: customerName })}</div>
          <div>{t("certificatePrint.project", { name: projectName })}</div>
        </div>
      </div>
      <p className="text-[10.5px] text-ink-muted">
        {t("certificatePrint.period", {
          from: certificate.periodFrom,
          to: certificate.periodTo,
          executionDate: certificate.executionDate,
        })}
      </p>
      <p className="text-[10.5px] font-semibold text-ink">{t("certificatePrint.cumulativeBasis")}</p>
    </header>
  );

  const totalsRow = (label: string, value: string, strong = false, negative = false) => (
    <div
      key={label}
      className={`flex items-baseline justify-between gap-[10px] border-b border-border py-[5px] ${strong ? "font-bold" : ""}`}
    >
      <span className="text-[11px] text-ink">{label}</span>
      <span className="mz-num text-[11.5px] text-ink">{money(value, negative)}</span>
    </div>
  );

  const footer = (
    <div className="mt-[10px] flex flex-col gap-[12px]">
      {certificate.materialLines.length > 0 ? (
        <section>
          <h3 className="mb-[6px] text-[11.5px] font-bold text-ink">{t("certificates.section.materials")}</h3>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-border">
                <th className="p-[5px_8px] text-start">{t("certificates.col.item")}</th>
                <th className="p-[5px_8px] text-start">{t("certificates.col.unit")}</th>
                <th className="p-[5px_8px] text-end">{t("certificates.col.cumulative")}</th>
                <th className="p-[5px_8px] text-end">{t("certificates.col.unitRate")}</th>
                <th className="p-[5px_8px] text-end">{t("certificates.col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {certificate.materialLines.map((row) => (
                <tr key={row.id} className="border-b border-border">
                  <td className="p-[5px_8px]">{row.descriptionAr}</td>
                  <td className="p-[5px_8px]">{unitLabel(row.unit, t)}</td>
                  <td className="mz-num p-[5px_8px] text-end">{trimScale(row.cumulativeQty)}</td>
                  <td className="mz-num p-[5px_8px] text-end">{money(row.unitRate)}</td>
                  <td className="mz-num p-[5px_8px] text-end">{money(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="grid gap-[18px] sm:grid-cols-2">
        <div>
          {totalsRow(t("certificates.block.grossWorks"), computed.grossWorks)}
          {totalsRow(t("certificates.block.materialsOnSite"), computed.materialsOnSite)}
          {totalsRow(t("certificates.block.certificateTotal"), computed.certificateTotal, true)}
          {totalsRow(
            t("certificates.block.tenderDiscount", { percent: formatPercent(computed.tenderDiscountPercent) }),
            computed.tenderDiscount,
            false,
            true,
          )}
          {totalsRow(t("certificates.block.netCertified"), computed.netCertified, true)}
          {/* The bridge from the CUMULATIVE column to this certificate's own
              figure. Without these two rows the sheet jumps from a cumulative
              net certified to a period deduction and the employer cannot
              follow how one became the other. */}
          {totalsRow(t("certificates.block.previousNetCertified"), computed.previousNetCertified, false, true)}
          {totalsRow(t("certificates.block.thisNetCertified"), computed.thisCertificateNetCertified, true)}
        </div>
        <div>
          {computed.deductions.map((deduction) =>
            totalsRow(
              `${deduction.percent ? `${deduction.labelAr} — ${formatPercent(deduction.percent)}%` : deduction.labelAr}${deduction.noteAr ? ` — ${deduction.noteAr}` : ""}`,
              deduction.thisCertificate,
              false,
              true,
            ),
          )}
          {totalsRow(t("certificates.block.deductionsThisCertificate"), computed.deductionsThisCertificate, true, true)}
          {totalsRow(t("certificates.block.vat", { percent: formatPercent(computed.vatEffectiveRatePercent) }), computed.vat)}
          {totalsRow(t("certificates.block.netPayable"), computed.netPayableThisCertificate, true)}
        </div>
      </section>
    </div>
  );

  const signatures = (
    <div className="mt-[18px] grid grid-cols-3 gap-[24px] pt-[18px]">
      {[
        t("certificatePrint.signature.contractor"),
        t("certificatePrint.signature.consultant"),
        t("certificatePrint.signature.employer"),
      ].map((label) => (
        <div key={label} className="border-t border-border pt-[6px] text-center text-[10.5px] text-ink-muted">
          {label}
        </div>
      ))}
    </div>
  );

  return (
    <div className="mz-print-root w-full">
      <style>{`@page { size: A4 landscape; margin: 12mm 10mm; }`}</style>
      <div className="mb-[10px] flex items-center gap-[9px] print:hidden">
        <Button onClick={onBack}>{t("common.back")}</Button>
        <PrintToolbar pageSize="A4" landscape />
      </div>
      <div dir="rtl" className="mx-auto bg-surface p-[12mm_10mm] text-[12px] text-ink print:m-0" style={{ width: "297mm" }}>
        <PaginatedTable<CertificateWorkLineDTO>
          columns={columns}
          rows={certificate.workLines}
          rowKey={(row) => row.id}
          rowsPerPage={18}
          identityHeader={identityHeader}
          footer={footer}
          signatures={signatures}
        />
      </div>
    </div>
  );
}
