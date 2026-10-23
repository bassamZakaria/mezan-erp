import { z } from "zod";

/** Server settings the platform owner may change from the console. Each is an environment variable the server reads at start-up. */
export enum EnvSettingKey {
  SupportEmail = "MEZAN_SUPPORT_EMAIL",
  SupportPhone = "MEZAN_SUPPORT_PHONE",
  WhatsappNumber = "MEZAN_WHATSAPP_NUMBER",
  AlertEmail = "MEZAN_ALERT_EMAIL",
  PublicLanding = "MEZAN_PUBLIC_LANDING",
  PublicUrl = "MEZAN_PUBLIC_URL",
  TenantDomain = "MEZAN_TENANT_DOMAIN",
  AnalyticsToken = "MEZAN_ANALYTICS_TOKEN",
  SmtpHost = "MEZAN_SMTP_HOST",
  SmtpPort = "MEZAN_SMTP_PORT",
  SmtpSecurity = "MEZAN_SMTP_SECURITY",
  SmtpUsername = "MEZAN_SMTP_USERNAME",
  SmtpPassword = "MEZAN_SMTP_PASSWORD",
  SmtpFromEmail = "MEZAN_SMTP_FROM_EMAIL",
  SmtpFromName = "MEZAN_SMTP_FROM_NAME",
  PaymobSecretKey = "MEZAN_PAYMOB_SECRET_KEY",
  PaymobPublicKey = "MEZAN_PAYMOB_PUBLIC_KEY",
  PaymobHmacSecret = "MEZAN_PAYMOB_HMAC_SECRET",
  PaymobIntegrationId = "MEZAN_PAYMOB_INTEGRATION_ID",
  PaymobApiKey = "MEZAN_PAYMOB_API_KEY",
  PaymobPublicUrl = "MEZAN_PAYMOB_PUBLIC_URL",
  PaymobBaseUrl = "MEZAN_PAYMOB_BASE_URL",
  PaymobTestMode = "MEZAN_PAYMOB_TEST_MODE",
  PaymobNotFoundConfirmed = "MEZAN_PAYMOB_NOT_FOUND_CONFIRMED",
  BackupIntervalMinutes = "MEZAN_BACKUP_INTERVAL_MINUTES",
  TenantRetentionDays = "MEZAN_TENANT_RETENTION_DAYS",
  AuditAnchorIntervalMinutes = "MEZAN_AUDIT_ANCHOR_INTERVAL_MINUTES",
  AuditAnchorDir = "MEZAN_AUDIT_ANCHOR_DIR",
  AuditAnchorPublicKey = "MEZAN_AUDIT_ANCHOR_PUBLIC_KEY",
  AuditAnchorTrustedPublicKeys = "MEZAN_AUDIT_ANCHOR_TRUSTED_PUBLIC_KEYS",
  AuditAnchorS3Bucket = "MEZAN_AUDIT_ANCHOR_S3_BUCKET",
  AuditAnchorS3Region = "MEZAN_AUDIT_ANCHOR_S3_REGION",
  AuditAnchorS3Endpoint = "MEZAN_AUDIT_ANCHOR_S3_ENDPOINT",
  AuditAnchorS3Prefix = "MEZAN_AUDIT_ANCHOR_S3_PREFIX",
  TrustProxy = "MEZAN_TRUST_PROXY",
  TrustedProxyHops = "MEZAN_TRUSTED_PROXY_HOPS",
  OriginSecret = "MEZAN_ORIGIN_SECRET",
  SeedDemo = "MEZAN_SEED_DEMO",
  DemoPassword = "MEZAN_DEMO_PASSWORD",
  ReviewTenantCode = "MEZAN_REVIEW_TENANT_CODE",
  ReviewPin = "MEZAN_REVIEW_PIN",
}

/** Read at start-up before anything else, or protecting what sits next to the overrides file: these stay in the server's env file. */
export enum EnvReadOnlyKey {
  PlatformDir = "MEZAN_PLATFORM_DIR",
  SecretsKey = "MEZAN_SECRETS_KEY",
  AuditAnchorSigningKey = "MEZAN_AUDIT_ANCHOR_SIGNING_KEY",
  PlatformOwnerEmail = "MEZAN_PLATFORM_OWNER_EMAIL",
  PlatformOwnerPassword = "MEZAN_PLATFORM_OWNER_PASSWORD",
  SeedAdminPin = "MEZAN_SEED_ADMIN_PIN",
  Port = "PORT",
  WebDist = "MEZAN_WEB_DIST",
  SqliteExclusive = "MEZAN_SQLITE_EXCLUSIVE",
}

export enum EnvSettingGroup {
  Contact = "contact",
  Site = "site",
  Mail = "mail",
  Payments = "payments",
  Operations = "operations",
  Network = "network",
  Demo = "demo",
}

