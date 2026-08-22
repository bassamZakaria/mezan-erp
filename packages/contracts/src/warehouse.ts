import { z } from "zod";

/** The 5 warehouse types (docs/catalog/09 §"إدارة المستودعات"). Duplicated here
 *  (rather than imported from @mezan/domain) because @mezan/contracts has no
 *  runtime dependency on domain — see packages/contracts/src/index.ts header. */
export const warehouseTypeSchema = z.enum(["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN"]);

/** Wire contract for a warehouse. */
export const warehouseSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().min(1),
  branchId: z.string().min(1),
  type: warehouseTypeSchema,
  isDefault: z.boolean(),
  active: z.boolean(),
});

/** POST /warehouses body. */
export const createWarehouseSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().min(1),
  branchId: z.string().min(1),
  type: warehouseTypeSchema.optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** PUT /warehouses/:id body — every field but id optional. */
export const updateWarehouseSchema = warehouseSchema.omit({ id: true }).partial();

export type WarehouseTypeDTO = z.infer<typeof warehouseTypeSchema>;
export type WarehouseDTO = z.infer<typeof warehouseSchema>;
export type CreateWarehouseDTO = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseDTO = z.infer<typeof updateWarehouseSchema>;
