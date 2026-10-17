import { z } from "zod";
import { sodAcknowledgeFields } from "../sod.js";

export const USER_IMPORT_MAX_CSV_CHARS = 200_000;

export const roleTemplateSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  descriptionAr: z.string(),
  descriptionEn: z.string(),
  permissions: z.array(z.string()),
  omittedPermissions: z.array(z.string()),
});
export type RoleTemplateDTO = z.infer<typeof roleTemplateSchema>;

export const createRoleFromTemplateSchema = z.object({
  templateId: z.string().trim().min(1),
  code: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});
export type CreateRoleFromTemplateDTO = z.infer<typeof createRoleFromTemplateSchema>;

export const roleFromTemplateResultSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  createdAt: z.string(),
  templateId: z.string(),
  omittedPermissions: z.array(z.string()),
});
export type RoleFromTemplateResultDTO = z.infer<typeof roleFromTemplateResultSchema>;

export const importUsersSchema = z.object({
  csv: z.string().max(USER_IMPORT_MAX_CSV_CHARS),
  dryRun: z.boolean().default(true),
  digest: z.string().trim().min(1).optional(),
  ...sodAcknowledgeFields,
});
export type ImportUsersDTO = z.infer<typeof importUsersSchema>;

export enum UserImportRowStatusDTO {
  Ok = "ok",
  Error = "error",
}

export const userImportProblemSchema = z.object({
  code: z.string(),
  column: z.string().optional(),
  messageAr: z.string(),
  messageEn: z.string(),
});
export type UserImportProblemDTO = z.infer<typeof userImportProblemSchema>;

export const userImportRowResultSchema = z.object({
  rowNumber: z.number().int(),
  email: z.string(),
  nameAr: z.string(),
  roleCode: z.string(),
  status: z.nativeEnum(UserImportRowStatusDTO),
  problems: z.array(userImportProblemSchema),
});
export type UserImportRowResultDTO = z.infer<typeof userImportRowResultSchema>;

export const userImportSeatsSchema = z.object({
  limit: z.number().int().nullable(),
  active: z.number().int(),
  available: z.number().int().nullable(),
});

export const oneTimeCredentialSchema = z.object({
  rowNumber: z.number().int().nullable(),
  userId: z.string(),
  email: z.string(),
  nameAr: z.string(),
  pin: z.string(),
  password: z.string(),
});
export type OneTimeCredentialDTO = z.infer<typeof oneTimeCredentialSchema>;

export const userImportReportSchema = z.object({
  dryRun: z.boolean(),
  digest: z.string().nullable(),
  fileProblems: z.array(userImportProblemSchema),
  rows: z.array(userImportRowResultSchema),
  summary: z.object({ total: z.number().int(), valid: z.number().int(), invalid: z.number().int() }),
  seats: userImportSeatsSchema,
  created: z.number().int(),
  credentials: z.array(oneTimeCredentialSchema),
});
export type UserImportReportDTO = z.infer<typeof userImportReportSchema>;

export const cloneUserSchema = z.object({
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1).nullable().default(null),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(1).nullable().default(null),
  ...sodAcknowledgeFields,
});
export type CloneUserDTO = z.infer<typeof cloneUserSchema>;

export const cloneUserResultSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), nameAr: z.string(), roleId: z.string().nullable() }),
  preferencesCopied: z.boolean(),
  credentials: oneTimeCredentialSchema,
});
export type CloneUserResultDTO = z.infer<typeof cloneUserResultSchema>;
