import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CustomerDTO,
  CreatePosPaymentMethodDTO,
  CreatePosTerminalDTO,
  CreateShiftTemplateDTO,
  PosPaymentMethodDTO,
  PosSettingsDTO,
  PosTerminalDTO,
  ShiftTemplateDTO,
  UpdatePosPaymentMethodDTO,
  UpdatePosSettingsDTO,
  UpdatePosTerminalDTO,
  UpdateShiftTemplateDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { readServerMessage } from "../../../data/server-message";

const TERMINALS = ["pos", "terminals"] as const;
const METHODS = ["pos", "payment-methods"] as const;
const SETTINGS = ["pos", "settings"] as const;
const SHIFTS = ["shift-templates"] as const;

function useList<T>(key: readonly unknown[], path: string): UseQueryResult<T, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<T, ApiError>({
    queryKey: key,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(path);
      if (!res.ok) throw await loaderError(res, t("pos.common.loadFailed"), t);
      return res.json<T>();
    },
  });
}

function useWrite<Body, Result>(invalidate: readonly (readonly unknown[])[], send: (body: Body) => { path: string; method: string; payload?: unknown }) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<Result, ApiError, Body>({
    mutationFn: async (body) => {
      const { path, method, payload } = send(body);
      const res = await request(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("pos.common.saveFailed")));
      return res.status === 204 ? (undefined as Result) : res.json<Result>();
    },
    onSettled: () => Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

export function usePosTerminals(): UseQueryResult<PosTerminalDTO[], ApiError> {
  return useList<PosTerminalDTO[]>([...TERMINALS, "list"], "/pos/terminals");
}

export function useCreatePosTerminal() {
  return useWrite<CreatePosTerminalDTO, PosTerminalDTO>([TERMINALS, METHODS], (body) => ({ path: "/pos/terminals", method: "POST", payload: body }));
}

export function useUpdatePosTerminal() {
  return useWrite<{ id: string; body: UpdatePosTerminalDTO }, PosTerminalDTO>([TERMINALS, METHODS], ({ id, body }) => ({
    path: `/pos/terminals/${encodeURIComponent(id)}`,
    method: "PUT",
    payload: body,
  }));
}

export function usePosPaymentMethods(): UseQueryResult<PosPaymentMethodDTO[], ApiError> {
  return useList<PosPaymentMethodDTO[]>([...METHODS, "list"], "/pos/payment-methods");
}

export function useCreatePosPaymentMethod() {
  return useWrite<CreatePosPaymentMethodDTO, PosPaymentMethodDTO>([METHODS], (body) => ({ path: "/pos/payment-methods", method: "POST", payload: body }));
}

export function useUpdatePosPaymentMethod() {
  return useWrite<{ id: string; body: UpdatePosPaymentMethodDTO }, PosPaymentMethodDTO>([METHODS, TERMINALS], ({ id, body }) => ({
    path: `/pos/payment-methods/${encodeURIComponent(id)}`,
    method: "PUT",
    payload: body,
  }));
}

export function useDeletePosPaymentMethod() {
  return useWrite<{ id: string }, void>([METHODS], ({ id }) => ({ path: `/pos/payment-methods/${encodeURIComponent(id)}`, method: "DELETE" }));
}

export function usePosSettings(): UseQueryResult<PosSettingsDTO, ApiError> {
  return useList<PosSettingsDTO>([...SETTINGS], "/pos/settings");
}

export function usePosWalkInCustomer(id: string | null): UseQueryResult<CustomerDTO, ApiError> {
  return useList<CustomerDTO>(["customers", "one", id], `/customers/${encodeURIComponent(id ?? "")}`);
}

export function useUpdatePosSettings() {
  return useWrite<UpdatePosSettingsDTO, PosSettingsDTO>([SETTINGS], (body) => ({ path: "/pos/settings", method: "PUT", payload: body }));
}

export function useShiftTemplates(): UseQueryResult<ShiftTemplateDTO[], ApiError> {
  return useList<ShiftTemplateDTO[]>([...SHIFTS, "list"], "/shift-templates");
}

export function useCreateShiftTemplate() {
  return useWrite<CreateShiftTemplateDTO, ShiftTemplateDTO>([SHIFTS], (body) => ({ path: "/shift-templates", method: "POST", payload: body }));
}

export function useUpdateShiftTemplate() {
  return useWrite<{ id: string; body: UpdateShiftTemplateDTO }, ShiftTemplateDTO>([SHIFTS], ({ id, body }) => ({
    path: `/shift-templates/${encodeURIComponent(id)}`,
    method: "PUT",
    payload: body,
  }));
}
