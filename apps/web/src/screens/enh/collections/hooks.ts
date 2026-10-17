import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CollectionActivityDTO,
  CollectionHoldDTO,
  CollectionHoldInputDTO,
  CollectionNoteDTO,
  CollectionsDrainResultDTO,
  CollectionsOutboxDTO,
  CollectionsWorklistDTO,
  CreatePromiseToPayDTO,
  CustomerCollectionsDTO,
  DunningPolicyDTO,
  DunningReminderDTO,
  DunningRunRequestDTO,
  DunningRunResultDTO,
  EvaluatedPromiseDTO,
  SendReminderResultDTO,
  SendStatementDTO,
  SendStatementResultDTO,
  UpdateDunningPolicyDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";

const ROOT = ["collections"] as const;
const WORKLIST_KEY = [...ROOT, "worklist"] as const;
const POLICY_KEY = [...ROOT, "policy"] as const;
const REMINDERS_KEY = [...ROOT, "reminders"] as const;
const PROMISES_KEY = [...ROOT, "promises"] as const;
const OUTBOX_KEY = [...ROOT, "outbox"] as const;
const customerKey = (id: string) => [...ROOT, "customer", id] as const;

function useCollectionsRequest() {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return { t, request, enabled: session !== null };
}

export function useCollectionsWorklist(): UseQueryResult<CollectionsWorklistDTO, ApiError> {
  const { t, request, enabled } = useCollectionsRequest();
  return useQuery<CollectionsWorklistDTO, ApiError>({
    queryKey: WORKLIST_KEY,
    enabled,
    queryFn: async () => {
      const res = await request("/collections/worklist");
      if (!res.ok) throw await loaderError(res, t("collections.worklist.loadFailed"), t);
      return res.json<CollectionsWorklistDTO>();
    },
  });
}

export function useDunningPolicy(): UseQueryResult<DunningPolicyDTO, ApiError> {
  const { t, request, enabled } = useCollectionsRequest();
  return useQuery<DunningPolicyDTO, ApiError>({
    queryKey: POLICY_KEY,
    enabled,
    queryFn: async () => {
      const res = await request("/collections/policy");
      if (!res.ok) throw await loaderError(res, t("collections.policy.loadFailed"), t);
      return res.json<DunningPolicyDTO>();
    },
  });
}

export function useReminders(statuses: readonly string[]): UseQueryResult<DunningReminderDTO[], ApiError> {
  const { t, request, enabled } = useCollectionsRequest();
  const filter = statuses.join(",");
  return useQuery<DunningReminderDTO[], ApiError>({
    queryKey: [...REMINDERS_KEY, filter],
    enabled,
    queryFn: async () => {
      const res = await request(`/collections/reminders${filter ? `?status=${encodeURIComponent(filter)}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("collections.reminders.loadFailed"), t);
      return res.json<DunningReminderDTO[]>();
    },
  });
}

export function usePromises(): UseQueryResult<EvaluatedPromiseDTO[], ApiError> {
  const { t, request, enabled } = useCollectionsRequest();
  return useQuery<EvaluatedPromiseDTO[], ApiError>({
    queryKey: PROMISES_KEY,
    enabled,
    queryFn: async () => {
      const res = await request("/collections/promises");
      if (!res.ok) throw await loaderError(res, t("collections.promises.loadFailed"), t);
      return res.json<EvaluatedPromiseDTO[]>();
    },
  });
}

export function useCollectionsOutbox(): UseQueryResult<CollectionsOutboxDTO, ApiError> {
  const { t, request, enabled } = useCollectionsRequest();
  return useQuery<CollectionsOutboxDTO, ApiError>({
    queryKey: OUTBOX_KEY,
    enabled,
    queryFn: async () => {
      const res = await request("/collections/outbox");
      if (!res.ok) throw await loaderError(res, t("collections.outbox.loadFailed"), t);
      return res.json<CollectionsOutboxDTO>();
    },
  });
}

