import type { CreateVoucherDTO } from "@mezan/contracts";
import { CollectPaymentMethod } from "./enums";

export enum CollectPath {
  ConfirmNow = "confirm_now",
  DraftForApproval = "draft_for_approval",
  ConfirmOnly = "confirm_only",
  NotAllowed = "not_allowed",
}

export enum CollectPermission {
  Create = "treasury.cash_voucher.create",
  Confirm = "treasury.cash_voucher.confirm",
  Allocate = "treasury.allocation.manage",
}

const CUSTOMER_COLLECTION = "customer_collection";

/**
 * Mirrors the server's own split (vouchers-routes.ts): the one-call collection
 * writes, confirms and allocates, so it needs all three rights. A session that
 * may write but not all of that saves a draft someone else confirms.
 */
export function collectPathFor(can: (permission: string) => boolean): CollectPath {
  const mayCreate = can(CollectPermission.Create);
  const mayConfirm = can(CollectPermission.Confirm);
  if (mayCreate && mayConfirm && can(CollectPermission.Allocate)) return CollectPath.ConfirmNow;
  if (mayCreate) return CollectPath.DraftForApproval;
  if (mayConfirm) return CollectPath.ConfirmOnly;
  return CollectPath.NotAllowed;
}

export interface DraftCollectionInput {
  readonly date: string;
  readonly customerId: string;
  readonly branchId: string;
  readonly treasuryAccountId: string;
  readonly amount: string;
  readonly referenceNo: string;
  readonly invoiceNo: string;
  readonly memoPrefix: string;
}

export function draftCollectionBody(input: DraftCollectionInput): CreateVoucherDTO {
  const referenceNo = input.referenceNo.trim();
  return {
    date: input.date,
    voucherType: CUSTOMER_COLLECTION,
    amount: input.amount,
    branchId: input.branchId,
    paymentMethod: CollectPaymentMethod.Cash,
    treasuryAccountId: input.treasuryAccountId,
    customerId: input.customerId,
    referenceNo: referenceNo === "" ? null : referenceNo,
    memo: `${input.memoPrefix} ${input.invoiceNo}`,
  };
}
