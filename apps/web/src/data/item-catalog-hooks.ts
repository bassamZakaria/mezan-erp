import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateItemCategoryDTO,
  CreateItemSpecificationDTO,
  CreateItemUnitDTO,
  ItemCategoryDTO,
  ItemSpecificationDTO,
  ItemUnitDTO,
  UpdateItemSpecificationDTO,
} from "@mezan/contracts";
import { ApiError } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/* -------------------------------------------------------------------- */
/* وحدات القياس — Units of measure (docs/catalog/03)                      */
/* -------------------------------------------------------------------- */

export function useItemUnits(): UseQueryResult<ItemUnitDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemUnitDTO[], ApiError>({
    queryKey: ["item-units"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-units");
      if (!res.ok) throw new ApiError(res.status, t("api.unitsOfMeasureCouldNot"));
      return res.json<ItemUnitDTO[]>();
    },
  });
}

export function useCreateItemUnit() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemUnitDTO, ApiError, CreateItemUnitDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-units", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theUnitOfMeasureCould")));
      return res.json<ItemUnitDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-units"] }),
  });
}

/* -------------------------------------------------------------------- */
/* تصنيفات الأصناف — Item categories (docs/catalog/03)                    */
/* -------------------------------------------------------------------- */

export function useItemCategories(): UseQueryResult<ItemCategoryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemCategoryDTO[], ApiError>({
    queryKey: ["item-categories"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-categories");
      if (!res.ok) throw new ApiError(res.status, t("api.itemCategoriesCouldNotBe"));
      return res.json<ItemCategoryDTO[]>();
    },
  });
}

export function useCreateItemCategory() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemCategoryDTO, ApiError, CreateItemCategoryDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-categories", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theCategoryCouldNotBe")));
      return res.json<ItemCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-categories"] }),
  });
}

/* -------------------------------------------------------------------- */
/* Label helpers — resolve a wire code/id against a loaded catalog.       */
/* -------------------------------------------------------------------- */

/** Falls back to the raw code so a line still reads correctly while the catalog loads. */
export function unitLabel(units: readonly ItemUnitDTO[], code: string): string {
  return units.find((u) => u.code === code)?.nameAr ?? code;
}

export function categoryLabel(categories: readonly ItemCategoryDTO[], id: string | null, uncategorized: string): string {
  if (!id) return uncategorized;
  return categories.find((c) => c.id === id)?.nameAr ?? id;
}

/* -------------------------------------------------------------------- */
/* المواصفات — the reusable specification registry                        */
/* -------------------------------------------------------------------- */

export function useItemSpecifications(): UseQueryResult<ItemSpecificationDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemSpecificationDTO[], ApiError>({
    queryKey: ["item-specifications"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-specifications");
      if (!res.ok) throw new ApiError(res.status, t("specs.specificationsCouldNotBeLoaded"));
      return res.json<ItemSpecificationDTO[]>();
    },
  });
}

export function useCreateItemSpecification() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemSpecificationDTO, ApiError, CreateItemSpecificationDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-specifications", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("catalogApi.theSpecificationCouldNotBe")));
      return res.json<ItemSpecificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-specifications"] }),
  });
}

export function useUpdateItemSpecification() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemSpecificationDTO, ApiError, { code: string; patch: UpdateItemSpecificationDTO }>({
    mutationFn: async ({ code, patch }) => {
      const res = await request(`/item-specifications/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("catalogApi.theSpecificationCouldNotBe2")));
      return res.json<ItemSpecificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-specifications"] }),
  });
}

export function useDeleteItemSpecification() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (code) => {
      const res = await request(`/item-specifications/${encodeURIComponent(code)}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("specs.theSpecificationCouldNotBe")));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-specifications"] }),
  });
}
