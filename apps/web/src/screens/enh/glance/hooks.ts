import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GlanceDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

export const GLANCE_KEY = "glance";

export function useGlance(branchId: string): UseQueryResult<GlanceDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<GlanceDTO, ApiError>({
    queryKey: [GLANCE_KEY, branchId],
    enabled: session !== null,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const res = await request(`/dashboard/glance${qs}`);
      if (!res.ok) throw await loaderError(res, t("glance.loadFailed"), t);
      return res.json<GlanceDTO>();
    },
  });
}
