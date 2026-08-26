import type { Context } from "hono";

/**
 * Refuses a document line that names an item the catalogue does not hold (D38).
 *
 * `itemId` was validated as `z.string().min(1)` and nothing else, on both the
 * quote and the sales-invoice line schemas, so any string was accepted: the
 * quotes screen exploited exactly that for a while, inventing `ITEM-1` behind a
 * typed item name, and the convert step then hardcoded `isStock: false` — a
 * stock item became an invoice line that moved no stock and posted no COGS.
 *
 * The check is a dependency rather than a schema rule because zod cannot reach
 * the tenant's item repository, and it is optional for the same reason every
 * other cross-aggregate check here is: a caller that does not wire it gets the
 * old behaviour rather than a route that cannot be mounted.
 */
export interface ItemCatalogCheck {
  findById(id: string): Promise<{ readonly id: string } | null | undefined>;
}

/** Ids named by the lines that the catalogue does not have, in first-seen order. */
export async function unknownItemIds(check: ItemCatalogCheck, ids: readonly string[]): Promise<readonly string[]> {
  const distinct = [...new Set(ids)];
  const found = await Promise.all(distinct.map(async (id) => ({ id, hit: await check.findById(id) })));
  return found.filter((r) => !r.hit).map((r) => r.id);
}

/**
 * Returns a 422 body when any line names an unknown item, or null to continue.
 *
 * The message is Arabic because a domain refusal reaches an Arabic UI, and it
 * names the offending ids so the caller can see WHICH line is wrong.
 */
export async function refuseUnknownItems(
  c: Context,
  check: ItemCatalogCheck | undefined,
  ids: readonly string[],
): Promise<Response | null> {
  if (!check || ids.length === 0) return null;
  const unknown = await unknownItemIds(check, ids);
  if (unknown.length === 0) return null;
  return c.json(
    {
      error: "ITEM_NOT_FOUND",
      message: `أصناف غير موجودة في دليل الأصناف: ${unknown.join("، ")}`,
      itemIds: unknown,
    },
    422,
  );
}
