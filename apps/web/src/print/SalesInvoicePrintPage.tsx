import { useMemo } from "react";
import { EmptyState, PrintView, resolvePrintTemplateConfig, useFormat, type PrintTemplateConfig } from "@mezan/ui";
import type { SalesInvoiceDTO } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { useDisplaySettings, usePrintTemplateConfig, useSalesInvoicePrintContext, useTaxRates } from "../data/hooks";
import { salesInvoicePrintModel } from "./sales-invoice-print";
import { EMPTY } from "../lib/empty";
import { useBatchTrail } from "../data/expiry-hooks";

/**
 * The compliant print path for a sales invoice — the page the «طباعة» button
 * opens, rather than `window.print()` over whatever happened to be on screen.
 *
 * It is a ROUTED sub-page, not an overlay: printing is a destination a person
 * arrives at, may reload into, and leaves with the shell's own «رجوع». The
 * toolbar it renders is `PrintView`'s, which is excluded from the printed
 * output by `@media print`, so the same DOM serves the browser's print dialog
 * and the desktop build's `printToPDF`.
 */
export function SalesInvoicePrintPage({ invoice }: { invoice: SalesInvoiceDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const configQuery = usePrintTemplateConfig();
  const settings = useDisplaySettings().data ?? null;
  const taxRates = useTaxRates().data ?? EMPTY;
  // SECURITY: one read under the invoice's own visibility rule. The page used
  // to list every customer, branch, warehouse and the e-invoice queue to find
  // five values, which a role that may only view invoices is refused.
  const context = useSalesInvoicePrintContext(invoice.id).data ?? null;
  const batchTrail = useBatchTrail(invoice.status === "draft" ? null : invoice.id).data;

  const document = useMemo(
    () =>
      salesInvoicePrintModel({
        invoice,
        settings,
        branchName: context?.branchName ?? undefined,
        warehouseName: context?.warehouseName ?? undefined,
        repLabels: {
          salesperson: t("salesInvoices.field.salesperson"),
          salesManager: t("salesInvoices.field.salesManager"),
          promotionRep: t("salesInvoices.field.promotionRep"),
          promotionManager: t("salesInvoices.field.promotionManager"),
        },
        customerCode: context?.customer?.code,
        customerTaxNumber: context?.customer?.taxNumber ?? undefined,
        customerAddress: context?.customer?.address ?? undefined,
        customerPhone: context?.customer?.phone ?? undefined,
        etaUuid: context?.etaUuid ?? null,
        etaQrValue: context?.etaQrValue ?? null,
        currencyLabel: format.currencyLabel,
        documentTypeLabel: t("salesInvoices.print.documentType"),
        customerRoleLabel: t("common.customer"),
        vatLabel: t("salesInvoices.print.vat"),
        taxRates,
        batchTrail,
      }),
    [invoice, settings, context, taxRates, batchTrail, format.currencyLabel, t],
  );

  if (configQuery.isLoading) return null;
  if (!configQuery.data) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState title={t("salesInvoices.print.unavailableTitle")} description={t("salesInvoices.print.unavailableBody")} />
      </div>
    );
  }

  const config = resolvePrintTemplateConfig(configQuery.data as PrintTemplateConfig, "SALES_INVOICE");

  // What an Egyptian tax invoice must carry, checked before it is printed
  // rather than after it is refused. The page still prints — refusing to
  // print a document the shop needs would be worse — but it says what is
  // missing and where to set it, instead of producing a compliant-looking
  // page that is not one. `@media print` keeps the notice off the paper.
  const missing = [
    settings?.taxRegistrationNumber ? null : t("salesInvoices.print.missing.taxNumber"),
    settings?.companyName ? null : t("salesInvoices.print.missing.companyName"),
    settings?.address ? null : t("salesInvoices.print.missing.address"),
  ].filter((entry): entry is string => entry !== null);

  return (
    <div className="w-full">
      {missing.length > 0 ? (
        <div
          role="alert"
          className="mb-[14px] rounded-md border border-warning bg-warning-soft p-[10px_12px] text-[12.5px] text-warning-ink print:hidden"
        >
          <strong className="font-semibold">{t("salesInvoices.print.missing.title")}</strong>{" "}
          {t("salesInvoices.print.missing.body", { fields: missing.join("، ") })}
        </div>
      ) : null}
      <PrintView config={config} document={document} />
    </div>
  );
}
