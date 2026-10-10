export const SAAS_API_PORT = 3321;
export const SAAS_WEB_PORT = 5321;
export const CLOCK_API_PORT = 3322;
export const CLOCK_WEB_PORT = 5322;

export const SAAS_API_URL = `http://127.0.0.1:${SAAS_API_PORT}`;
export const SAAS_WEB_URL = `http://127.0.0.1:${SAAS_WEB_PORT}`;
export const CLOCK_API_URL = `http://127.0.0.1:${CLOCK_API_PORT}`;
export const CLOCK_WEB_URL = `http://127.0.0.1:${CLOCK_WEB_PORT}`;

export const TENANT_DOMAIN = "localhost";
export const PLATFORM_OWNER_EMAIL = "owner@mezan.local";
export const PLATFORM_OWNER_PASSWORD = "owner-password-123";
export const DEMO_TENANT_CODE = "demo";
export const WALK_DIR = "e2e-results/saas-walk";

export enum Locale {
  Arabic = "ar",
  English = "en",
}

export enum Theme {
  Light = "light",
  Dark = "dark",
}

export enum Viewport {
  Desktop = "desktop",
  Phone = "phone",
}

export const VIEWPORT_SIZE: Record<Viewport, { width: number; height: number }> = {
  [Viewport.Desktop]: { width: 1440, height: 900 },
  [Viewport.Phone]: { width: 390, height: 844 },
};

export enum PlanId {
  Free = "PLAN-FREE",
  Core = "PLAN-CORE",
  Business = "PLAN-BUSINESS",
  Enterprise = "PLAN-ENTERPRISE",
}

export enum BillingCycle {
  Monthly = "monthly",
  Yearly = "yearly",
}

export enum ApiError {
  ModuleNotLicensed = "MODULE_NOT_LICENSED",
  ModuleReadOnly = "MODULE_READ_ONLY",
  LicenseReadOnly = "LICENSE_READ_ONLY",
  PlanLimitReached = "PLAN_LIMIT_REACHED",
  SessionExpired = "SESSION_EXPIRED",
  TenantRequired = "TENANT_REQUIRED",
  TenantNotFound = "TENANT_NOT_FOUND",
  ValidationError = "VALIDATION_ERROR",
}

export enum ResolveMode {
  Code = "code",
  Subdomain = "subdomain",
}

export enum StorageKey {
  Locale = "mezan.locale",
  Theme = "mezan:theme",
  TenantCode = "mezan.tenantCode",
  Session = "mezan.session",
  PlatformSession = "mezan.platform.session",
}

export function uniqueCode(prefix: string): string {
  const stamp = Date.now().toString(36).slice(-6);
  const salt = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
  return `${prefix}-${stamp}${salt}`;
}
