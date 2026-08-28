import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ProfileDTO,
  UpdateProfileDTO,
  ChangePasswordDTO,
  ChangePinDTO,
  AuditEventDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/**
 * Self-service profile hooks — kept out of `data/hooks.ts` but following the
 * exact same pattern: a typed TanStack Query hook per endpoint, real
 * loading/error/empty states, mutations invalidate their query key.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

// --- الملف الشخصي (self-service profile) ---

export function useProfile(): UseQueryResult<ProfileDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProfileDTO, ApiError>({
    queryKey: ["profile"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/profile");
      if (!res.ok) throw new ApiError(res.status, t("accountApi.theProfileCouldNotBe"));
      return res.json<ProfileDTO>();
    },
  });
}

export function useUpdateProfile() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProfileDTO, ApiError, UpdateProfileDTO>({
    mutationFn: async (body) => {
      const res = await request("/profile", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("accountApi.theProfileCouldNotBe2")));
      return res.json<ProfileDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useChangePassword() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<void, ApiError, ChangePasswordDTO>({
    mutationFn: async (body) => {
      const res = await request("/profile/change-password", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("profile.couldNotChangeThePassword")));
    },
  });
}

export function useChangePin() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<void, ApiError, ChangePinDTO>({
    mutationFn: async (body) => {
      const res = await request("/profile/change-pin", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("profile.couldNotChangeThePin")));
    },
  });
}

export function useProfileActivity(): UseQueryResult<AuditEventDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AuditEventDTO[], ApiError>({
    queryKey: ["profile", "activity"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/profile/activity");
      if (!res.ok) throw new ApiError(res.status, t("accountApi.theActivityLogCouldNot"));
      return res.json<AuditEventDTO[]>();
    },
  });
}
