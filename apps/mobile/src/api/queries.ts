import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  customerSchema,
  dashboardSummarySchema,
  type CustomerDTO,
  type DashboardSummaryDTO,
} from "@mezan/contracts";
import { useSession } from "@/session/SessionProvider";
import type { ApiError } from "./errors";

export enum QueryKey {
  DashboardSummary = "dashboard-summary",
  Customers = "customers",
  Customer = "customer",
}

const customerListSchema = z.array(customerSchema);

export function useDashboardSummary(): UseQueryResult<DashboardSummaryDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<DashboardSummaryDTO, ApiError>({
    queryKey: [QueryKey.DashboardSummary],
    enabled: session !== null,
    queryFn: () => request("/dashboard/summary", { schema: dashboardSummarySchema }),
  });
}

export function useCustomers(search: string): UseQueryResult<CustomerDTO[], ApiError> {
  const { request, session } = useSession();
  const trimmed = search.trim();
  return useQuery<CustomerDTO[], ApiError>({
    queryKey: [QueryKey.Customers, trimmed],
    enabled: session !== null,
    queryFn: () => {
      const params = new URLSearchParams();
      if (trimmed !== "") params.set("q", trimmed);
      const query = params.toString();
      return request(`/customers${query === "" ? "" : `?${query}`}`, { schema: customerListSchema });
    },
  });
}

export function useCustomer(id: string): UseQueryResult<CustomerDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<CustomerDTO, ApiError>({
    queryKey: [QueryKey.Customer, id],
    enabled: session !== null && id !== "",
    queryFn: () => request(`/customers/${encodeURIComponent(id)}`, { schema: customerSchema }),
  });
}
