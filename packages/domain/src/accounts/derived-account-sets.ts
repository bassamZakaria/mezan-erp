import type { Account } from "./account.js";
import { routedAccountId, type AccountRouting } from "./account-routing.js";

export const INVENTORY_ROUTING_KEYS: readonly string[] = ["control.inventory", "item_type.inventory"];

export const COST_OF_SALES_ROUTING_KEYS: readonly string[] = ["item_type.cogs", "contracting.cost_of_revenue"];

export interface ItemLedgerAccounts {
  readonly inventoryAccountId?: string | null;
  readonly cogsAccountId?: string | null;
}

function routed(routing: AccountRouting | null | undefined, keys: readonly string[]): string[] {
  return keys.map((key) => routedAccountId(routing, key)).filter((id): id is string => id !== null);
}

function postable(accounts: readonly Account[], type: Account["type"], ids: readonly (string | null | undefined)[]): string[] {
  const named = new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""));
  return accounts.filter((account) => !account.isHeader && account.type === type && named.has(account.id)).map((account) => account.id);
}

/**
 * LEDGER INVARIANT: "inventory" on a statement is the accounts stock is held
 * on — the routed inventory accounts and every item's own — never an
 * account-code prefix, which a tenant on a recoded chart does not share and
 * which sweeps in whatever else was numbered beside them.
 */
export function inventoryLedgerAccountIds(accounts: readonly Account[], routing: AccountRouting | null | undefined, items: readonly ItemLedgerAccounts[] = []): string[] {
  return postable(accounts, "asset", [...routed(routing, INVENTORY_ROUTING_KEYS), ...items.map((item) => item.inventoryAccountId)]);
}

/** LEDGER INVARIANT: cost of sales is the accounts a sale's cost is posted to — the routed ones and every item's own — never an account-code prefix. */
export function costOfSalesLedgerAccountIds(accounts: readonly Account[], routing: AccountRouting | null | undefined, items: readonly ItemLedgerAccounts[] = []): string[] {
  return postable(accounts, "expense", [...routed(routing, COST_OF_SALES_ROUTING_KEYS), ...items.map((item) => item.cogsAccountId)]);
}