export function useCustomerCollections(customerId: string): UseQueryResult<CustomerCollectionsDTO, ApiError> {
  const { t, request, enabled } = useCollectionsRequest();
  return useQuery<CustomerCollectionsDTO, ApiError>({
    queryKey: customerKey(customerId),
    enabled,
    queryFn: async () => {
      const res = await request(`/collections/customers/${encodeURIComponent(customerId)}`);
      if (!res.ok) throw await loaderError(res, t("collections.customer.loadFailed"), t);
      return res.json<CustomerCollectionsDTO>();
    },
  });
}

function useCollectionsMutation<TBody, TResult>(
  path: (body: TBody) => string,
  method: string,
  failure: AppTranslationKey,
  hasBody = true,
) {
  const { t, request } = useCollectionsRequest();
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

export function useUpdateDunningPolicy() {
  return useCollectionsMutation<UpdateDunningPolicyDTO, DunningPolicyDTO>(() => "/collections/policy", "PUT", "collections.policy.saveFailed");
}

export function useRunDunning() {
  return useCollectionsMutation<DunningRunRequestDTO, DunningRunResultDTO>(() => "/collections/dunning-run", "POST", "collections.run.failed");
}

export function useSendReminder() {
  return useCollectionsMutation<{ id: string }, SendReminderResultDTO>(({ id }) => `/collections/reminders/${encodeURIComponent(id)}/send`, "POST", "collections.reminders.sendFailed", false);
}

export function useDismissReminder() {
  return useCollectionsMutation<{ id: string }, DunningReminderDTO>(({ id }) => `/collections/reminders/${encodeURIComponent(id)}/dismiss`, "POST", "collections.reminders.dismissFailed", false);
}

export function useDrainCollectionsOutbox() {
  return useCollectionsMutation<void, CollectionsDrainResultDTO>(() => "/collections/outbox/drain", "POST", "collections.outbox.drainFailed", false);
}

export function useCreatePromise() {
  return useCollectionsMutation<CreatePromiseToPayDTO, EvaluatedPromiseDTO>(() => "/collections/promises", "POST", "collections.promises.saveFailed");
}

export function useCancelPromise() {
  return useCollectionsMutation<{ id: string }, EvaluatedPromiseDTO>(({ id }) => `/collections/promises/${encodeURIComponent(id)}/cancel`, "POST", "collections.promises.cancelFailed", false);
}

export function useAddCollectionNote() {
  return useCollectionsMutation<CollectionNoteDTO & { customerId: string }, CollectionActivityDTO>(
    ({ customerId }) => `/collections/customers/${encodeURIComponent(customerId)}/notes`,
    "POST",
    "collections.notes.saveFailed",
  );
}

export function useSetCollectionHold() {
  return useCollectionsMutation<CollectionHoldInputDTO & { customerId: string }, CollectionHoldDTO>(
    ({ customerId }) => `/collections/customers/${encodeURIComponent(customerId)}/hold`,
    "PUT",
    "collections.hold.saveFailed",
  );
}

export function useLiftCollectionHold() {
  return useCollectionsMutation<{ customerId: string }, void>(
    ({ customerId }) => `/collections/customers/${encodeURIComponent(customerId)}/hold`,
    "DELETE",
    "collections.hold.liftFailed",
    false,
  );
}

export function useSendStatement() {
  return useCollectionsMutation<SendStatementDTO & { customerId: string }, SendStatementResultDTO>(
    ({ customerId }) => `/collections/customers/${encodeURIComponent(customerId)}/statement`,
    "POST",
    "collections.statement.failed",
  );
}

export function useSendCustomerReminders() {
  return useCollectionsMutation<SendStatementDTO & { customerId: string }, SendStatementResultDTO>(
    ({ customerId }) => `/collections/customers/${encodeURIComponent(customerId)}/send-reminders`,
    "POST",
    "collections.reminders.sendFailed",
  );
}
