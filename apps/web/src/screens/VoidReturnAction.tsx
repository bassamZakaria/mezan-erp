import { useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { ReturnFamily, useVoidReturn } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { TextAreaField } from "../settings/form-controls";

export { ReturnFamily };

export interface VoidableReturn {
  readonly id: string;
  readonly docNo: string | null;
  readonly status: string;
  readonly voidReason?: string | null;
}

const VOID_PERMISSION: Record<ReturnFamily, DocumentReadPermission> = {
  [ReturnFamily.Sales]: DocumentReadPermission.SalesReturnVoid,
  [ReturnFamily.Purchases]: DocumentReadPermission.PurchaseReturnVoid,
};

const VOIDABLE_STATUS = "confirmed";

export function useMayVoidReturn(family: ReturnFamily): (document: VoidableReturn) => boolean {
  const { session } = useApi();
  const permitted = sessionMayRead(session, VOID_PERMISSION[family]);
  return (document) => permitted && document.status === VOIDABLE_STATUS;
}

export function VoidReturnDialog({ family, document, onClose }: { family: ReturnFamily; document: VoidableReturn | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const voidReturn = useVoidReturn(family);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason("");
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!document || voidReturn.isPending) return;
    setError(null);
    try {
      await voidReturn.mutateAsync({ id: document.id, reason: reason.trim() });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("voidReturn.failed"));
    }
  }

  return (
    <ConfirmDialog
      open={document !== null}
      tone="danger"
      title={t("voidReturn.title", { number: document?.docNo ?? document?.id ?? "" })}
      consequence={
        <div className="flex flex-col gap-[10px]">
          <p>{t("voidReturn.consequence")}</p>
          {error ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}
          <TextAreaField label={t("voidReturn.reason")} value={reason} onChange={setReason} rows={2} />
        </div>
      }
      confirmLabel={t("salesReturns.void")}
      confirmDisabled={reason.trim() === "" || voidReturn.isPending}
      onConfirm={() => void confirm()}
      onCancel={close}
    />
  );
}

export function VoidReturnAction({ family, document }: { family: ReturnFamily; document: VoidableReturn }) {
  const { t } = useAppTranslation();
  const mayVoid = useMayVoidReturn(family);
  const [open, setOpen] = useState(false);
  if (!mayVoid(document)) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("salesReturns.void")}</Button>
      <VoidReturnDialog family={family} document={open ? document : null} onClose={() => setOpen(false)} />
    </>
  );
}

export function VoidReturnReasonNotice({ document }: { document: VoidableReturn }) {
  const { t } = useAppTranslation();
  if (!document.voidReason) return null;
  return (
    <p role="note" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
      {t("voidReturn.reasonShown", { reason: document.voidReason })}
    </p>
  );
}
