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

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/* -------------------------------------------------------------------- */
/* وحدات القياس — Units of measure (docs/catalog/03)                      */
/* -------------------------------------------------------------------- */

export function useItemUnits(): UseQueryResult<ItemUnitDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemUnitDTO[], ApiError>({
    queryKey: ["item-units"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-units");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل وحدات القياس.");
      return res.json<ItemUnitDTO[]>();
    },
  });
}

export function useCreateItemUnit() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemUnitDTO, ApiError, CreateItemUnitDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-units", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر إضافة وحدة القياس."));
      return res.json<ItemUnitDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-units"] }),
  });
}

/* -------------------------------------------------------------------- */
/* تصنيفات الأصناف — Item categories (docs/catalog/03)                    */
/* -------------------------------------------------------------------- */

export function useItemCategories(): UseQueryResult<ItemCategoryDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemCategoryDTO[], ApiError>({
    queryKey: ["item-categories"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-categories");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تصنيفات الأصناف.");
      return res.json<ItemCategoryDTO[]>();
    },
  });
}

export function useCreateItemCategory() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemCategoryDTO, ApiError, CreateItemCategoryDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-categories", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر إضافة التصنيف."));
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

export function categoryLabel(categories: readonly ItemCategoryDTO[], id: string | null): string {
  if (!id) return "بدون تصنيف";
  return categories.find((c) => c.id === id)?.nameAr ?? id;
}

/* -------------------------------------------------------------------- */
/* المواصفات — the reusable specification registry                        */
/* -------------------------------------------------------------------- */

export function useItemSpecifications(): UseQueryResult<ItemSpecificationDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemSpecificationDTO[], ApiError>({
    queryKey: ["item-specifications"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-specifications");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المواصفات.");
      return res.json<ItemSpecificationDTO[]>();
    },
  });
}

export function useCreateItemSpecification() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemSpecificationDTO, ApiError, CreateItemSpecificationDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-specifications", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر إضافة المواصفة."));
      return res.json<ItemSpecificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-specifications"] }),
  });
}

export function useUpdateItemSpecification() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemSpecificationDTO, ApiError, { code: string; patch: UpdateItemSpecificationDTO }>({
    mutationFn: async ({ code, patch }) => {
      const res = await request(`/item-specifications/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر تعديل المواصفة."));
      return res.json<ItemSpecificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-specifications"] }),
  });
}

export function useDeleteItemSpecification() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (code) => {
      const res = await request(`/item-specifications/${encodeURIComponent(code)}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر حذف المواصفة."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-specifications"] }),
  });
}
