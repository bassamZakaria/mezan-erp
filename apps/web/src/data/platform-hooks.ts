import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AuditQueryDTO,
  AuditQueryResponseDTO,
  ResetSequenceCounterDTO,
  SequenceListItemDTO,
  SequenceOverrideDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";

/**
 * Platform admin data hooks — numbering sequences (`/settings/sequences`) and
 * the audit log viewer (`/audit`). Kept out of `data/hooks.ts` per file
 * ownership; same `useApi`/`ApiError`/TanStack Query conventions as every
 * other hook there.
 */

/** GET /sequences — the effective definition + live counter state for every sequence type. */
export function useSequences(): UseQueryResult<SequenceListItemDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<SequenceListItemDTO[], ApiError>({
    queryKey: ["sequences"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/sequences");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تسلسلات الترقيم.");
      return res.json<SequenceListItemDTO[]>();
    },
  });
}

/** PATCH /sequences/:code — edit prefix / pad length / annual-reset flag. */
export function useUpdateSequence() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SequenceListItemDTO, ApiError, { code: string; patch: SequenceOverrideDTO }>({
    mutationFn: async ({ code, patch }) => {
      const res = await request(`/sequences/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, "تعذّر حفظ إعدادات التسلسل.");
      return res.json<SequenceListItemDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

/**
 * POST /sequences/:code/counter — explicit, guarded counter adjustment
 * (`admin.sequences.reset`). The API refuses any value below the current
 * counter; this hook does not attempt to hide or soften that guard.
 */
export function useResetSequenceCounter() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SequenceListItemDTO, ApiError, { code: string; body: ResetSequenceCounterDTO }>({
    mutationFn: async ({ code, body }) => {
      const res = await request(`/sequences/${encodeURIComponent(code)}/counter`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json<{ message?: string }>().catch(() => ({}) as { message?: string });
        throw new ApiError(res.status, payload.message ?? "تعذّر تعديل العداد.");
      }
      return res.json<SequenceListItemDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

/** GET /audit — filtered, paginated read of the append-only audit trail. Read-only by construction. */
export function useAuditLog(filter: AuditQueryDTO = {}): UseQueryResult<AuditQueryResponseDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<AuditQueryResponseDTO, ApiError>({
    queryKey: ["audit", filter],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.stream) params.set("stream", filter.stream);
      if (filter.module) params.set("module", filter.module);
      if (filter.action) params.set("action", filter.action);
      if (filter.actor) params.set("actor", filter.actor);
      if (filter.entityType) params.set("entityType", filter.entityType);
      if (filter.severity) params.set("severity", filter.severity);
      if (filter.branchId) params.set("branchId", filter.branchId);
      if (filter.from) params.set("from", filter.from);
      if (filter.to) params.set("to", filter.to);
      if (filter.limit) params.set("limit", String(filter.limit));
      if (filter.offset) params.set("offset", String(filter.offset));
      const qs = params.toString();
      const res = await request(`/audit${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل سجل المراجعة.");
      return res.json<AuditQueryResponseDTO>();
    },
  });
}
