import { useMemo } from "react";
import { cn } from "../lib/cn";
import { formatDate, formatNumber } from "../lib/format";
import { Button, Money } from "../primitives/atoms";
import { useElectronPrintToPdf } from "./useElectronPrintToPdf";
import { resolvePrintTemplateConfig, type PrintDocumentModel, type PrintTemplateConfig } from "./types";

/**
 * The single renderer every printable document (A4/A5 invoice, quote, PO,
 * GRN, voucher, ...) reuses: it consumes a `PrintTemplateConfig` (the 9-tab
 * designer, as data) and a generic `PrintDocumentModel`, and renders the
 * page with a `@media print` stylesheet (docs/plan.md §2.4). Same DOM for
 * both output paths — browser calls `window.print()`, desktop calls
 * `webContents.printToPDF` through `useElectronPrintToPdf` — so there is
 * nothing platform-specific inside the render tree itself.
 */

export interface PrintViewProps {
  config: PrintTemplateConfig;
  document: PrintDocumentModel;
  /** Hides the on-screen "طباعة" / "حفظ PDF" toolbar (it's always excluded from the printed output via `@media print`). */
  showToolbar?: boolean;
  className?: string;
}

const PAGE_WIDTH_MM: Record<"A4" | "A5", number> = { A4: 210, A5: 148 };

function PrintToolbar({ pageSize }: { pageSize: "A4" | "A5" }) {
  const { isAvailable, printToPdf } = useElectronPrintToPdf();

  return (
    <div className="mb-[14px] flex items-center gap-[9px] print:hidden">
      <Button variant="primary" onClick={() => window.print()}>
        طباعة
      </Button>
      {isAvailable ? (
        <Button
          variant="default"
          onClick={() => {
            void printToPdf({ pageSize });
          }}
        >
          حفظ PDF
        </Button>
      ) : null}
    </div>
  );
}

