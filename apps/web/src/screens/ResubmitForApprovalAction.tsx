import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, type RowMenuItem } from "@mezan/ui";
import { DocumentApprovalStatus, type DocumentApprovalDTO } from "@mezan/contracts";
import { DocumentStatusCode } from "@mezan/domain";
import { useApi } from "../data/ApiContext";
import { ApiError, readError } from "../data/hooks";
import { sessionHolds } from "../data/session";
import { useAppTranslation } from "../i18n";
import { errorMessage } from "../lib/error-message";

export enum ResubmitFamily {
  SalesReturns = "sales-returns",
  PurchaseReturns = "purchase-returns",
  LandedCosts = "landed-costs",
  StockAdjustments = "inventory/stock-adjustments",
  StockTransfers = "inventory/stock-transfers",
  Vouchers = "vouchers",
}

export interface ResubmittableDocument {
  readonly id: string;
  readonly docNo: string | null;
  readonly status: string;
  readonly approval?: DocumentApprovalDTO | null;
}

export interface ResubmitController {
  readonly pendingId: string | null;
  readonly error: string | null;
  readonly label: string;
  mayResubmit(document: ResubmittableDocument): boolean;
  resubmit(id: string): Promise<void>;
}

// SECURITY: these only decide whether the action is worth offering — the
// server's confirm gate for the family decides whether it is allowed.
const CONFIRM_PERMISSIONS: Record<ResubmitFamily, readonly string[]> = {
  [ResubmitFamily.SalesReturns]: ["sales.return.confirm"],
  [ResubmitFamily.PurchaseReturns]: ["purchases.return.confirm"],
  [ResubmitFamily.LandedCosts]: ["purchases.landed_cost.confirm"],
  [ResubmitFamily.StockAdjustments]: ["inventory.adjustment.confirm"],
  [ResubmitFamily.StockTransfers]: ["inventory.transfer.confirm"],
  [ResubmitFamily.Vouchers]: [
    "treasury.cash_voucher.confirm",
    "treasury.customer_refund.confirm",
    "treasury.transfer.confirm",
    "contracting.certificate.collect",
  ],
};

const QUERY_ROOT: Record<ResubmitFamily, string> = {
  [ResubmitFamily.SalesReturns]: "sales-returns",
  [ResubmitFamily.PurchaseReturns]: "purchase-returns",
  [ResubmitFamily.LandedCosts]: "landed-costs",
  [ResubmitFamily.StockAdjustments]: "stock-adjustments",
  [ResubmitFamily.StockTransfers]: "stock-transfers",
  [ResubmitFamily.Vouchers]: "vouchers",
};

const RESUBMITTABLE_STATUS = DocumentStatusCode.Draft;

export function useResubmitForApproval(family: ResubmitFamily): ResubmitController {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const permitted = CONFIRM_PERMISSIONS[family].some((permission) => sessionHolds(session, permission));

  const mutation = useMutation<unknown, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/${family}/${encodeURIComponent(id)}/resubmit`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("resubmit.failed"), t));
      return res.json();
    },
    onSuccess: () => {
      for (const key of [QUERY_ROOT[family], "workflow-requests", "audit"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (err) => setError(errorMessage(err, t("resubmit.failed"))),
    onSettled: () => setPendingId(null),
  });

  return {
    pendingId,
    error,
    label: t("resubmit.action"),
    mayResubmit: (document) =>
      permitted && document.status === RESUBMITTABLE_STATUS && document.approval?.status === DocumentApprovalStatus.Rejected,
    resubmit: async (id) => {
      if (pendingId !== null) return;
      setError(null);
      setPendingId(id);
      await mutation.mutateAsync(id).catch(() => undefined);
    },
  };
}

export function resubmitRowMenuItems(controller: ResubmitController, document: ResubmittableDocument): RowMenuItem[] {
  if (!controller.mayResubmit(document)) return [];
  return [
    {
      key: "resubmit",
      label: controller.label,
      disabled: controller.pendingId === document.id,
      onSelect: () => controller.resubmit(document.id),
    },
  ];
}

export function ResubmitErrorNotice({ controller }: { controller: ResubmitController }) {
  if (!controller.error) return null;
  return (
    <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
      {controller.error}
    </div>
  );
}

export function ApprovalRejectionNotice({ document }: { document: ResubmittableDocument }) {
  const { t } = useAppTranslation();
  if (document.approval?.status !== DocumentApprovalStatus.Rejected) return null;
  return (
    <p role="note" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
      {document.approval.rejectionReason
        ? t("resubmit.rejectedBecause", { reason: document.approval.rejectionReason })
        : t("resubmit.rejected")}
    </p>
  );
}

export function ResubmitForApprovalAction({ family, document }: { family: ResubmitFamily; document: ResubmittableDocument }) {
  const controller = useResubmitForApproval(family);
  return (
    <div className="flex flex-col items-start gap-[10px]">
      <ApprovalRejectionNotice document={document} />
      {controller.mayResubmit(document) ? (
        <>
          <ResubmitErrorNotice controller={controller} />
          <Button variant="primary" disabled={controller.pendingId === document.id} onClick={() => void controller.resubmit(document.id)}>
            {controller.label}
          </Button>
        </>
      ) : null}
    </div>
  );
}
