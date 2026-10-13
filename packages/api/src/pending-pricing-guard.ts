import type { Context, MiddlewareHandler } from "hono";
import { ItemPendingPricingError, ItemStatusCode, type ItemRepository } from "@mezan/domain";
import type { AuthContextResolver } from "./permission-gate.js";

export enum ItemDocumentFamily {
  ItemMaster = "item_master",
  SalesQuote = "sales_quote",
  SalesInvoice = "sales_invoice",
  SalesReturn = "sales_return",
  PointOfSale = "point_of_sale",
  VanSales = "van_sales",
  PriceList = "price_list",
  Promotion = "promotion",
  Purchasing = "purchasing",
  PurchaseReturn = "purchase_return",
  RequestForQuotation = "request_for_quotation",
  LandedCost = "landed_cost",
  StockTransfer = "stock_transfer",
  StockAdjustment = "stock_adjustment",
  PhysicalCount = "physical_count",
  Unclassified = "unclassified",
}

export enum PendingItemRule {
  Allow = "allow",
  Deny = "deny",
}

/*
 * DECISION (owner): an item waiting for head office's price is refused where it
 * would be SOLD or priced for sale, and allowed where stock is bought, received,
 * moved, counted or corrected — head office receives goods before it prices
 * them. SECURITY: a route no family below claims is `Unclassified` and denied,
 * so a sales-side family added later is closed until someone decides otherwise.
 */
export const PENDING_ITEM_RULES: Readonly<Record<ItemDocumentFamily, PendingItemRule>> = {
  [ItemDocumentFamily.ItemMaster]: PendingItemRule.Allow,
  [ItemDocumentFamily.SalesQuote]: PendingItemRule.Deny,
  [ItemDocumentFamily.SalesInvoice]: PendingItemRule.Deny,
  [ItemDocumentFamily.SalesReturn]: PendingItemRule.Deny,
  [ItemDocumentFamily.PointOfSale]: PendingItemRule.Deny,
  [ItemDocumentFamily.VanSales]: PendingItemRule.Deny,
  [ItemDocumentFamily.PriceList]: PendingItemRule.Deny,
  [ItemDocumentFamily.Promotion]: PendingItemRule.Deny,
  [ItemDocumentFamily.Purchasing]: PendingItemRule.Allow,
  [ItemDocumentFamily.PurchaseReturn]: PendingItemRule.Allow,
  [ItemDocumentFamily.RequestForQuotation]: PendingItemRule.Allow,
  [ItemDocumentFamily.LandedCost]: PendingItemRule.Allow,
  [ItemDocumentFamily.StockTransfer]: PendingItemRule.Allow,
  [ItemDocumentFamily.StockAdjustment]: PendingItemRule.Allow,
  [ItemDocumentFamily.PhysicalCount]: PendingItemRule.Allow,
  [ItemDocumentFamily.Unclassified]: PendingItemRule.Deny,
};

const FAMILY_ROUTE_PREFIXES: readonly (readonly [prefix: string, family: ItemDocumentFamily])[] = [
  ["/items", ItemDocumentFamily.ItemMaster],
  ["/sales-quotes", ItemDocumentFamily.SalesQuote],
  ["/sales-invoices", ItemDocumentFamily.SalesInvoice],
  ["/sales-returns", ItemDocumentFamily.SalesReturn],
  ["/pos", ItemDocumentFamily.PointOfSale],
  ["/field", ItemDocumentFamily.VanSales],
  ["/price-lists", ItemDocumentFamily.PriceList],
  ["/promotions", ItemDocumentFamily.Promotion],
  ["/purchases", ItemDocumentFamily.Purchasing],
  ["/purchase-returns", ItemDocumentFamily.PurchaseReturn],
  ["/rfqs", ItemDocumentFamily.RequestForQuotation],
  ["/landed-costs", ItemDocumentFamily.LandedCost],
  ["/inventory/stock-transfers", ItemDocumentFamily.StockTransfer],
  ["/inventory/stock-adjustments", ItemDocumentFamily.StockAdjustment],
  ["/inventory/physical-counts", ItemDocumentFamily.PhysicalCount],
];

export function itemDocumentFamilyOf(path: string): ItemDocumentFamily {
  return FAMILY_ROUTE_PREFIXES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? ItemDocumentFamily.Unclassified;
}
const ITEM_KEY = /(?:^i|I)temId$/;
const ITEM_LIST_KEY = /(?:^i|I)temIds$/;
const ITEM_CODE_KEY = /(?:^i|I)temCode$/;
const MAX_DEPTH = 12;

export interface ItemReferences {
  readonly ids: Set<string>;
  readonly codes: Set<string>;
}

export function itemReferencesNamedIn(value: unknown, depth = 0, found: ItemReferences = { ids: new Set(), codes: new Set() }): ItemReferences {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const entry of value) itemReferencesNamedIn(entry, depth + 1, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (ITEM_KEY.test(key) && typeof child === "string") {
      if (child !== "") found.ids.add(child);
    } else if (ITEM_CODE_KEY.test(key) && typeof child === "string") {
      if (child !== "") found.codes.add(child);
    } else if (ITEM_LIST_KEY.test(key) && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string" && id !== "") found.ids.add(id);
    } else {
      itemReferencesNamedIn(child, depth + 1, found);
    }
  }
  return found;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return JSON.parse(await c.req.text());
  } catch {
    return undefined;
  }
}

/**
 * SECURITY: mounted app-wide, so a write on ANY route — one added later
 * included — is held to `PENDING_ITEM_RULES`. It runs before the route's own
 * permission gate, so the refusal repeats the ids the caller sent and says
 * nothing else about the item.
 */
export function pendingPricingGuard(items: Pick<ItemRepository, "findById" | "findByCode">, resolveAuthContext: AuthContextResolver): MiddlewareHandler {
  return async function pendingPricing(c, next) {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "DELETE") return next();
    if (PENDING_ITEM_RULES[itemDocumentFamilyOf(c.req.path)] === PendingItemRule.Allow) return next();
    const named = itemReferencesNamedIn(await readJson(c));
    if (named.ids.size === 0 && named.codes.size === 0) return next();
    if (!(await resolveAuthContext(c)).authenticated) return next();
    const found = await Promise.all([...[...named.ids].map((id) => items.findById(id)), ...[...named.codes].map((code) => items.findByCode(code))]);
    const pending = new Set<string>();
    for (const item of found) if (item?.status === ItemStatusCode.PendingPricing) pending.add(item.id);
    if (pending.size === 0) return next();
    const refusal = new ItemPendingPricingError([...pending]);
    return c.json({ error: refusal.code, message: refusal.message, messageEn: refusal.messageEn, itemIds: refusal.itemIds }, 409);
  };
}
