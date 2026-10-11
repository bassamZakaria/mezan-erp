import { useState } from "react";
import { Button } from "@mezan/ui";
import { SALES_INVOICE_ACTIVE_STATUSES } from "@mezan/domain";
import { ClassifiableDocument, useSalesInvoice, useTaxRates } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { ClassifyLineTaxAction, type ClassifiableLine } from "../ClassifyLineTaxAction";

export interface EtaFindingClassifyActionProps {
  readonly documentNumber: string;
  readonly lineId: string;
}

export function EtaFindingClassifyAction({ documentNumber, lineId }: EtaFindingClassifyActionProps) {
  const { t } = useAppTranslation();
  const [armed, setArmed] = useState(false);
  const invoiceQuery = useSalesInvoice(armed ? documentNumber : null);
  const taxRatesQuery = useTaxRates();

  const invoice = armed ? invoiceQuery.data : undefined;
  const lines: ClassifiableLine[] = (invoice?.lines ?? []).map((line) => ({
    lineId: line.lineId,
    label: line.itemNameAr,
    taxRatePercent: line.taxRatePercent,
    taxRateId: line.taxRateId ?? null,
  }));
  const line = lines.find((candidate) => candidate.lineId === lineId);

  return (
    <>
      <Button type="button" size="sm" onClick={() => setArmed(true)} disabled={armed && invoiceQuery.isLoading}>
        {t("classifyTax.action")}
      </Button>
      {armed && invoiceQuery.isError ? (
        <span role="alert" className="text-[12px] text-danger-ink">
          {invoiceQuery.error.message}
        </span>
      ) : null}
      {invoice && line && taxRatesQuery.data ? (
        <ClassifyLineTaxAction
          document={ClassifiableDocument.SalesInvoice}
          documentId={invoice.id}
          posted={SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)}
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
