export {
  createBackend, OwnerPasswordResetOutcome, COMPANY_OWNER_ASSIGNED_AUDIT,
  type BackendHandle, type CreateBackendOptions, type CompanyAdminAccount, type OwnerAccount, type OwnerAccountQuery, type ResetOwnerPasswordCommand, type SignedInUser,
} from "./create-backend.js";
export {
  seedIfEmpty,
  isEmptyTenant,
  SEED_TENANT_NAME,
  SEED_ADMIN_NAME,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  // The desktop shell needs both: the id to reset the fallback admin's password from
  // `--reset-admin`, and the one-shot handover to write a freshly-generated password
  // to the recovery file. A packaged build's password is random and was printed
  // nowhere, so a forgotten one bricked the install (apps/desktop/src/main/recovery.ts).
  SEED_ADMIN_USER_ID,
  tenantBooksClaimed,
  takeSeededAdminSecrets,
  resolveSeedAdminSecrets,
  type SeedStores,
  type SeedAdminSecrets,
} from "./seed.js";
export { createAuth, createAuthRoutes, type AuthMount, type AuthRoutesDeps } from "./auth-routes.js";
export { createDashboardRoutes, type DashboardDeps } from "./dashboard-routes.js";
export { createHrTreasuryDisbursementPort } from "./hr-treasury-disbursement.js";
export { createPlatform, ensurePlatformTables, PLATFORM_SEED_PLANS, type CreatePlatformOptions, type PlatformHandle } from "./create-platform.js";
export { createPlatformAuth, PLATFORM_SESSION_LIMITS, PlatformSecurityAction, type PlatformAuth, type PlatformAuthDeps } from "./platform-auth.js";
export {
  createPlatformRoutes, PlatformAuditAction, TENANT_CODE_PROVISIONING,
  serializeCardCheckout,
  serializeCardCheckoutForTenant,
  serializeStorageRequest,
  TenantOwnerAccountNotFoundError,
  PlatformAuditUnavailableError,
  TenantBackupRefusalError,
  type PlatformTenantBackupsPort,
  type CreatePlatformRoutesOptions,
  type OwnerPasswordResetAccount,
  type PlatformCardCheckoutPort,
  type RecordedActivation,
  type PlatformAuditAnchorPort,
  type PlatformAcceptRestoreResult,
  type PlatformTenantRetentionPort,
  EnvSettingsInvalidError,
  ProvisioningRefusalCode,
  type PlatformEnvSettingsPort,
  type PreparedEnvChange,
} from "./platform-routes.js";
export { materialiseEndedTrial, resolveTenantPlan, type TenantPlanView } from "./reverse-trial.js";
export type { ApiKeyAuthentication, ApiWriteRecord, IdempotentApiAnswer, IntegrationsGateway } from "./integrations/gateway.js";
export type { IntegrationsSurface } from "./module-context.js";
