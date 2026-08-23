import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateItemSpecificationDTO,
  CreateProductTemplateDTO,
  ItemSpecificationDTO,
  ProductTemplateDTO,
  UpdateItemSpecificationDTO,
} from "@mezan/contracts";
import { ApiError } from "./hooks";
import { useApi } from "./ApiContext";

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

const SPECIFICATIONS_KEY = ["item-specifications"];
const TEMPLATES_KEY = ["product-templates"];

/* -------------------------------------------------------------------- */
/* المواصفات — Specification registry                                     */
/* -------------------------------------------------------------------- */

export function useItemSpecifications(): UseQueryResult<ItemSpecificationDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemSpecificationDTO[], ApiError>({
    queryKey: SPECIFICATIONS_KEY,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPECIFICATIONS_KEY }),
  });
}

export function useUpdateItemSpecification() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemSpecificationDTO, ApiError, { id: string; patch: UpdateItemSpecificationDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/item-specifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر تعديل المواصفة."));
      return res.json<ItemSpecificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPECIFICATIONS_KEY }),
  });
}

export function useDeleteItemSpecification() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/item-specifications/${id}`, { method: "DELETE" });
      // 204 No Content on success — the body is empty, never parse it as JSON.
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر حذف المواصفة."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPECIFICATIONS_KEY }),
  });
}

/* -------------------------------------------------------------------- */
/* قوالب المنتجات — Product templates (منتجات بخيارات)                     */
/* -------------------------------------------------------------------- */

export function useProductTemplates(): UseQueryResult<ProductTemplateDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ProductTemplateDTO[], ApiError>({
    queryKey: TEMPLATES_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/product-templates");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قوالب المنتجات.");
      return res.json<ProductTemplateDTO[]>();
    },
  });
}

export function useCreateProductTemplate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, CreateProductTemplateDTO>({
    mutationFn: async (body) => {
      const res = await request("/product-templates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر إضافة القالب."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

/** Materialises the matrix into real catalog items — so the item list is stale too. */
export function useGenerateProductTemplateVariants() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/product-templates/${id}/generate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر توليد المتغيرات."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useSetProductTemplateVariantPrice() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { id: string; sku: string; salePrice: string | null }>({
    mutationFn: async ({ id, sku, salePrice }) => {
      const res = await request(`/product-templates/${id}/variants/${encodeURIComponent(sku)}`, {
        method: "PATCH",
        body: JSON.stringify({ salePrice }),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر تعديل سعر المتغير."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useDeleteProductTemplate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/product-templates/${id}`, { method: "DELETE" });
      // 204 No Content on success — the body is empty, never parse it as JSON.
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر حذف القالب."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

/** Falls back to the raw id so a row still reads correctly while the registry loads. */
export function specificationLabel(
  specifications: readonly ItemSpecificationDTO[],
  id: string,
): string {
  return specifications.find((s) => s.id === id)?.nameAr ?? id;
}
