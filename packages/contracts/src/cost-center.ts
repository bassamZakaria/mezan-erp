import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/** Wire contract for cost centers (docs/archive/catalog/04 "مراكز التكلفة"). */
export const costCenterTypeSchema = z.enum(["general", "department", "project", "branch"]);
export const costCenterStatusSchema = z.enum(["active", "inactive"]);

export const costCenterSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  type: costCenterTypeSchema,
  departmentId: z.string().nullable(),
  branchId: z.string().nullable(),
  parentId: z.string().nullable(),
  notes: z.string().nullable(),
  status: costCenterStatusSchema,
});

export const createCostCenterSchema = z.object({
  id: clientSuppliedId,
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: costCenterTypeSchema.optional(),
  departmentId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/** All fields optional — a PATCH applies only what's supplied. */
export const updateCostCenterSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  type: costCenterTypeSchema.optional(),
  departmentId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: costCenterStatusSchema.optional(),
});

export type CostCenterTypeDTO = z.infer<typeof costCenterTypeSchema>;
export type CostCenterStatusDTO = z.infer<typeof costCenterStatusSchema>;
export type CostCenterDTO = z.infer<typeof costCenterSchema>;
export type CreateCostCenterDTO = z.infer<typeof createCostCenterSchema>;
export type UpdateCostCenterDTO = z.infer<typeof updateCostCenterSchema>;

/** GET /cost-centers/importable-departments — departments with no cost centre yet (R6.7). */
export const importableDepartmentSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string(),
  nameAr: z.string().nullable(),
  /** The cost-centre code this department would take. */
  suggestedCode: z.string().min(1),
  /** True when that code is already used by an unrelated cost centre. */
  codeInUse: z.boolean(),
});

/** POST /cost-centers/from-departments — إنشاء من الأقسام. */
export const createCostCentersFromDepartmentsSchema = z.object({
  /** Omit or leave empty to import every department that has no cost centre. */
  departmentIds: z.array(z.string().min(1)).optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export type ImportableDepartmentDTO = z.infer<typeof importableDepartmentSchema>;
export type CreateCostCentersFromDepartmentsDTO = z.infer<typeof createCostCentersFromDepartmentsSchema>;
