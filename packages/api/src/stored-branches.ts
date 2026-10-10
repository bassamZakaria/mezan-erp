import type { Context } from "hono";
import { branchGrantOf, type StoredBranchesResolver } from "./permission-gate.js";

/** The branch each of `warehouseIds` belongs to; null for one no branch holds. */
export async function branchesOfWarehouses(c: Context, warehouseIds: readonly (string | null | undefined)[]): Promise<(string | null)[]> {
  const ids = warehouseIds.filter((id): id is string => typeof id === "string" && id !== "");
  if (ids.length === 0) return [];
  const branchByWarehouse = await c.get("warehouseBranches")?.();
  return ids.map((id) => branchByWarehouse?.get(id) ?? null);
}

/**
 * The branch a document's postings land in: its own, or — when it names none —
 * the branch of the warehouse it moves, which is how the posting adapters
 * attribute the journal lines.
 */
export async function documentBranches(
  c: Context,
  branchIds: readonly (string | null | undefined)[],
  warehouseIds: readonly (string | null | undefined)[],
): Promise<(string | null)[]> {
  const own = branchIds.filter((id): id is string => typeof id === "string" && id !== "");
  return own.length > 0 ? own : branchesOfWarehouses(c, warehouseIds);
}

/** A resolver for the document a route addresses by its `:id` param. */
export function storedBranchesById<Doc>(
  load: (id: string, c: Context) => Promise<Doc | null | undefined>,
  branchesOf: (doc: Doc, c: Context) => Promise<readonly (string | null | undefined)[]> | readonly (string | null | undefined)[],
): StoredBranchesResolver {
  return async (c) => {
    const id = c.req.param("id");
    if (!id) return null;
    const doc = await load(id, c);
    return doc ? branchesOf(doc, c) : null;
  };
}

/**
 * Rows a branch-GRANTED session may list, by the branch each row's postings
 * land in. Unattributable rows stay, as `withinScope` keeps them.
 */
export async function withinBranchGrant<Row>(
  c: Context,
  rows: readonly Row[],
  branchesOf: (row: Row) => Promise<readonly (string | null | undefined)[]>,
): Promise<readonly Row[]> {
  const grant = branchGrantOf(c);
  if (!grant) return rows;
  const kept: Row[] = [];
  for (const row of rows) {
    const attributed = (await branchesOf(row)).filter((id): id is string => typeof id === "string" && id !== "");
    if (attributed.length === 0 || attributed.some((id) => grant.includes(id))) kept.push(row);
  }
  return kept;
}
