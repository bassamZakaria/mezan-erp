import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ApproveVanTripResponseDTO, VanTripExpectationDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError, readError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const expectationKey = (tripId: string) => ["van-trips", tripId, "expected"] as const;

export function useVanTripExpectation(tripId: string | null, enabled: boolean): UseQueryResult<VanTripExpectationDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<VanTripExpectationDTO, ApiError>({
    queryKey: expectationKey(tripId ?? ""),
    enabled: enabled && tripId !== null && session !== null,
    queryFn: async () => {
      const res = await request(`/field/van-trips/${tripId}/expected`);
      if (!res.ok) throw await loaderError(res, t("vanRecon.expectedCouldNotLoad"), t);
      return res.json<VanTripExpectationDTO>();
    },
  });
}

export function useApproveVanTrip() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApproveVanTripResponseDTO, ApiError, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await request(`/field/van-trips/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("vanRecon.approveFailed"), t));
      return res.json<ApproveVanTripResponseDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}
