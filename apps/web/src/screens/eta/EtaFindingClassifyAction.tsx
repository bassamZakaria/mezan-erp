import { useState } from "react";
import { Button } from "@mezan/ui";
import { SALES_INVOICE_ACTIVE_STATUSES } from "@mezan/domain";
import { InvoiceDocumentKind } from "@mezan/contracts";
import { useApi } from "../../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../../data/document-read-permissions";
import { ClassifiableDocument, useSalesInvoice, useTaxRates } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { ClassifyLineTaxAction, type ClassifiableLine } from "../ClassifyLineTaxAction";

export interface EtaFindingClassifyActionProps {
  readonly documentNumber: string;
  readonly lineId: string | null;
}

export function EtaFindingClassifyAction({ documentNumber, lineId }: EtaFindingClassifyActionProps) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const [armed, setArmed] = useState(false);
  const permitted = lineId !== null && sessionMayRead(session, DocumentReadPermission.SalesInvoiceClassifyTax);
  const invoiceQuery = useSalesInvoice(armed && permitted ? documentNumber : null);
  const taxRatesQuery = useTaxRates();
  if (!permitted) return null;

  const invoice = armed ? invoiceQuery.data : undefined;
  const lines: ClassifiableLine[] = (invoice?.lines ?? []).map((line) => ({
    lineId: line.lineId,
    label: line.itemNameAr,
    taxRatePercent: line.taxRatePercent,
    taxRateId: line.taxRateId ?? null,
  }));
  const line = lines.find((candidate) => candidate.lineId === lineId);
  const loading = armed && (invoiceQuery.isLoading || taxRatesQuery.isLoading);
  // Every way the dialog can fail to open is said in words: a click that does
  // nothing leaves the accountant with a blocked e-invoice and no reason.
  const unavailable = !armed || loading
    ? null
    : invoiceQuery.isError
      ? invoiceQuery.error.message
      : taxRatesQuery.isError
        ? taxRatesQuery.error.message
        : !invoice || !line
          ? t("classifyTax.finding.lineGone")
          : line.taxRateId !== null
            ? t("classifyTax.finding.alreadyClassified")
            : !SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)
              ? t("classifyTax.finding.notPosted")
              : invoice.documentKind === InvoiceDocumentKind.RetentionRelease
                ? t("classifyTax.finding.notASupply")
                : null;

  return (
    <>
      <Button type="button" size="sm" onClick={() => setArmed(true)} disabled={loading}>
        {t("classifyTax.action")}
      </Button>
      {unavailable ? (
        <span role="alert" className="text-[12px] text-danger-ink">
          {unavailable}
        </span>
      ) : null}
      {armed && !loading && !unavailable && invoice && line && taxRatesQuery.data ? (
        <ClassifyLineTaxAction
          document={ClassifiableDocument.SalesInvoice}
          documentId={invoice.id}
          posted
          documentKind={invoice.documentKind}
          line={line}
          lines={lines}
          taxRates={taxRatesQuery.data}
          openedExternally
          onClosed={() => setArmed(false)}
        />
      ) : null}
    </>
  );
}
