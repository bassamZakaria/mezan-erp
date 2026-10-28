import { useApi } from "./ApiContext";
import { sessionHolds } from "./session";

export enum CostPermission {
  Item = "inventory.cost.view",
}

/** UI affordance only: the server omits or refuses every cost figure for a session without it (#119). */
export function useMaySeeItemCost(): boolean {
  return sessionHolds(useApi().session, CostPermission.Item);
}
