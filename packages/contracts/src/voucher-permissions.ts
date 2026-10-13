import { ReversalPermission } from "./document-reversal.js";

export enum VoucherPermissionAction {
  Create = "create",
  Confirm = "confirm",
  Void = "void",
}

const VOUCHER_PERMISSION_PREFIX = "treasury.cash_voucher";

// INVARIANT: the gate on a typed voucher is EITHER the general code OR the type's own — a holder of only `treasury.customer_refund.create` raises refunds and nothing else, and a cashier with `treasury.cash_voucher.create` keeps every type. The routes and the screens both read this map; a type added to one side only is a button that answers 403.
const VOUCHER_TYPE_PERMISSION_PREFIX: Readonly<Record<string, string>> = {
  customer_refund: "treasury.customer_refund",
  inter_treasury_transfer: "treasury.transfer",
};

export function voucherActionPermissions(action: VoucherPermissionAction, voucherType: string | null | undefined): string[] {
  const own = voucherType ? VOUCHER_TYPE_PERMISSION_PREFIX[voucherType] : undefined;
  return [`${VOUCHER_PERMISSION_PREFIX}.${action}`, ...(own ? [`${own}.${action}`] : [])];
}

export function mayReverseVoucher(holds: (permission: string) => boolean, voucherType: string | null | undefined): boolean {
  return holds(ReversalPermission.Voucher) && voucherActionPermissions(VoucherPermissionAction.Void, voucherType).some(holds);
}