export function PrintView({ config, document, showToolbar = true, className }: PrintViewProps) {
  const effective = useMemo(
    () => resolvePrintTemplateConfig(config, document.documentType),
    [config, document.documentType],
  );

  const { identity, header, content, columns, totals: totalsConfig, footer, watermark } = effective;
  const currencyLabel = document.totals.currencyLabel ?? "ج.م";
  const pageWidthMm = PAGE_WIDTH_MM[effective.pageSize];
  const signatureLabels = footer.signatureLabels.slice(0, footer.signatureCount);
  while (signatureLabels.length < footer.signatureCount) signatureLabels.push("");

  return (
    <div className={cn("mz-print-root", className)}>
      <style>{`@page { size: ${effective.pageSize}; margin: 14mm 12mm; }`}</style>

      {showToolbar ? <PrintToolbar pageSize={effective.pageSize} /> : null}

      <div
        dir="rtl"
        className="relative mx-auto overflow-hidden bg-surface p-[16mm_14mm] text-[12.5px] text-ink print:m-0"
        style={{ width: `${pageWidthMm}mm`, minHeight: `${(pageWidthMm * 297) / 210}mm`, borderColor: identity.primaryColor }}
      >
        {watermark.text ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{ opacity: watermark.opacity }}
          >
            <span className="rotate-[-30deg] whitespace-nowrap text-[64px] font-black uppercase text-ink" style={{ color: identity.primaryColor }}>
              {watermark.text}
            </span>
          </div>
        ) : null}

        <div className="relative flex flex-col gap-[16px]">
          <header
            className={cn(
              "flex items-start justify-between gap-[14px] border-b-2 pb-[12px]",
              identity.logoPosition === "start" && "flex-row-reverse",
            )}
            style={{ borderColor: identity.primaryColor }}
          >
            <div className={cn("flex flex-col gap-[3px]", identity.logoPosition === "center" && "items-center text-center")}>
              <h1 className="font-display text-[19px] font-bold" style={{ color: identity.primaryColor }}>
                {document.company.name}
              </h1>
              {identity.subtitle ? <p className="text-[11px] text-ink-muted">{identity.subtitle}</p> : null}
              <div className="mt-[4px] flex flex-col gap-[1px] text-[10.5px] text-ink-muted">
                {header.showAddress && document.company.address ? <span>{document.company.address}</span> : null}
                {header.showPhone && document.company.phone ? <span>هاتف: {document.company.phone}</span> : null}
                {header.showEmail && document.company.email ? <span>{document.company.email}</span> : null}
                {header.showTaxNumber && document.company.taxNumber ? (
                  <span>
                    الرقم الضريبي: <span className="mz-num">{document.company.taxNumber}</span>
                  </span>
                ) : null}
                {header.showCommercialRegister && document.company.commercialRegister ? (
                  <span>
                    السجل التجاري: <span className="mz-num">{document.company.commercialRegister}</span>
                  </span>
                ) : null}
              </div>
            </div>

            {identity.logoUrl ? (
              <img
                src={identity.logoUrl}
                alt=""
                className={cn(
                  "object-contain",
                  identity.logoSize === "small" && "h-[36px]",
                  identity.logoSize === "medium" && "h-[52px]",
                  identity.logoSize === "large" && "h-[72px]",
                )}
              />
            ) : null}
          </header>

          <div className="flex flex-wrap items-start justify-between gap-[14px]">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">{document.documentTypeLabel}</h2>
              <div className="mt-[4px] flex flex-col gap-[2px] text-[11px] text-ink-muted">
                <span>
                  رقم المستند: <span className="mz-num font-semibold text-ink">{document.number}</span>
                </span>
                <span>
                  التاريخ: <span className="mz-num">{formatDate(document.date)}</span>
                </span>
                {document.dueDate ? (
                  <span>
                    تاريخ الاستحقاق: <span className="mz-num">{formatDate(document.dueDate)}</span>
                  </span>
                ) : null}
                {content.showBranchName && document.branchName ? <span>الفرع: {document.branchName}</span> : null}
                {content.showWarehouseName && document.warehouseName ? <span>المستودع: {document.warehouseName}</span> : null}
              </div>
            </div>
            {document.statusLabel ? (
              <span
                className="rounded-md border px-[10px] py-[4px] text-[11px] font-semibold"
                style={{ borderColor: identity.primaryColor, color: identity.primaryColor }}
              >
                {document.statusLabel}
              </span>
            ) : null}
          </div>

          {document.party ? (
            <div className="rounded-md border border-border p-[10px_12px]">
              <div className="text-[10.5px] font-semibold text-ink-faint">{document.party.roleLabel}</div>
              <div className="mt-[3px] text-[13px] font-bold text-ink">{document.party.name}</div>
              <div className="mt-[2px] flex flex-wrap gap-x-[14px] gap-y-[2px] text-[10.5px] text-ink-muted">
                {document.party.code ? (
                  <span>
                    الكود: <span className="mz-num">{document.party.code}</span>
                  </span>
                ) : null}
                {content.showPartyTaxNumber && document.party.taxNumber ? (
                  <span>
                    الرقم الضريبي: <span className="mz-num">{document.party.taxNumber}</span>
                  </span>
                ) : null}
                {document.party.address ? <span>{document.party.address}</span> : null}
                {document.party.phone ? <span className="mz-num">{document.party.phone}</span> : null}
              </div>
            </div>
          ) : null}

          {content.showPaymentTerms && document.paymentTerms ? (
            <p className="text-[11px] text-ink-muted">شروط الدفع: {document.paymentTerms}</p>
          ) : null}

          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y-2 text-start" style={{ borderColor: identity.primaryColor }}>
                {columns.showItemCode ? <th className="p-[6px_8px] text-start font-semibold">الكود</th> : null}
                {columns.showDescription ? <th className="p-[6px_8px] text-start font-semibold">الصنف</th> : null}
                {columns.showUnit ? <th className="p-[6px_8px] text-start font-semibold">الوحدة</th> : null}
                <th className="p-[6px_8px] text-end font-semibold">الكمية</th>
                <th className="p-[6px_8px] text-end font-semibold">السعر</th>
                {columns.showLineDiscount ? <th className="p-[6px_8px] text-end font-semibold">الخصم</th> : null}
                {columns.showLineTaxPercent ? <th className="p-[6px_8px] text-end font-semibold">الضريبة %</th> : null}
                {columns.showLineTaxAmount ? <th className="p-[6px_8px] text-end font-semibold">مبلغ الضريبة</th> : null}
                <th className="p-[6px_8px] text-end font-semibold">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {document.lines.map((line, i) => (
                <tr key={i} className="border-b border-border">
                  {columns.showItemCode ? <td className="mz-num p-[6px_8px]">{line.code ?? ""}</td> : null}
                  {columns.showDescription ? <td className="p-[6px_8px]">{line.description}</td> : null}
                  {columns.showUnit ? <td className="p-[6px_8px]">{line.unit ?? ""}</td> : null}
                  <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.qty)}</td>
                  <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.unitPrice, { minimumFractionDigits: 2 })}</td>
                  {columns.showLineDiscount ? (
                    <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.discount ?? 0, { minimumFractionDigits: 2 })}</td>
                  ) : null}
                  {columns.showLineTaxPercent ? (
                    <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.taxPercent ?? 0)}</td>
                  ) : null}
                  {columns.showLineTaxAmount ? (
                    <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.taxAmount ?? 0, { minimumFractionDigits: 2 })}</td>
                  ) : null}
                  <td className="mz-num p-[6px_8px] text-end font-semibold">{formatNumber(line.lineTotal, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="flex w-full max-w-[260px] flex-col gap-[4px] text-[11.5px]">
              {totalsConfig.showSubtotal ? (
                <div className="flex justify-between">
                  <span className="text-ink-muted">المجموع الفرعي</span>
                  <Money value={document.totals.subtotal} currencyLabel={currencyLabel} />
                </div>
              ) : null}
              {totalsConfig.showTotalDiscount && document.totals.totalDiscount ? (
                <div className="flex justify-between">
                  <span className="text-ink-muted">إجمالي الخصم</span>
                  <Money value={document.totals.totalDiscount} currencyLabel={currencyLabel} />
                </div>
              ) : null}
              {totalsConfig.showTaxBreakdown
                ? document.totals.taxBreakdown?.map((row) => (
                    <div key={row.label} className="flex justify-between">
                      <span className="text-ink-muted">
                        {row.label}
                        {row.rate !== undefined ? ` (${formatNumber(row.rate)}%)` : ""}
                      </span>
                      <Money value={row.amount} currencyLabel={currencyLabel} />
                    </div>
                  ))
                : null}
              <div className="flex justify-between border-t pt-[6px] text-[13.5px] font-bold" style={{ borderColor: identity.primaryColor }}>
                <span>الإجمالي</span>
                <Money value={document.totals.grandTotal} currencyLabel={currencyLabel} />
              </div>
            </div>
          </div>

          {totalsConfig.showAmountInWords && document.totals.amountInWords ? (
            <p className="rounded-md bg-surface-2 p-[8px_10px] text-[11px] font-semibold text-ink">
              {document.totals.amountInWords}
            </p>
          ) : null}

          {content.showNotes && document.notes ? <p className="text-[10.5px] text-ink-muted">ملاحظات: {document.notes}</p> : null}

          {footer.showSignatures && footer.signatureCount > 0 ? (
            <div className="mt-[10px] grid gap-[24px] pt-[18px]" style={{ gridTemplateColumns: `repeat(${footer.signatureCount}, 1fr)` }}>
              {signatureLabels.map((label, i) => (
                <div key={i} className="border-t border-border pt-[6px] text-center text-[10.5px] text-ink-muted">
                  {label}
                </div>
              ))}
            </div>
          ) : null}

          {footer.text ? <p className="mt-[6px] text-center text-[10px] text-ink-faint">{footer.text}</p> : null}
        </div>
      </div>
    </div>
  );
}
