import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApprovalRequestDTO,
  WorkflowConfigDTO,
  WorkflowConfigInputDTO,
  WorkflowDecisionCommentDTO,
  WorkflowRequestScopeDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";

/**
 * الموافقات / سير العمل (docs/catalog/09 §الموافقات) — data hooks for the
 * approvals inbox (`/approvals`) and the workflow config screen
 * (`/settings/workflow`), over `@mezan/api`'s `/workflow` routes. Kept in its
 * own file (not `data/hooks.ts`) per this feature's file ownership.
 */

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/** إعدادات الموافقات — every gateable action type + its configured chain (`/settings/workflow`). */
export function useWorkflowConfig(): UseQueryResult<WorkflowConfigDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WorkflowConfigDTO[], ApiError>({
    queryKey: ["workflow", "config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/workflow/config");
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحميل إعدادات الموافقات."));
      return res.json<WorkflowConfigDTO[]>();
    },
  });
}

export function useSetWorkflowConfig() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDTO, ApiError, { actionType: string; body: WorkflowConfigInputDTO }>({
    mutationFn: async ({ actionType, body }) => {
      const res = await request(`/workflow/config/${actionType}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حفظ إعداد الموافقة."));
      return res.json<WorkflowConfigDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow", "config"] }),
  });
}

/** صندوق الموافقات (`/approvals`) — one tab's rows: `inbox` (awaiting me), `mine` (I submitted), `acted` (I decided). */
export function useWorkflowRequests(scope: WorkflowRequestScopeDTO): UseQueryResult<ApprovalRequestDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ApprovalRequestDTO[], ApiError>({
    queryKey: ["workflow", "requests", scope],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/workflow/requests?scope=${scope}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحميل طلبات الموافقة."));
      return res.json<ApprovalRequestDTO[]>();
    },
  });
}

function useDecideWorkflowRequest(action: "approve" | "reject") {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDTO, ApiError, { id: string; body: WorkflowDecisionCommentDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/workflow/requests/${id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        throw new ApiError(res.status, await readError(res, action === "approve" ? "تعذّر اعتماد الطلب." : "تعذّر رفض الطلب."));
      }
      return res.json<ApprovalRequestDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["workflow", "requests"] }),
  });
}

export function useApproveWorkflowRequest() {
  return useDecideWorkflowRequest("approve");
}

export function useRejectWorkflowRequest() {
  return useDecideWorkflowRequest("reject");
}
