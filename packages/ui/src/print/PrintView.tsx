import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/cn";
import { formatDate, formatNumber } from "../lib/format";
import { Money } from "../primitives/atoms";
import { PrintToolbar } from "./PrintToolbar";
import { QrCode } from "./QrCode";
import { resolvePrintTemplateConfig, type PrintDocumentModel, type PrintTemplateConfig } from "./types";

/**
 * The single renderer every printable document (A4/A5 invoice, quote, PO,
 * GRN, voucher, ...) reuses: it consumes a `PrintTemplateConfig` (the 9-tab
 * designer, as data) and a generic `PrintDocumentModel`, and renders the
 * page with a `@media print` stylesheet (docs/archive/plan.md §2.4). Same DOM for
 * both output paths — browser calls `window.print()`, desktop calls
 * `webContents.printToPDF` through `useElectronPrintToPdf` — so there is
 * nothing platform-specific inside the render tree itself.
 */

export interface PrintViewProps {
  config: PrintTemplateConfig;
  document: PrintDocumentModel;
  /** Hides the on-screen "طباعة" / "حفظ PDF" toolbar (it's always excluded from the printed output via `@media print`). */
  showToolbar?: boolean;
  /**
   * Paper orientation. Landscape is what a مستخلص needs — nine columns per BOQ
   * line do not fit across 210mm — and it drives BOTH output paths: the `@page`
   * rule the browser prints from, and the Electron `printToPDF` flag.
   */
  orientation?: "portrait" | "landscape";
  className?: string;
}

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

function scriptLang(text: string): string | undefined {
  return ARABIC_SCRIPT.test(text) ? "ar" : undefined;
}

const PAGE_WIDTH_MM: Record<"A4" | "A5", number> = { A4: 210, A5: 148 };
const PAGE_HEIGHT_MM: Record<"A4" | "A5", number> = { A4: 297, A5: 210 };
const CSS_PX_PER_MM = 96 / 25.4;
const SCREEN_SCALE_VARIABLE = "--mz-print-screen-scale";

// INVARIANT: the page keeps its paper width in millimetres — that is what the
// printer and `printToPDF` lay out. Only the ON-SCREEN preview is scaled to the
// space it has, under `@media screen`, so a phone sees the whole page and the
// printed output is byte for byte what it was.
function useScreenFitScale(pageWidthMm: number) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fit = () => {
      const available = root.clientWidth;
      setScale(available > 0 ? Math.min(1, available / (pageWidthMm * CSS_PX_PER_MM)) : 1);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, [pageWidthMm]);
  return { rootRef, scale };
}

// EXTERNAL CONTRACT: a printed QR is sized in millimetres on the element itself — a class can lose to another class of the same weight, and a symbol that fills the sheet pushes itself onto a second page.
const QR_SIDE_MM = 26;

