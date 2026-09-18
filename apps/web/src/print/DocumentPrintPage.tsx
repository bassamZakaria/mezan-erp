import { EmptyState, PrintView, resolvePrintTemplateConfig, type PrintDocumentModel, type PrintTemplateConfig } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { usePrintTemplateConfig, useSettings } from "../data/hooks";

/**
 * The one routed print destination every document type reuses (P-6).
 *
 * `SalesInvoicePrintPage` proved the shape — load the tenant's template
 * config, resolve the per-document-type override, warn about the legal fields
 * the company record is missing, and hand `PrintView` a `PrintDocumentModel`.
 * Nine more document types needed the same page and were each one
 * `window.print()` away from producing something that is not a document, so
 * the shape moved here and the callers now supply only their model.
 */
export function DocumentPrintPage({ document }: { document: PrintDocumentModel }) {
  const { t } = useAppTranslation();
  const configQuery = usePrintTemplateConfig();
  const settings = useSettings().data ?? null;

  if (configQuery.isLoading) return null;
  if (!configQuery.data) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState title={t("salesInvoices.print.unavailableTitle")} description={t("salesInvoices.print.unavailableBody")} />
      </div>
    );
  }

  const config = resolvePrintTemplateConfig(configQuery.data as PrintTemplateConfig, document.documentType);

  // Checked before the page is printed rather than after it is refused. It
  // still prints — refusing to print a document the shop needs would be
  // worse — but it says what is missing and where to set it. `@media print`
  // keeps the notice off the paper.
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
          <strong className="font-semibold">{t("print.missing.title")}</strong>{" "}
          {t("salesInvoices.print.missing.body", { fields: missing.join("، ") })}
        </div>
      ) : null}
      <PrintView config={config} document={document} />
    </div>
  );
}
