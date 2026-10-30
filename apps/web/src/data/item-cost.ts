import { CostPermission } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { sessionHolds } from "./session";

/** UI affordance only: the server omits or refuses every cost figure for a session without it (#119). */
export function useMaySeeItemCost(): boolean {
  return sessionHolds(useApi().session, CostPermission.Item);
}
