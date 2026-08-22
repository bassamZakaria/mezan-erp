import { z } from "zod";
import { scopeSelectionSchema } from "./roles.js";

export const userStatusSchema = z.enum(["active", "inactive"]);

const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

/** Wire shape returned to clients — secrets never cross this boundary. */
export const userSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().nullable(),
  roleId: z.string().nullable(),
  isCompanyAdmin: z.boolean(),
  employeeId: z.string().nullable(),
  branchScope: scopeSelectionSchema,
  warehouseScope: scopeSelectionSchema,
  status: userStatusSchema,
  hasPin: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

const userBaseFields = {
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).nullable().default(null),
  roleId: z.string().min(1).nullable(),
  isCompanyAdmin: z.boolean(),
  employeeId: z.string().min(1).nullable().default(null),
  branchScope: scopeSelectionSchema,
  warehouseScope: scopeSelectionSchema,
  status: userStatusSchema.default("active"),
};

export const createUserSchema = z
  .object({
    ...userBaseFields,
    password: z.string().min(8, "Password must be at least 8 characters"),
    pin: pinSchema.nullable().optional(),
  })
  .refine((v) => v.isCompanyAdmin !== (v.roleId !== null), {
    message: "Provide exactly one of: roleId, or isCompanyAdmin",
    path: ["roleId"],
  });

export const updateUserSchema = z
  .object({
    ...userBaseFields,
    password: z.string().min(8, "Password must be at least 8 characters").optional(),
    pin: pinSchema.nullable().optional(),
  })
  .refine((v) => v.isCompanyAdmin !== (v.roleId !== null), {
    message: "Provide exactly one of: roleId, or isCompanyAdmin",
    path: ["roleId"],
  });

export type UserDTO = z.infer<typeof userSchema>;
export type UserStatusDTO = z.infer<typeof userStatusSchema>;
export type CreateUserDTO = z.infer<typeof createUserSchema>;
export type UpdateUserDTO = z.infer<typeof updateUserSchema>;
