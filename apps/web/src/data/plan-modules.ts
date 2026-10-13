import type { UseQueryResult } from "@tanstack/react-query";
import type { EntitlementsDTO } from "@mezan/contracts";
import { hasModule, hasReadOnlyModule } from "@mezan/domain";

export enum PlanModule {
  Hr = "hr",
  Contracting = "contracting",
}

export function planIncludesModule(entitlements: Pick<UseQueryResult<EntitlementsDTO>, "data" | "isError">, module: PlanModule): boolean {
  if (entitlements.data) return hasModule(entitlements.data, module) || hasReadOnlyModule(entitlements.data, module);
  return entitlements.isError;
}
