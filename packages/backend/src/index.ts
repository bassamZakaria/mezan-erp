export {
  createBackend, OwnerPinResetOutcome, COMPANY_OWNER_ASSIGNED_AUDIT,
  type BackendHandle, type CreateBackendOptions, type CompanyAdminAccount, type OwnerAccount, type OwnerAccountQuery, type ResetOwnerPinCommand, type SignedInUser,
} from "./create-backend.js";
export {
  seedIfEmpty,
  isEmptyTenant,
  SEED_TENANT_NAME,
  SEED_ADMIN_NAME,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PIN,
  // The desktop shell needs both: the id to reset the fallback admin's PIN from
  // `--reset-admin`, and the one-shot handover to write a freshly-generated PIN
  // to the recovery file. A packaged build's PIN is random and was printed
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
export { createPlatform, PLATFORM_SEED_PLANS, type CreatePlatformOptions, type PlatformHandle } from "./create-platform.js";
export { createPlatformAuth, PLATFORM_SESSION_LIMITS, PlatformSecurityAction, type PlatformAuth, type PlatformAuthDeps } from "./platform-auth.js";
export {
  createPlatformRoutes, PlatformAuditAction, TENANT_CODE_PROVISIONING,
  serializeCardCheckout,
  serializeCardCheckoutForTenant,
  TenantOwnerAccountNotFoundError,
  PlatformAuditUnavailableError,
  TenantBackupRefusalError,
  type PlatformTenantBackupsPort,
  type CreatePlatformRoutesOptions,
  type OwnerPinResetAccount,
  type PlatformCardCheckoutPort,
  type RecordedActivation,
} from "./platform-routes.js";
export { materialiseEndedTrial, resolveTenantPlan, type TenantPlanView } from "./reverse-trial.js";
export type { ApiKeyAuthentication, ApiWriteRecord, IdempotentApiAnswer, IntegrationsGateway } from "./integrations/gateway.js";
export type { IntegrationsSurface } from "./module-context.js";
