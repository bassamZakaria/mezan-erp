import type { Context } from "hono";
import { BranchAccess, BranchRecordKind, branchDirectoryOf } from "./branch-policy.js";
import { branchGrantOf, branchScopeOf, type StoredBranchesResolver } from "./permission-gate.js";
import { canSeeUnattributed } from "./branch-view.js";

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

interface ReturnDocument {
  readonly id: string;
  readonly lines: readonly { readonly branchId?: string | null; readonly warehouseId?: string | null }[];
}

/**
 * INVARIANT: the ONE reading of a sales or purchase return's branch — each
 * line's own, else its warehouse's, else its source invoice's — taken from the
 * branch directory. The gate, the list, the record and its attachments all
 * call this, so they cannot disagree about whose return it is.
 */
export async function returnBranches(
  c: Context,
  kind: BranchRecordKind.SalesReturn | BranchRecordKind.PurchaseReturn,
  doc: ReturnDocument,
): Promise<readonly (string | null)[]> {
  const stored = await branchDirectoryOf(c)?.branchesOf(kind, doc.id, BranchAccess.Read);
  return stored ?? documentBranches(c, doc.lines.map((line) => line.branchId), doc.lines.map((line) => line.warehouseId));
}

/** Rows inside the request's branch scope, by the branches each resolves to. A row no branch owns stays, as `withinScope` keeps it. */
export async function withinBranchScope<Row>(c: Context, rows: readonly Row[], branchesOf: (row: Row) => Promise<readonly (string | null | undefined)[]>): Promise<Row[]> {
  const scope = branchScopeOf(c);
  if (!scope) return [...rows];
  const kept: Row[] = [];
  for (const row of rows) {
    const attributed = (await branchesOf(row)).filter((id): id is string => typeof id === "string" && id !== "");
    if (attributed.length === 0 || attributed.some((id) => scope.includes(id))) kept.push(row);
  }
  return kept;
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

/**
 * INVARIANT, for a list that is cut into pages: the rows the session reads,
 * decided exactly as the branch gate decides them by id — a row no branch owns
 * only for a session that reads the unattributed. Narrow with this BEFORE the
 * page is cut; the gate then drops nothing and a page stays whole.
 */
export async function withinBranchView<Row>(c: Context, rows: readonly Row[], branchesOf: (row: Row) => Promise<readonly (string | null | undefined)[]>): Promise<Row[]> {
  const scope = branchScopeOf(c);
  if (!scope) return [...rows];
  const unattributed = canSeeUnattributed(c);
  const kept: Row[] = [];
  for (const row of rows) {
    const attributed = (await branchesOf(row)).filter((id): id is string => typeof id === "string" && id !== "");
    if (attributed.length === 0 ? unattributed : attributed.some((id) => scope.includes(id))) kept.push(row);
  }
  return kept;
}

/** The warehouses the branches of the request's scope hold, or `undefined` for an unscoped request. */
export async function warehousesOfBranchScope(c: Context): Promise<readonly string[] | undefined> {
  const scope = branchScopeOf(c);
  if (!scope) return undefined;
  const branchByWarehouse = await c.get("warehouseBranches")?.();
  return branchByWarehouse ? [...branchByWarehouse].filter(([, branchId]) => scope.includes(branchId)).map(([id]) => id) : undefined;
}