export enum EnvSettingKind {
  Text = "text",
  Email = "email",
  Url = "url",
  Number = "number",
  Flag = "flag",
  Choice = "choice",
}

export interface EnvSettingSpec {
  readonly group: EnvSettingGroup;
  readonly kind: EnvSettingKind;
  readonly secret?: true;
  readonly choices?: readonly string[];
}

export const ENV_SETTINGS: Readonly<Record<EnvSettingKey, EnvSettingSpec>> = {
  [EnvSettingKey.SupportEmail]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Email },
  [EnvSettingKey.SupportPhone]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Text },
  [EnvSettingKey.WhatsappNumber]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Text },
  [EnvSettingKey.AlertEmail]: { group: EnvSettingGroup.Contact, kind: EnvSettingKind.Email },
  [EnvSettingKey.PublicLanding]: { group: EnvSettingGroup.Site, kind: EnvSettingKind.Flag },
  [EnvSettingKey.PublicUrl]: { group: EnvSettingGroup.Site, kind: EnvSettingKind.Url },
  [EnvSettingKey.TenantDomain]: { group: EnvSettingGroup.Site, kind: EnvSettingKind.Text },
  [EnvSettingKey.AnalyticsToken]: { group: EnvSettingGroup.Site, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.SmtpHost]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Text },
  [EnvSettingKey.SmtpPort]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Number },
  [EnvSettingKey.SmtpSecurity]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Choice, choices: ["NONE", "STARTTLS", "TLS"] },
  [EnvSettingKey.SmtpUsername]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Text },
  [EnvSettingKey.SmtpPassword]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.SmtpFromEmail]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Email },
  [EnvSettingKey.SmtpFromName]: { group: EnvSettingGroup.Mail, kind: EnvSettingKind.Text },
  [EnvSettingKey.PaymobSecretKey]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.PaymobPublicKey]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Text },
  [EnvSettingKey.PaymobHmacSecret]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.PaymobIntegrationId]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Text },
  [EnvSettingKey.PaymobApiKey]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.PaymobPublicUrl]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Url },
  [EnvSettingKey.PaymobBaseUrl]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Url },
  [EnvSettingKey.PaymobTestMode]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Flag },
  [EnvSettingKey.PaymobNotFoundConfirmed]: { group: EnvSettingGroup.Payments, kind: EnvSettingKind.Flag },
  [EnvSettingKey.BackupIntervalMinutes]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Number },
  [EnvSettingKey.TenantRetentionDays]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Number },
  [EnvSettingKey.AuditAnchorIntervalMinutes]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Number },
  [EnvSettingKey.AuditAnchorDir]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Text },
  [EnvSettingKey.AuditAnchorPublicKey]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Text },
  [EnvSettingKey.AuditAnchorTrustedPublicKeys]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Text },
  [EnvSettingKey.AuditAnchorS3Bucket]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Text },
  [EnvSettingKey.AuditAnchorS3Region]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Text },
  [EnvSettingKey.AuditAnchorS3Endpoint]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Url },
  [EnvSettingKey.AuditAnchorS3Prefix]: { group: EnvSettingGroup.Operations, kind: EnvSettingKind.Text },
  [EnvSettingKey.TrustProxy]: { group: EnvSettingGroup.Network, kind: EnvSettingKind.Flag },
  [EnvSettingKey.TrustedProxyHops]: { group: EnvSettingGroup.Network, kind: EnvSettingKind.Number },
  [EnvSettingKey.OriginSecret]: { group: EnvSettingGroup.Network, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.SeedDemo]: { group: EnvSettingGroup.Demo, kind: EnvSettingKind.Flag },
  [EnvSettingKey.DemoPassword]: { group: EnvSettingGroup.Demo, kind: EnvSettingKind.Text, secret: true },
  [EnvSettingKey.ReviewTenantCode]: { group: EnvSettingGroup.Demo, kind: EnvSettingKind.Text },
  [EnvSettingKey.ReviewPin]: { group: EnvSettingGroup.Demo, kind: EnvSettingKind.Text, secret: true },
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
  /** Null for a secret: its value never leaves the server. */
  value: z.string().nullable(),
  hasValue: z.boolean(),
  source: z.nativeEnum(EnvSettingSource),
});

export const envSettingsSchema = z.object({
  settings: z.array(envSettingSchema),
  readOnly: z.array(z.object({ key: z.nativeEnum(EnvReadOnlyKey), hasValue: z.boolean() })),
  /** True when the saved overrides differ from the ones the running server started with. */
  restartPending: z.boolean(),
});

/** A string replaces the value (an empty string forces it unset); null drops the override so the env file applies again. */
export const updateEnvSettingsRequestSchema = z.object({
  password: z.string().min(1),
  changes: z.record(z.nativeEnum(EnvSettingKey), z.string().max(4000).nullable()),
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
