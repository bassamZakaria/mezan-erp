import type { AttachmentEntityType } from "./attachment.js";

/**
 * An attachment carries no permission of its own: it inherits the permissions
 * of whatever it is attached to, so a user who may not see a supplier may not
 * see that supplier's files either.
 *
 * `viewAny` lists every tier that should be able to READ the entity — the
 * catalog grants visibility in tiers (`.confirm` implies `.view_own`), and
 * gating on `.view` alone locks out a user whose grant is a different tier of
 * the same permission (D31).
 */
export interface AttachmentEntityPermissions {
  readonly viewAny: readonly string[];
  /** Upload and delete — the entity's own write permission. */
  readonly manage: string;
}

export const ATTACHMENT_ENTITY_PERMISSIONS: Record<AttachmentEntityType, AttachmentEntityPermissions> = {
  item: { viewAny: ["inventory.item.view"], manage: "inventory.item.edit" },
  customer: { viewAny: ["sales.customer.view"], manage: "sales.customer.edit" },
  supplier: { viewAny: ["purchases.supplier.view"], manage: "purchases.supplier.edit" },
  employee: { viewAny: ["hr.employee.view"], manage: "hr.employee.edit" },
  "sales-invoice": {
    viewAny: ["sales.invoice.view", "sales.invoice.view_own", "sales.invoice.view_all"],
    manage: "sales.invoice.edit",
  },
  "sales-quote": {
    viewAny: ["sales.quote.view", "sales.quote.view_own"],
    manage: "sales.quote.edit",
  },
  "sales-return": {
    viewAny: ["sales.return.view", "sales.return.view_own"],
    manage: "sales.return.create",
  },
  "purchase-invoice": {
    viewAny: ["purchases.invoice.view", "purchases.invoice.view_own", "purchases.invoice.view_all"],
    manage: "purchases.invoice.edit",
  },
  "purchase-order": { viewAny: ["purchases.order.view"], manage: "purchases.order.edit" },
  "goods-receipt": { viewAny: ["purchases.receipt.view"], manage: "purchases.receipt.create" },
  "stock-adjustment": { viewAny: ["inventory.adjustment.view"], manage: "inventory.adjustment.create" },
  "stock-transfer": { viewAny: ["inventory.transfer.view"], manage: "inventory.transfer.create" },
  "work-order": { viewAny: ["manufacturing.wo.view"], manage: "manufacturing.wo.create" },
  voucher: { viewAny: ["treasury.cash_voucher.view"], manage: "treasury.cash_voucher.create" },
  attendance: { viewAny: ["hr.attendance.view"], manage: "hr.attendance.edit" },
};
