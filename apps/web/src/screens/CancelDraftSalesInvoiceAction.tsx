import { useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { useCancelDraftSalesInvoice, type SalesInvoiceDTO } from "../data/hooks";
import { useAppTranslation } from "../i18n";

export function CancelDraftSalesInvoiceAction({ invoice }: { invoice: SalesInvoiceDTO }) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const cancelDraft = useCancelDraftSalesInvoice();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (invoice.status !== "draft" || !sessionMayRead(session, DocumentReadPermission.SalesInvoiceDeleteDraft)) return null;

  async function confirm() {
    if (cancelDraft.isPending) return;
    setError(null);
    try {
      await cancelDraft.mutateAsync({ id: invoice.id, ...(invoice.version === undefined ? {} : { expectedVersion: invoice.version }) });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cancelDraft.failed"));
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t("cancelDraft.action")}
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        title={t("cancelDraft.title", { number: invoice.docNo ?? invoice.id })}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("cancelDraft.consequence")}</p>
            {error ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {error}
              </div>
            ) : null}
          </div>
        }
        confirmLabel={t("cancelDraft.confirm")}
        confirmDisabled={cancelDraft.isPending}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
