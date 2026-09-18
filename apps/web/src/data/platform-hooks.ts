import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AuditQueryDTO,
  AuditQueryResponseDTO,
  ResetSequenceCounterDTO,
  SequenceListItemDTO,
  SequenceOverrideDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError, readError } from "./hooks";
import { useAppTranslation } from "../i18n";

/**
 * Platform admin data hooks — numbering sequences (`/settings/sequences`) and
 * the audit log viewer (`/audit`). Kept out of `data/hooks.ts` per file
 * ownership; same `useApi`/`ApiError`/TanStack Query conventions as every
 * other hook there.
 */

/** GET /sequences — the effective definition + live counter state for every sequence type. */
export function useSequences(): UseQueryResult<SequenceListItemDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SequenceListItemDTO[], ApiError>({
    queryKey: ["sequences"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/sequences");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("sequences.loadFailed"), t));
      return res.json<SequenceListItemDTO[]>();
    },
  });
}

/** PATCH /sequences/:code — edit prefix / pad length / annual-reset flag. */
export function useUpdateSequence() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SequenceListItemDTO, ApiError, { code: string; patch: SequenceOverrideDTO }>({
    mutationFn: async ({ code, patch }) => {
      const res = await request(`/sequences/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      // The server's refusal is the useful half — «البادئة مستخدمة بالفعل»
      // tells the admin what to change; the generic sentence does not (D100).
      // `readError` prefers that message and falls back to the sentence with a
      // support code appended.
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("platformApi.theSequenceSettingsCouldNot"), t));
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
  const { t } = useAppTranslation();
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
        throw new ApiError(res.status, payload.message ?? t("platformApi.theCounterCouldNotBe"));
      }
      return res.json<SequenceListItemDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

/**
 * What `GET /audit/verify` answers — the hash-chain walk in
 * packages/persistence/src/audit-sink.ts. Not in @mezan/contracts because the
 * shape belongs to the storage layer that computes it, not to a document.
 */
export interface AuditChainVerificationDTO {
  readonly ok: boolean;
  readonly checked: number;
  readonly unchained: number;
  readonly brokenRowId: number | null;
  readonly reason: "OK" | "ROW_ALTERED" | "CHAIN_BROKEN" | "HEAD_MISSING" | "HEAD_ALTERED" | "TRUNCATED";
}

/**
 * «تحقق من سلامة السجل» — on demand only.
 *
 * A `useMutation` rather than a query because it must not run on mount or on a
 * refetch: it walks every audit row, and an integrity check nobody asked for
 * that reports a break is a fright with no context.
 */
export function useVerifyAuditChain() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<AuditChainVerificationDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/audit/verify");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("audit.verifyFailed"), t));
      return res.json<AuditChainVerificationDTO>();
    },
  });
}

/** GET /audit — filtered, paginated read of the append-only audit trail. Read-only by construction. */
export function useAuditLog(filter: AuditQueryDTO = {}): UseQueryResult<AuditQueryResponseDTO, ApiError> {
  const { t } = useAppTranslation();
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
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("audit.couldNotLoadTheAudit"), t));
      return res.json<AuditQueryResponseDTO>();
    },
  });
}
