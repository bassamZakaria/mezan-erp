import type { UseQueryResult } from "@tanstack/react-query";
import type { EntitlementsDTO } from "@mezan/contracts";

export enum PlanModule {
  Hr = "hr",
  Contracting = "contracting",
}

/**
 * Whether a module-scoped request is worth sending. Unknown while the
 * entitlements are still loading; when they cannot be read at all the question
 * falls to the server, exactly as the nav rail shows every workspace then.
 */
export function planIncludesModule(entitlements: Pick<UseQueryResult<EntitlementsDTO>, "data" | "isError">, module: PlanModule): boolean {
  if (entitlements.data) return entitlements.data.activeModules.includes(module);
  return entitlements.isError;
}
