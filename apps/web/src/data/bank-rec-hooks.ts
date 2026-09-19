import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AutoMatchResultDTO,
  BankRuleDTO,
  BankRuleInputDTO,
  BankStatementDTO,
  BankStatementReviewDTO,
  CreateEntryFromLineDTO,
  CreateEntryResultDTO,
  ImportStatementFileDTO,
  StatementLineDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, readError } from "./hooks";
import { useAppTranslation } from "../i18n";

const KEY = "bank-statements";

export function useBankStatementReview(statementId: string | null): UseQueryResult<BankStatementReviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BankStatementReviewDTO, ApiError>({
    queryKey: [KEY, "review", statementId],
    enabled: session !== null && statementId !== null,
    queryFn: async () => {
      const res = await request(`/bank-statements/${statementId}/review`);
      if (!res.ok) throw await loaderError(res, t("bankRecX.reviewLoadFailed"), t);
      return res.json<BankStatementReviewDTO>();
    },
  });
}

export function useBankRules(): UseQueryResult<BankRuleDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BankRuleDTO[], ApiError>({
    queryKey: [KEY, "rules"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/bank-statements/rules");
      if (!res.ok) throw await loaderError(res, t("bankRecX.rulesLoadFailed"), t);
      return res.json<BankRuleDTO[]>();
    },
  });
}

function useBankRecMutation<TBody, TResult>(
  path: (body: TBody) => string,
  method: "POST" | "PUT" | "DELETE",
  payload: (body: TBody) => unknown,
  fallbackKey: Parameters<ReturnType<typeof useAppTranslation>["t"]>[0],
) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: async (body) => {
      const res = await request(path(body), { method, body: JSON.stringify(payload(body) ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t(fallbackKey), t));
      return res.json<TResult>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useSuggestMatches() {
  return useBankRecMutation<string, AutoMatchResultDTO>((id) => `/bank-statements/${id}/auto-match`, "POST", () => ({}), "bankRecX.suggestFailed");
}

export function useAcceptSuggestion() {
  return useBankRecMutation<{ statementId: string; suggestionId: string }, StatementLineDTO>(
    ({ statementId, suggestionId }) => `/bank-statements/${statementId}/suggestions/${suggestionId}/accept`,
    "POST",
    () => ({}),
    "bankRecX.acceptFailed",
  );
}

export function useRejectSuggestion() {
  return useBankRecMutation<{ statementId: string; suggestionId: string }, { id: string; status: string }>(
    ({ statementId, suggestionId }) => `/bank-statements/${statementId}/suggestions/${suggestionId}/reject`,
    "POST",
    () => ({}),
    "bankRecX.rejectFailed",
  );
}

export function useMatchManyEntries() {
  return useBankRecMutation<{ statementId: string; lineId: string; entryIds: readonly string[] }, StatementLineDTO>(
    ({ statementId, lineId }) => `/bank-statements/${statementId}/lines/${lineId}/match-many`,
    "POST",
    ({ entryIds }) => ({ entryIds }),
    "bankRecX.matchFailed",
  );
}

export function useCreateEntryFromLine() {
  return useBankRecMutation<{ statementId: string; lineId: string; body: CreateEntryFromLineDTO }, CreateEntryResultDTO>(
    ({ statementId, lineId }) => `/bank-statements/${statementId}/lines/${lineId}/create-entry`,
    "POST",
    ({ body }) => body,
    "bankRecX.createEntryFailed",
  );
}

export function useFinalizeStatement() {
  return useBankRecMutation<{ statementId: string; force?: boolean; reason?: string }, BankStatementDTO>(
    ({ statementId }) => `/bank-statements/${statementId}/finalize`,
    "POST",
    ({ force, reason }) => (force ? { force: true, reason } : {}),
    "bankRecX.finalizeFailed",
  );
}

export function useImportStatementFile() {
  return useBankRecMutation<ImportStatementFileDTO, BankStatementDTO>(() => "/bank-statements/import-file", "POST", (body) => body, "bankRecX.importFailed");
}

export function useCreateBankRule() {
  return useBankRecMutation<{ body: BankRuleInputDTO }, BankRuleDTO>(
    () => "/bank-statements/rules",
    "POST",
    ({ body }) => body,
    "bankRecX.ruleSaveFailed",
  );
}

export function useUpdateBankRule() {
  return useBankRecMutation<{ id: string; body: BankRuleInputDTO }, BankRuleDTO>(
    ({ id }) => `/bank-statements/rules/${id}`,
    "PUT",
    ({ body }) => body,
    "bankRecX.ruleSaveFailed",
  );
}

export function useDeleteBankRule() {
  return useBankRecMutation<string, { deleted: boolean }>((id) => `/bank-statements/rules/${id}`, "DELETE", () => ({}), "bankRecX.ruleDeleteFailed");
}
