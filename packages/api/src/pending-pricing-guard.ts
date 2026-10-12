import type { Context, MiddlewareHandler } from "hono";
import { ItemPendingPricingError, ItemStatusCode, type ItemRepository } from "@mezan/domain";
import type { AuthContextResolver } from "./permission-gate.js";

const UNGUARDED_PREFIXES: readonly string[] = ["/items", "/price-lists"];
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
 * included — cannot put an item still waiting for head office's price on a
 * document. Only the item master and the price lists that price it are exempt.
 */
export function pendingPricingGuard(items: Pick<ItemRepository, "findById" | "findByCode">, resolveAuthContext: AuthContextResolver): MiddlewareHandler {
  return async function pendingPricing(c, next) {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "DELETE") return next();
    const path = c.req.path;
    if (UNGUARDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return next();
    const named = itemReferencesNamedIn(await readJson(c));
    if (named.ids.size === 0 && named.codes.size === 0) return next();
    if (!(await resolveAuthContext(c)).authenticated) return next();
    const found = await Promise.all([...[...named.ids].map((id) => items.findById(id)), ...[...named.codes].map((code) => items.findByCode(code))]);
    const pending = new Map<string, string>();
    for (const item of found) if (item?.status === ItemStatusCode.PendingPricing) pending.set(item.id, item.nameAr);
    if (pending.size === 0) return next();
    const refusal = new ItemPendingPricingError([...pending].map(([id, nameAr]) => ({ id, nameAr })));
    return c.json({ error: refusal.code, message: refusal.message, messageEn: refusal.messageEn, itemIds: [...pending.keys()] }, 409);
  };
}
