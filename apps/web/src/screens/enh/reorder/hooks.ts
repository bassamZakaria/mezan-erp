import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { CreateReorderOrdersDTO, CreateReorderOrdersResultDTO, ReorderPolicyDTO, ReorderWorklistDTO, SaveReorderPolicyDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";

const ROOT = ["reorder"] as const;
const WORKLIST_KEY = [...ROOT, "worklist"] as const;
const POLICIES_KEY = [...ROOT, "policies"] as const;

function useReorderRequest() {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return { t, request, enabled: session !== null };
}

export function useReorderWorklist(warehouseId: string, windowDays: number): UseQueryResult<ReorderWorklistDTO, ApiError> {
  const { t, request, enabled } = useReorderRequest();
  return useQuery<ReorderWorklistDTO, ApiError>({
    queryKey: [...WORKLIST_KEY, warehouseId, windowDays],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams({ windowDays: String(windowDays) });
      if (warehouseId !== "") params.set("warehouseId", warehouseId);
      const res = await request(`/reorder/worklist?${params.toString()}`);
      if (!res.ok) throw await loaderError(res, t("reorder.worklist.loadFailed"), t);
      return res.json<ReorderWorklistDTO>();
    },
  });
}

export function useReorderPolicies(): UseQueryResult<ReorderPolicyDTO[], ApiError> {
  const { t, request, enabled } = useReorderRequest();
  return useQuery<ReorderPolicyDTO[], ApiError>({
    queryKey: POLICIES_KEY,
    enabled,
    queryFn: async () => {
      const res = await request("/reorder/policies");
      if (!res.ok) throw await loaderError(res, t("reorder.policies.loadFailed"), t);
      return res.json<ReorderPolicyDTO[]>();
    },
  });
}

function useReorderMutation<TBody, TResult>(path: (body: TBody) => string, method: string, failure: AppTranslationKey, hasBody = true) {
  const { t, request } = useReorderRequest();
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: async (body) => {
      const res = await request(path(body), hasBody ? { method, body: JSON.stringify(body) } : { method });
      if (!res.ok) throw await loaderError(res, t(failure), t);
      return res.status === 204 ? (undefined as TResult) : res.json<TResult>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROOT }),
  });
}

export function useSaveReorderPolicy() {
  return useReorderMutation<SaveReorderPolicyDTO, ReorderPolicyDTO>(() => "/reorder/policies", "PUT", "reorder.policies.saveFailed");
}

export function useDeleteReorderPolicy() {
  return useReorderMutation<{ itemId: string; warehouseId: string }, void>(
    ({ itemId, warehouseId }) => `/reorder/policies/${encodeURIComponent(itemId)}/${encodeURIComponent(warehouseId)}`,
    "DELETE",
    "reorder.policies.deleteFailed",
    false,
  );
}

export function useCreateReorderOrders() {
  return useReorderMutation<CreateReorderOrdersDTO, CreateReorderOrdersResultDTO>(() => "/reorder/orders", "POST", "reorder.worklist.createFailed");
}
