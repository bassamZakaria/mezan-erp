import type { CostCenterDTO } from "@mezan/contracts";

/**
 * Presentation-only cost-center tree helpers for apps/web — mirrors
 * `lib/account-tree.ts`'s rationale: apps/web has no live API wiring yet, so
 * this reimplements "nest by parentId, sorted by code" for display against
 * the wire `CostCenterDTO` shape without importing the whole domain package
 * (the real, tested hierarchy logic lives in
 * packages/domain/src/cost-centers/hierarchy.ts and is exercised by the
 * API's create/edit routes once wired in).
 */

export interface CostCenterTreeNode extends CostCenterDTO {
  readonly children: readonly CostCenterTreeNode[];
}

export function buildCostCenterTree(costCenters: readonly CostCenterDTO[]): CostCenterTreeNode[] {
  const byId = new Map(costCenters.map((c) => [c.id, c]));
  const childrenOf = new Map<string | null, CostCenterDTO[]>();

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

export function isDescendantOf(costCenters: readonly CostCenterDTO[], costCenterId: string, candidateAncestorId: string): boolean {
  const byId = new Map(costCenters.map((c) => [c.id, c]));
  let cursor = byId.get(costCenterId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === candidateAncestorId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}