export function PrintView({ config, document, showToolbar = true, orientation = "portrait", className }: PrintViewProps) {
  const { t } = useTranslation();
  const effective = useMemo(
    () => resolvePrintTemplateConfig(config, document.documentType),
    [config, document.documentType],
  );

  const { identity, header, content, columns, totals: totalsConfig, footer, watermark } = effective;
  const currencyLabel = document.totals.currencyLabel ?? t("ui.currency");
  const landscape = orientation === "landscape";
  const pageWidthMm = landscape ? PAGE_HEIGHT_MM[effective.pageSize] : PAGE_WIDTH_MM[effective.pageSize];
  const pageHeightMm = landscape ? PAGE_WIDTH_MM[effective.pageSize] : PAGE_HEIGHT_MM[effective.pageSize];
  const signatureLabels = footer.signatureLabels.slice(0, footer.signatureCount);
  while (signatureLabels.length < footer.signatureCount) signatureLabels.push("");
  const { rootRef, scale } = useScreenFitScale(pageWidthMm);

  return (
    <div ref={rootRef} className={cn("mz-print-root", className)} style={{ [SCREEN_SCALE_VARIABLE]: scale } as CSSProperties}>
      <style>{`@page { size: ${effective.pageSize}${landscape ? " landscape" : ""}; margin: 14mm 12mm; } @media screen { .mz-print-page { zoom: var(${SCREEN_SCALE_VARIABLE}, 1); } }`}</style>

      {showToolbar ? <PrintToolbar pageSize={effective.pageSize} landscape={landscape} defaultFileName={document.number} /> : null}

      <div
        dir="rtl"
        className="mz-print-page relative mx-auto overflow-hidden bg-surface p-[16mm_14mm] text-[12.5px] text-ink print:m-0"
        style={{ width: `${pageWidthMm}mm`, minHeight: `${pageHeightMm}mm`, borderColor: identity.primaryColor }}
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
              <div className="font-display text-[19px] font-bold" style={{ color: identity.primaryColor }}>
                {document.company.name}
              </div>
              {identity.subtitle ? <p className="text-[11px] text-ink-muted">{identity.subtitle}</p> : null}
              <div className="mt-[4px] flex flex-col gap-[1px] text-[10.5px] text-ink-muted">
                {header.showAddress && document.company.address ? <span>{document.company.address}</span> : null}
                {header.showPhone && document.company.phone ? <span>{t("print.company.phone", { value: document.company.phone })}</span> : null}
                {header.showEmail && document.company.email ? <span>{document.company.email}</span> : null}
                {header.showTaxNumber && document.company.taxNumber ? (
                  <span>
                    {t("print.company.taxNumber")} <span className="mz-num">{document.company.taxNumber}</span>
                  </span>
                ) : null}
                {header.showCommercialRegister && document.company.commercialRegister ? (
                  <span>
                    {t("print.company.commercialRegister")} <span className="mz-num">{document.company.commercialRegister}</span>
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
                  {t("print.doc.number")} <span className="mz-num font-semibold text-ink">{document.number}</span>
                </span>
                <span>
                  {t("print.doc.date")} <span className="mz-num">{formatDate(document.date)}</span>
                </span>
                {document.dueDate ? (
                  <span>
                    {t("print.doc.dueDate")} <span className="mz-num">{formatDate(document.dueDate)}</span>
                  </span>
                ) : null}
                {content.showBranchName && document.branchName ? <span>{t("print.doc.branch", { value: document.branchName })}</span> : null}
                {content.showWarehouseName && document.warehouseName ? <span>{t("print.doc.warehouse", { value: document.warehouseName })}</span> : null}
                {document.headerFacts?.map((fact) => (
                  <span key={fact.key}>
                    {fact.label}: {fact.value}
                  </span>
                ))}
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
                    {t("print.party.code")} <span className="mz-num">{document.party.code}</span>
                  </span>
                ) : null}
                {content.showPartyTaxNumber && document.party.taxNumber ? (
                  <span>
                    {t("print.party.taxNumber")} <span className="mz-num">{document.party.taxNumber}</span>
                  </span>
                ) : null}
                {document.party.address ? <span>{document.party.address}</span> : null}
                {document.party.phone ? <span className="mz-num">{document.party.phone}</span> : null}
              </div>
            </div>
          ) : null}

          {content.showPaymentTerms && document.paymentTerms ? (
            <p className="text-[11px] text-ink-muted">{t("print.paymentTerms", { value: document.paymentTerms })}</p>
          ) : null}

          {document.ledger ? (
            <>
              {document.ledger.periodLabel ? (
                <p className="text-[11px] font-semibold text-ink-muted">{document.ledger.periodLabel}</p>
              ) : null}
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-y-2 text-start" style={{ borderColor: identity.primaryColor }}>
                    {document.ledger.columns.map((col) => (
                      <th key={col.key} className={cn("p-[6px_8px] font-semibold", col.align === "end" ? "text-end" : "text-start")}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {document.ledger.rows.map((row) => (
                    <tr key={row.key} className="border-b border-border">
                      {document.ledger!.columns.map((col) => {
                        const value = row.cells[col.key];
                        return (
                          <td
                            key={col.key}
                            className={cn("p-[6px_8px]", col.align === "end" && "text-end", (col.money || col.align === "end") && "mz-num")}
                          >
                            {value === null || value === undefined
                              ? ""
                              : col.money && typeof value === "number"
                                ? formatNumber(value, { minimumFractionDigits: 2 })
                                : String(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="flex w-full max-w-[280px] flex-col gap-[4px] text-[11.5px]">
                  {document.ledger.footer.map((row) => (
                    <div
                      key={row.label}
                      className={cn("flex justify-between", row.emphasis && "border-t pt-[6px] text-[13.5px] font-bold")}
                      style={row.emphasis ? { borderColor: identity.primaryColor } : undefined}
                    >
                      <span className={row.emphasis ? undefined : "text-ink-muted"}>{row.label}</span>
                      <Money value={row.value} currencyLabel={currencyLabel} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y-2 text-start" style={{ borderColor: identity.primaryColor }}>
                {columns.showItemCode ? <th className="p-[6px_8px] text-start font-semibold">{t("print.col.code")}</th> : null}
                {columns.showDescription ? <th className="p-[6px_8px] text-start font-semibold">{t("print.col.item")}</th> : null}
                {columns.showUnit ? <th className="p-[6px_8px] text-start font-semibold">{t("print.col.unit")}</th> : null}
                <th className="p-[6px_8px] text-end font-semibold">{t("print.col.qty")}</th>
                <th className="p-[6px_8px] text-end font-semibold">{t("print.col.price")}</th>
                {columns.showLineDiscount ? <th className="p-[6px_8px] text-end font-semibold">{t("print.col.discount")}</th> : null}
                {columns.showLineTaxPercent ? <th className="p-[6px_8px] text-end font-semibold">{t("print.col.taxPercent")}</th> : null}
                {columns.showLineTaxAmount ? <th className="p-[6px_8px] text-end font-semibold">{t("print.col.taxAmount")}</th> : null}
                <th className="p-[6px_8px] text-end font-semibold">{t("print.col.total")}</th>
              </tr>
            </thead>
            <tbody>
              {document.lines.map((line, i) => (
                <tr key={i} className="border-b border-border">
                  {columns.showItemCode ? <td className="mz-num p-[6px_8px]">{line.code ?? ""}</td> : null}
                  {columns.showDescription ? (
                    <td className="p-[6px_8px]">
                      {line.description}
                      {columns.showBatchExpiry !== false && line.lots && line.lots.length > 0 ? (
                        <span data-print-lots className="mt-[2px] block text-[9.5px] text-ink-muted">
                          {line.lots
                            .map((lot) =>
                              [
                                lot.batchNo ? `${t("print.lot.batch")} ${lot.batchNo}` : null,
                                lot.expiryDate ? `${t("print.lot.expiry")} ${formatDate(lot.expiryDate)}` : null,
                                line.lots && line.lots.length > 1 ? `× ${formatNumber(lot.qty)}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · "),
                            )
                            .join(" ، ")}
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                  {columns.showUnit ? <td className="p-[6px_8px]">{line.unit ?? ""}</td> : null}
                  <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.qty)}</td>
                  <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.unitPrice, { minimumFractionDigits: 2 })}</td>
                  {columns.showLineDiscount ? (
                    <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.discount ?? 0, { minimumFractionDigits: 2 })}</td>
                  ) : null}
                  {columns.showLineTaxPercent ? (
                    <td className="p-[6px_8px] text-end">
                      {line.taxName ? <span data-print-tax-name className="me-[6px]">{line.taxName}</span> : null}
                      <span className="mz-num">{formatNumber(line.taxPercent ?? 0)}</span>
                    </td>
                  ) : null}
                  {columns.showLineTaxAmount ? (
                    <td className="mz-num p-[6px_8px] text-end">{formatNumber(line.taxAmount ?? 0, { minimumFractionDigits: 2 })}</td>
                  ) : null}
                  <td className="mz-num p-[6px_8px] text-end font-semibold">{formatNumber(line.lineTotal, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mz-print-keep flex justify-end">
            <div className="flex w-full max-w-[260px] flex-col gap-[4px] text-[11.5px]">
              {totalsConfig.showSubtotal ? (
                <div className="flex justify-between">
                  <span className="text-ink-muted">{t("print.totals.subtotal")}</span>
                  <Money value={document.totals.subtotal} currencyLabel={currencyLabel} />
                </div>
              ) : null}
              {totalsConfig.showTotalDiscount && document.totals.totalDiscount ? (
                <div className="flex justify-between">
                  <span className="text-ink-muted">{t("print.totals.totalDiscount")}</span>
                  <Money value={document.totals.totalDiscount} currencyLabel={currencyLabel} />
                </div>
              ) : null}
              {totalsConfig.showTaxBreakdown
                ? document.totals.taxBreakdown?.map((row, index) => (
                    <div key={row.key ?? `${index}|${row.label}|${row.rate ?? ""}`} className="flex justify-between">
                      <span className="text-ink-muted">
                        {row.label}
                        {row.rate !== undefined ? ` (${formatNumber(row.rate)}%)` : ""}
                      </span>
                      <Money value={row.amount} currencyLabel={currencyLabel} />
                    </div>
                  ))
                : null}
              <div className="flex justify-between border-t pt-[6px] text-[13.5px] font-bold" style={{ borderColor: identity.primaryColor }}>
                <span>{t("print.totals.grandTotal")}</span>
                <Money value={document.totals.grandTotal} currencyLabel={currencyLabel} />
              </div>
            </div>
          </div>
            </>
          )}

          {totalsConfig.showAmountInWords && document.totals.amountInWords ? (
            <p lang={scriptLang(document.totals.amountInWords)} className="rounded-md bg-surface-2 p-[8px_10px] text-[11px] font-semibold text-ink">
              {document.totals.amountInWords}
            </p>
          ) : null}

          {content.showNotes && document.notes ? <p className="text-[10.5px] text-ink-muted">{t("print.notes", { value: document.notes })}</p> : null}

          {footer.showSignatures && footer.signatureCount > 0 ? (
            <div className="mt-[10px] grid gap-[24px] pt-[18px]" style={{ gridTemplateColumns: `repeat(${footer.signatureCount}, 1fr)` }}>
              {signatureLabels.map((label, i) => (
                <div key={i} lang={scriptLang(label)} className="border-t border-border pt-[6px] text-center text-[10.5px] text-ink-muted">
                  {label}
                </div>
              ))}
            </div>
          ) : null}

          {document.complianceNotice ? (
            <p
              className="mt-[8px] rounded-md border border-warning bg-warning-soft p-[6px_10px] text-center text-[10.5px] font-semibold text-warning-ink"
              style={{ borderColor: identity.primaryColor }}
            >
              {document.complianceNotice}
            </p>
          ) : null}

          {document.etaUuid || document.etaQrValue ? (
            <div className="mz-print-keep mt-[8px] flex flex-col items-center gap-[6px] border-t border-border pt-[6px]">
              {document.etaQrValue ? (
                <QrCode value={document.etaQrValue} label={t("print.etaUuid")} className="flex-none" style={{ width: `${QR_SIDE_MM}mm`, height: `${QR_SIDE_MM}mm` }} />
              ) : (
                /*
                 * A UUID with no QR payload yet. A STATED empty box, never an
                 * invented code: the scannable thing encodes a submission the
                 * authority has actually cleared, and drawing a plausible
                 * square from the UUID alone would print something a customer
                 * could scan and a tax inspector could not verify (P-1).
                 */
                <div className="flex h-[26mm] w-[26mm] flex-none items-center justify-center rounded-sm border border-dashed border-border p-[4px] text-center text-[7.5px] leading-[1.15] text-ink-faint">
                  {t("print.etaQrPlaceholder")}
                </div>
              )}
              {document.etaUuid ? (
                <p className="text-center text-[10px] text-ink-muted">
                  <span>{t("print.etaUuid")}</span>{" "}
                  <span className="mz-num" dir="ltr">
                    {document.etaUuid}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}

          {footer.text ? <p className="mt-[6px] text-center text-[10px] text-ink-faint">{footer.text}</p> : null}
        </div>
      </div>
    </div>
  );
}
