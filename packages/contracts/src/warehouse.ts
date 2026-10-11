import { z } from "zod";

/** The warehouse types (docs/archive/catalog/09 §"إدارة المستودعات" + SITE for المقاولات). Duplicated here
 *  (rather than imported from @mezan/domain) because @mezan/contracts has no
 *  runtime dependency on domain — see packages/contracts/src/index.ts header. */
export const warehouseTypeSchema = z.enum(["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN", "SITE"]);

/** Wire contract for a warehouse. */
export const warehouseSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().min(1),
  nameEn: z.string().nullable(),
  branchId: z.string().min(1),
  type: warehouseTypeSchema,
  isDefault: z.boolean(),
  active: z.boolean(),
  /** مستودع الموقع — required for type SITE, null otherwise. */
  projectId: z.string().nullable(),
  /** أمين عهدة الموقع — required for type SITE, null otherwise. */
  custodianUserId: z.string().nullable(),
});

/** POST /warehouses body. */
export const createWarehouseSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  branchId: z.string().min(1),
  type: warehouseTypeSchema.optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  custodianUserId: z.string().nullable().optional(),
});

/** PUT /warehouses/:id body — every field but id optional. */
export const updateWarehouseSchema = warehouseSchema.omit({ id: true }).partial();

export type WarehouseTypeDTO = z.infer<typeof warehouseTypeSchema>;
export type WarehouseDTO = z.infer<typeof warehouseSchema>;

/** GET /warehouses/lookup — what a warehouse picker needs, for the warehouses the session was granted. */
export const warehouseLookupSchema = warehouseSchema.pick({ id: true, code: true, name: true, nameEn: true, branchId: true, type: true, isDefault: true, active: true });
export type WarehouseLookupDTO = z.infer<typeof warehouseLookupSchema>;
export type CreateWarehouseDTO = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseDTO = z.infer<typeof updateWarehouseSchema>;
