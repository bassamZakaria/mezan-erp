import type { ConfirmSalesInvoiceDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";
import { useAppTranslation } from "../i18n";

export function twoDecimals(amount: string): string {
  const point = amount.indexOf(".");
  return point === -1 ? `${amount}.00` : amount.slice(0, point + 3).padEnd(point + 3, "0");
}

export function confirmAcknowledgementOf(invoice: SalesInvoiceDTO): Pick<ConfirmSalesInvoiceDTO, "acknowledgeTaxRecalculation"> {
  return invoice.confirmPreview ? { acknowledgeTaxRecalculation: true } : {};
}

export function ConfirmRecalculationNotice({ invoice }: { invoice: SalesInvoiceDTO }) {
  const { t } = useAppTranslation();
  const preview = invoice.confirmPreview;
  if (!preview) return null;
  return (
    <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
      <p className="font-semibold">{preview.message}</p>
      <p>
        {t("confirmPreview.totals", {
          recalculated: twoDecimals(preview.totals.grandTotal),
          shown: twoDecimals(invoice.totals.grandTotal),
        })}
      </p>
    </div>
  );
}
