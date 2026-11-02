const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export function isValidSlug(value: string): boolean {
  return SLUG.test(value);
}

const RESERVED_TENANT_CODES: ReadonlySet<string> = new Set(["platform", "tenants", "api", "www", "admin", "app", "signup", "demo"]);
const RELEASED_CODE_PREFIX = "released-";

export const RESERVED_TENANT_CODE_MESSAGE = "رمز المنشأة محجوز للنظام. اختر رمزًا آخر.";
export const RESERVED_TENANT_CODE_MESSAGE_EN = "This company code is reserved by the system. Choose another code.";

// SECURITY: these names are addresses, folders and codes the platform itself
// uses. A company signing up under one could shadow a platform route on its
// subdomain, or pass for a released tenant.
export function isReservedTenantCode(code: string): boolean {
  return RESERVED_TENANT_CODES.has(code) || code.startsWith(RELEASED_CODE_PREFIX);
}
