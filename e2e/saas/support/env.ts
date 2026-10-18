export { LicenseStateCode as LicenseState, SubscriptionStatusCode as SubscriptionStatus, UNDISCLOSED_TENANT_NAME } from "@mezan/contracts";
export { TenantStatusCode as TenantStatus } from "@mezan/domain";

export const SAAS_API_PORT = 3321;
export const SAAS_WEB_PORT = 5321;
export const CLOCK_API_PORT = 3322;
export const CLOCK_WEB_PORT = 5322;
export const DEMO_API_PORT = 3323;
export const DEMO_WEB_PORT = 5323;

export const PLATFORM_DIR_ENV = "MEZAN_SAAS_E2E_PLATFORM_DIR";
export const DEMO_PLATFORM_DIR_ENV = "MEZAN_SAAS_E2E_DEMO_PLATFORM_DIR";

export const SAAS_API_URL = `http://127.0.0.1:${SAAS_API_PORT}`;
export const SAAS_WEB_URL = `http://127.0.0.1:${SAAS_WEB_PORT}`;
export const CLOCK_API_URL = `http://127.0.0.1:${CLOCK_API_PORT}`;
export const CLOCK_WEB_URL = `http://127.0.0.1:${CLOCK_WEB_PORT}`;
export const DEMO_API_URL = `http://127.0.0.1:${DEMO_API_PORT}`;
export const DEMO_WEB_URL = `http://127.0.0.1:${DEMO_WEB_PORT}`;

export const TENANT_DOMAIN = "localhost";
export const PLATFORM_OWNER_EMAIL = "owner@mezan.local";
export const PLATFORM_OWNER_PASSWORD = "owner-password-123";
export const MAIN_SERVER_TODAY = "2027-01-31";
export const DEMO_SERVER_TODAY = "2026-10-11";
export const DEMO_TENANT = { code: "demo", adminEmail: "admin@cyag.example", adminPin: "123456" } as const;
export const FORWARDED_FOR_HEADER = "x-forwarded-for";
export const TRUSTED_PROXY_HOPS = 2;
export const TRUSTED_PROXY_HOP = "130.176.0.7";
export const DEFAULT_BROWSER_CLIENT = "10.9.0.1";

/** What a browser sends: the dev proxy in front of the API appends its own hop, which makes the chain two trusted hops long. */
export function browserSource(client: string): Record<string, string> {
  return { [FORWARDED_FOR_HEADER]: client };
}

/** The chain a request reaching the API directly must carry to look as it would behind the two trusted proxies. `claimed` is whatever the caller wrote ahead of them. */
export function proxiedSource(client: string, claimed?: string): Record<string, string> {
  return { [FORWARDED_FOR_HEADER]: [...(claimed === undefined ? [] : [claimed]), client, TRUSTED_PROXY_HOP].join(", ") };
}
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
  TenantCodeTaken = "TENANT_CODE_TAKEN",
  ValidationError = "VALIDATION_ERROR",
  TooManyRequests = "TOO_MANY_REQUESTS",
  SourceUnresolved = "SOURCE_UNRESOLVED",
  WarehouseLimitReached = "WAREHOUSE_LIMIT_REACHED",
  InvalidSignature = "INVALID_SIGNATURE",
  InvalidCredentials = "INVALID_CREDENTIALS",
  Unauthenticated = "UNAUTHENTICATED",
  NotFound = "NOT_FOUND",
}

export enum HttpMethod {
  Get = "GET",
  Post = "POST",
  Patch = "PATCH",
}

export enum PlanCode {
  Free = "free",
  Core = "core",
  Business = "business",
  Enterprise = "enterprise",
}

export enum PlanKind {
  Free = "free",
  Paid = "paid",
}

export enum Module {
  Sales = "sales",
  Hr = "hr",
  Manufacturing = "manufacturing",
}

export const TENANT_HEADER = "x-mezan-tenant";
export const FORWARDED_HOST_HEADER = "x-forwarded-host";

export const INVALID_CREDENTIALS_SENTENCE = "اسم المستخدم أو رمز PIN غير صحيح.";
export const LICENSE_READ_ONLY_SENTENCE =
  "الترخيص غير فعّال حاليًا، والبرنامج في وضع القراءة فقط. كل بياناتك متاحة للعرض والطباعة والتصدير، لكن لا يمكن حفظ أي حركة جديدة حتى تجديد الترخيص.";

export function tenantCodeTakenSentence(code: string): string {
  return `رمز المنشأة "${code}" مستخدم بالفعل`;
}

export enum ItemType {
  Service = "service",
}

export enum Currency {
  Egp = "EGP",
}

export enum DiscountType {
  Percent = "percent",
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

export enum CodePrefix {
  Console = "cyag",
  Paying = "paying",
  IsolatedA = "alpha",
  IsolatedB = "nile",
  Resolved = "oasis",
  ResolvedSecond = "delta",
  Renamed = "rename",
  SignedUp = "shop",
  Crafted = "crafted",
  Paid = "paid",
  Declined = "declined",
  Forged = "forged",
  Unsigned = "unsigned",
  PaymentLink = "link",
  Trial = "trial",
  Lapsing = "lapse",
  Walk = "walk",
  BesideDemo = "beside",
  SignedInBefore = "before",
  SignedInBeforeToo = "earlier",
  HandedOver = "handed",
}

export const SUITE_TENANT_CODE = new RegExp(`^(?:${Object.values(CodePrefix).join("|")})-[a-z0-9]{8}$`);

export function uniqueCode(prefix: CodePrefix): string {
  const stamp = Date.now().toString(36).slice(-6);
  const salt = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
  return `${prefix}-${stamp}${salt}`;
}
