import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { CreateLabelLayoutDTO, LabelLayoutDTO, UpdateLabelLayoutDTO } from "@mezan/contracts";
import { ApiError } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/** تخطيطات الملصقات — label layouts (docs/catalog/03, /label-layouts). */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

export function useLabelLayouts(): UseQueryResult<LabelLayoutDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LabelLayoutDTO[], ApiError>({
    queryKey: ["label-layouts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/label-layouts");
      if (!res.ok) throw new ApiError(res.status, t("labelApi.theLabelLayoutsCouldNot"));
      return res.json<LabelLayoutDTO[]>();
    },
  });
}

export function useCreateLabelLayout() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LabelLayoutDTO, ApiError, CreateLabelLayoutDTO>({
    mutationFn: async (body) => {
      const res = await request("/label-layouts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("labelApi.theLabelLayoutCouldNot")));
      return res.json<LabelLayoutDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["label-layouts"] }),
  });
}

export function useUpdateLabelLayout() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LabelLayoutDTO, ApiError, { id: string; body: UpdateLabelLayoutDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/label-layouts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("labelApi.theLabelLayoutCouldNot2")));
      return res.json<LabelLayoutDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["label-layouts"] }),
  });
}
