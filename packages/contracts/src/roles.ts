import { z } from "zod";

/** `"*"` (all) or an explicit allow-list of branch/warehouse ids. */
export const scopeSelectionSchema = z.union([z.literal("*"), z.array(z.string().min(1))]);

export const roleSchema = z.object({
  id: z.string().min(1),
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, "Role code must be upper-snake-case (e.g. VAN_SALES)"),
  name: z.string().min(1),
  description: z.string().default(""),
  permissions: z.array(z.string().min(1)),
  isSystem: z.boolean(),
  createdAt: z.string(),
});

export const createRoleSchema = z.object({
  code: roleSchema.shape.code,
  name: roleSchema.shape.name,
  description: z.string().default(""),
  permissions: z.array(z.string().min(1)).default([]),
});

export const updateRoleSchema = createRoleSchema;

export type ScopeSelectionDTO = z.infer<typeof scopeSelectionSchema>;
export type RoleDTO = z.infer<typeof roleSchema>;
export type CreateRoleDTO = z.infer<typeof createRoleSchema>;
export type UpdateRoleDTO = z.infer<typeof updateRoleSchema>;
