import type { CostCenter } from "./cost-center.js";

/** A `CostCenter` nested with its children, sorted by `code` at every level. */
export interface CostCenterTreeNode extends CostCenter {
  readonly children: readonly CostCenterTreeNode[];
}

/**
 * Nests a flat cost-center list into a tree by `parentId`, sorted by `code`
 * at every level. Orphaned rows (a `parentId` that does not resolve to
 * another row in the list) are treated as roots rather than silently
 * dropped — mirrors `accounts/hierarchy.ts`'s `buildAccountTree`.
 */
export function buildCostCenterTree(costCenters: readonly CostCenter[]): CostCenterTreeNode[] {
  const byId = new Map(costCenters.map((c) => [c.id, c]));
  const childrenOf = new Map<string | null, CostCenter[]>();

  for (const costCenter of costCenters) {
    const parentKey = costCenter.parentId !== null && byId.has(costCenter.parentId) ? costCenter.parentId : null;
    const bucket = childrenOf.get(parentKey);
    if (bucket) bucket.push(costCenter);
    else childrenOf.set(parentKey, [costCenter]);
  }

  function build(parentId: string | null): CostCenterTreeNode[] {
    const siblings = childrenOf.get(parentId) ?? [];
    return [...siblings]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((costCenter) => ({ ...costCenter, children: build(costCenter.id) }));
  }

  return build(null);
}

/** Flattens a tree back into depth-first order, annotating each row with its nesting `level`. */
export interface FlattenedCostCenterRow extends CostCenter {
  readonly level: number;
  readonly hasChildren: boolean;
}

export function flattenCostCenterTree(nodes: readonly CostCenterTreeNode[], level = 0): FlattenedCostCenterRow[] {
  const out: FlattenedCostCenterRow[] = [];
  for (const node of nodes) {
    const { children, ...costCenter } = node;
    out.push({ ...costCenter, level, hasChildren: children.length > 0 });
    out.push(...flattenCostCenterTree(children, level + 1));
  }
  return out;
}

/**
 * True if `candidateAncestorId` appears anywhere in `costCenterId`'s ancestor
 * chain (walking `parentId` links) — used to reject a reparent that would
 * create a cycle.
 */
export function isDescendantOf(
  costCenters: readonly CostCenter[],
  costCenterId: string,
  candidateAncestorId: string,
): boolean {
  const byId = new Map(costCenters.map((c) => [c.id, c]));
  let cursor = byId.get(costCenterId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === candidateAncestorId) return true;
    if (seen.has(cursor)) return false; // defensive: pre-existing corrupt cycle, don't loop forever
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}
