import { z } from "zod";
import { PHOTO_MAX_CHARS } from "./users.js";

/** Wire shape for the self-service profile screen — no role/scope/status fields (admin-only, see `users.ts`). */
export const profileSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  email: z.string().email(),
  phone: z.string().nullable(),
  isCompanyAdmin: z.boolean(),
  roleId: z.string().nullable(),
  hasPin: z.boolean(),
  photoUrl: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const updateProfileSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1).nullable().default(null),
  email: z.string().email(),
  phone: z.string().min(1).nullable().default(null),
  /**
   * The profile photo as a `data:` URL, `null` to remove it. Bounded because
   * it is stored on the user row itself — see `PHOTO_MAX_CHARS`.
   */
  photoUrl: z.string().max(PHOTO_MAX_CHARS).nullable().default(null),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const changePinSchema = z.object({
  currentPassword: z.string().min(1),
  newPin: z
    .string()
    .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
    .nullable(),
});

export type ProfileDTO = z.infer<typeof profileSchema>;
export type UpdateProfileDTO = z.infer<typeof updateProfileSchema>;
export type ChangePasswordDTO = z.infer<typeof changePasswordSchema>;
export type ChangePinDTO = z.infer<typeof changePinSchema>;
