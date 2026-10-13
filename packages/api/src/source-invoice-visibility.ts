import { can, type AuthContext } from "@mezan/domain";

// INVARIANT: the ONE rule for whether a caller raising a return may read the
// invoice it is raised against — the same rule the invoice's own GET applies.
// Every return route reads its source invoice through a lookup that asks this
// first, so a hidden invoice is indistinguishable from a missing one on all of
// them: no route can leak its lines, prices or what is left to return.
export function salesSourceInvoiceHidden(
  ctx: AuthContext | null | undefined,
  invoice: { readonly salespersonId?: string | null },
  ownSalespersonId: string | null,
): boolean {
  if (!ctx) return true;
  if (can(ctx, "sales.invoice.view") || can(ctx, "sales.invoice.view_all")) return false;
  return ownSalespersonId === null || invoice.salespersonId !== ownSalespersonId;
}

// INVARIANT: a purchase return takes goods OUT of a warehouse, so a role that
// raises returns reads the source invoices of the warehouses it is explicitly
// granted — and nothing else of them: this opens the return's source lookup,
// never the invoice's own routes. The all-warehouses sentinel is not a grant;
// widening on it would open every supplier invoice to a returns clerk.
export function purchaseSourceInvoiceHidden(
  ctx: AuthContext | null | undefined,
  invoice: { readonly createdBy?: string | null; readonly warehouseId?: string | null },
  grantedWarehouses?: readonly string[],
): boolean {
  if (!ctx) return true;
  if (can(ctx, "purchases.invoice.view") || invoice.createdBy === ctx.userId) return false;
  const inGrantedWarehouse = grantedWarehouses !== undefined && !!invoice.warehouseId && grantedWarehouses.includes(invoice.warehouseId);
  return !(inGrantedWarehouse && can(ctx, "purchases.return.create"));
}
