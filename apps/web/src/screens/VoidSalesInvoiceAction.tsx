import { useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { SALES_INVOICE_ACTIVE_STATUSES } from "@mezan/domain";
import { useApi } from "../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { useVoidSalesInvoice, type SalesInvoiceDTO } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { TextAreaField } from "../settings/form-controls";

export function VoidSalesInvoiceAction({ invoice }: { invoice: SalesInvoiceDTO }) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const voidInvoice = useVoidSalesInvoice();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status) || !sessionMayRead(session, DocumentReadPermission.SalesInvoiceVoid)) return null;

  async function confirm() {
    if (voidInvoice.isPending) return;
    setError(null);
    try {
      await voidInvoice.mutateAsync({ id: invoice.id, reason: reason.trim() });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("voidInvoice.failed"));
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          setError(null);
          setReason("");
          setOpen(true);
        }}
      >
        {t("voidInvoice.action")}
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        title={t("voidInvoice.title", { number: invoice.docNo ?? invoice.id })}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("voidInvoice.consequence")}</p>
            {error ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {error}
              </div>
            ) : null}
            <TextAreaField label={t("voidInvoice.reason")} value={reason} onChange={setReason} rows={2} />
          </div>
        }
        confirmLabel={t("voidInvoice.confirm")}
        confirmDisabled={reason.trim() === "" || voidInvoice.isPending}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
