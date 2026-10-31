import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CloneUserDTO,
  CloneUserResultDTO,
  CreateRoleFromTemplateDTO,
  ImportUsersDTO,
  RoleFromTemplateResultDTO,
  RoleTemplateDTO,
  UserImportReportDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError, readError, serverMessage, type ServerErrorBody } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const TEMPLATES_KEY = ["role-templates"] as const;

export function useRoleTemplates(): UseQueryResult<RoleTemplateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RoleTemplateDTO[], ApiError>({
    queryKey: TEMPLATES_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/roles/templates");
      if (!res.ok) throw await loaderError(res, t("provisioning.templates.couldNotLoad"), t);
      return res.json<RoleTemplateDTO[]>();
    },
  });
}

export function useCreateRoleFromTemplate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RoleFromTemplateResultDTO, ApiError, CreateRoleFromTemplateDTO>({
    mutationFn: async (body) => {
      const res = await request("/roles/from-template", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("provisioning.templates.createFailed"), t));
      return res.json<RoleFromTemplateResultDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

interface ImportRefusalBody extends Partial<UserImportReportDTO>, ServerErrorBody {}

export function useImportUsers() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserImportReportDTO, ApiError, ImportUsersDTO>({
    gcTime: 0,
    mutationFn: async (body) => {
      const res = await request("/users/import", { method: "POST", body: JSON.stringify(body) });
      const payload = await res.json<ImportRefusalBody>().catch((): ImportRefusalBody => ({}));
      if (res.ok || (res.status === 422 && Array.isArray(payload.rows))) return payload as UserImportReportDTO;
      throw new ApiError(res.status, serverMessage(payload) ?? t("provisioning.import.failed"), undefined, undefined, payload.error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useCloneUser() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CloneUserResultDTO, ApiError, { sourceId: string; body: CloneUserDTO }>({
    gcTime: 0,
    mutationFn: async ({ sourceId, body }) => {
      const res = await request(`/users/${encodeURIComponent(sourceId)}/clone`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const payload = await res.json<ServerErrorBody>().catch(() => ({}) as ServerErrorBody);
        throw new ApiError(res.status, serverMessage(payload) ?? t("provisioning.clone.failed"), undefined, undefined, payload.error);
      }
      return res.json<CloneUserResultDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
