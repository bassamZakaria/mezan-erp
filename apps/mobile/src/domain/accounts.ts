/**
 * Fallback GL account ids for a sales invoice/quote line or a collection
 * voucher when the item or the tenant carries none of its own — the same
 * constants `apps/web/src/screens/SalesInvoicesScreen.tsx` and
 * `TreasuryVouchersScreen.tsx` fall back to. They exist because a document
 * cannot post without an account id; they are not a substitute for the
 * item's own `revenueAccountId` / `cogsAccountId` / `inventoryAccountId`,
 * which always wins when present.
 */
export const DEFAULT_GL_ACCOUNTS = {
  accountsReceivable: "1105",
  tax: "2200",
  revenue: "4100",
  cogs: "5100",
  inventory: "1200",
} as const;
