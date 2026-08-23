import type { BranchDTO } from "@mezan/contracts";

/** Resolves a branch id to its display name against a REAL branches list (e.g. `useBranches()`'s data). */
export function branchName(branchId: string, branches: readonly BranchDTO[]): string {
  return branches.find((b) => b.id === branchId)?.name ?? branchId;
}
