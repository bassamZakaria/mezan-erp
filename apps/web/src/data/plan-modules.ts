import type { UseQueryResult } from "@tanstack/react-query";
import type { EntitlementsDTO } from "@mezan/contracts";

export enum PlanModule {
  Hr = "hr",
  Contracting = "contracting",
}

export function planIncludesModule(entitlements: Pick<UseQueryResult<EntitlementsDTO>, "data" | "isError">, module: PlanModule): boolean {
  if (entitlements.data) {
    return entitlements.data.activeModules.includes(module) || (entitlements.data.readOnlyModules ?? []).includes(module);
  }
  return entitlements.isError;
}
