import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { dashboardSummarySchema, type DashboardSummaryDTO } from "@mezan/contracts";
import { useSession } from "@/session/SessionProvider";
import type { ApiError } from "./errors";

export enum QueryKey {
  DashboardSummary = "dashboard-summary",
}

export function useDashboardSummary(): UseQueryResult<DashboardSummaryDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<DashboardSummaryDTO, ApiError>({
    queryKey: [QueryKey.DashboardSummary],
    enabled: session !== null,
    queryFn: () => request("/dashboard/summary", { schema: dashboardSummarySchema }),
  });
}
