import type { UseQueryResult } from "@tanstack/react-query";
import type { EntitlementsDTO } from "@mezan/contracts";
import { hasModule, hasReadOnlyModule, planServesShellRequest, type HrSubModule, type ShellRequest } from "@mezan/domain";

export enum PlanModule {
  Hr = "hr",
  Contracting = "contracting",
}

export function planIncludesModule(entitlements: Pick<UseQueryResult<EntitlementsDTO>, "data" | "isError">, module: PlanModule): boolean {
  if (entitlements.data) return hasModule(entitlements.data, module) || hasReadOnlyModule(entitlements.data, module);
  return entitlements.isError;
}

/** True when the plan holds an HR part (or it stays readable). While the plan is unknown after an error, show it — the server still refuses. */
export function planHoldsPart(entitlements: Pick<UseQueryResult<EntitlementsDTO>, "data" | "isError">, part: HrSubModule): boolean {
  if (entitlements.data) return hasModule(entitlements.data, part) || hasReadOnlyModule(entitlements.data, part);
  return entitlements.isError;
}

export function planServesRequest(entitlements: Pick<UseQueryResult<EntitlementsDTO>, "data" | "isError">, request: ShellRequest): boolean {
  if (entitlements.data) return planServesShellRequest(entitlements.data, request);
  return entitlements.isError;
}
