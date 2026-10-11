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

export function purchaseSourceInvoiceHidden(
  ctx: AuthContext | null | undefined,
  invoice: { readonly createdBy?: string | null },
): boolean {
  if (!ctx) return true;
  return !can(ctx, "purchases.invoice.view") && invoice.createdBy !== ctx.userId;
}
