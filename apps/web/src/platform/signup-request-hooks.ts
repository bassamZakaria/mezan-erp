import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ApproveSignupRequestDTO, ProvisionResultDTO, SignupModeCode, SignupRequestDTO, SignupStatusDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";

const SIGNUP_REQUESTS_KEY = ["platform", "signup-requests"] as const;
const SIGNUP_MODE_KEY = ["platform", "signup-mode"] as const;

export function useSignupRequestsQuery(): UseQueryResult<SignupRequestDTO[], PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<SignupRequestDTO[], PlatformApiError>({
    queryKey: SIGNUP_REQUESTS_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/signup-requests");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.signupRequests.loadFailed"));
      return res.json<SignupRequestDTO[]>();
    },
  });
}

export function useApproveSignupMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<ProvisionResultDTO, PlatformApiError, { id: string; body: ApproveSignupRequestDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/signup-requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.signupRequests.approveFailed"));
      return res.json<ProvisionResultDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SIGNUP_REQUESTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
    },
  });
}

export function useRejectSignupMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<void, PlatformApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/signup-requests/${encodeURIComponent(id)}/reject`, { method: "POST" });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.signupRequests.rejectFailed"));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SIGNUP_REQUESTS_KEY }),
  });
}

export function useSignupModeQuery(): UseQueryResult<SignupStatusDTO, PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<SignupStatusDTO, PlatformApiError>({
    queryKey: SIGNUP_MODE_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/settings/signup-mode");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.signupRequests.loadFailed"));
      return res.json<SignupStatusDTO>();
    },
  });
}

export function useSetSignupModeMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<SignupStatusDTO, PlatformApiError, SignupModeCode>({
    mutationFn: async (mode) => {
      const res = await request("/settings/signup-mode", { method: "PUT", body: JSON.stringify({ mode }) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.signupRequests.modeFailed"));
      return res.json<SignupStatusDTO>();
    },
    onSuccess: (status) => queryClient.setQueryData(SIGNUP_MODE_KEY, status),
  });
}
