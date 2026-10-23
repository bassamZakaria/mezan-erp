import { z } from "zod";

/**
 * SECURITY: the only server settings the platform console may change — contact details and switches that change what visitors
 * see. Nothing secret and nothing that decides where a secret goes or what the server trusts belongs here; those stay in the
 * server's env file, where only someone with access to the host can change them.
 */
export enum EnvSettingKey {
  SupportEmail = "MEZAN_SUPPORT_EMAIL",
  SupportPhone = "MEZAN_SUPPORT_PHONE",
  WhatsappNumber = "MEZAN_WHATSAPP_NUMBER",
  PublicLanding = "MEZAN_PUBLIC_LANDING",
}

export enum EnvSettingGroup {
  Contact = "contact",
  Site = "site",
}

export enum EnvSettingKind {
  Text = "text",
  Email = "email",
  Flag = "flag",
}

export interface EnvSettingSpec {
  readonly group: EnvSettingGroup;
  readonly kind: EnvSettingKind;
}

export const ENV_SETTINGS: Readonly<Record<EnvSettingKey, EnvSettingSpec>> = {
  [EnvSettingKey.SupportEmail]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Email },
  [EnvSettingKey.SupportPhone]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Text },
  [EnvSettingKey.WhatsappNumber]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Text },
  [EnvSettingKey.PublicLanding]: { group: EnvSettingGroup.Site, kind: EnvSettingKind.Flag },
};

export function isEnvSettingKey(key: string): key is EnvSettingKey {
  return Object.values(EnvSettingKey).some((k) => k === key);
}

export enum EnvSettingSource {
  Override = "override",
  EnvFile = "env-file",
  Unset = "unset",
}

export const envSettingSchema = z.object({
  key: z.nativeEnum(EnvSettingKey),
  value: z.string().nullable(),
  source: z.nativeEnum(EnvSettingSource),
});

export const envSettingsSchema = z.object({
  settings: z.array(envSettingSchema),
  /** True when the saved overrides differ from the ones the running server started with. */
  restartPending: z.boolean(),
  /** Set when the saved overrides could not be read at start-up, so the server runs on its env file alone. */
  loadError: z.string().nullable(),
});

/** A string replaces the value (an empty string forces it unset); null drops the override so the env file applies again. */
export const updateEnvSettingsRequestSchema = z.object({
  password: z.string().min(1),
  changes: z.record(z.nativeEnum(EnvSettingKey), z.string().max(320).nullable()),
});

export const restartServerRequestSchema = z.object({ password: z.string().min(1) });

export enum EnvSettingsRefusal {
  Invalid = "ENV_SETTINGS_INVALID",
  Unavailable = "ENV_SETTINGS_UNAVAILABLE",
}

export type EnvSettingDTO = z.infer<typeof envSettingSchema>;
export type EnvSettingsDTO = z.infer<typeof envSettingsSchema>;
export type UpdateEnvSettingsRequestDTO = z.infer<typeof updateEnvSettingsRequestSchema>;
export type RestartServerRequestDTO = z.infer<typeof restartServerRequestSchema>;
