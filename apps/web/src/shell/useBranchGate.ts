import { useMemo } from "react";
import { BranchRestrictedAccess, branchRestrictedAccess } from "@mezan/contracts";
import { actionAccess, isBranchRestricted, type BranchGatedAction } from "../branch-restriction";
import { useApi } from "../data/ApiContext";

export interface BranchGate {
  readonly restricted: boolean;
  /** False for a tile or action the server refuses a branch-restricted session — so it is not drawn and not asked for. */
  allows(action: BranchGatedAction): boolean;
  allowsApi(path: string): boolean;
}

export function useBranchGate(): BranchGate {
  const { session } = useApi();
  const restricted = isBranchRestricted(session);
  return useMemo(
    () => ({
      restricted,
      allows: (action) => !restricted || actionAccess(action) !== BranchRestrictedAccess.Unavailable,
      allowsApi: (path) => !restricted || branchRestrictedAccess(path) !== BranchRestrictedAccess.Unavailable,
    }),
    [restricted],
  );
}
