import { provisionSeededTenant, type ProvisionDemoTenantDeps } from "./demo-tenant.js";

const REVIEW_NAME_AR = "شركة سياج — حساب المراجعة";

export interface ReviewTenantConfig {
  readonly code: string;
  readonly password: string;
}

/**
 * The store reviewers' tenant: the demo seed under its own code, persistent,
 * with every login on a password that exists only in the deployment's secrets.
 * SECURITY: the seed gives every persona this private password directly, and a
 * reviewer tenant has no basic auth in front of it, so the password published
 * in this repository never opens anything here.
 * Seeded once; a later start finds the tenant and leaves the reviewer's own
 * writes in place.
 */
export async function provisionReviewTenant(deps: ProvisionDemoTenantDeps, config: ReviewTenantConfig): Promise<boolean> {
  return provisionSeededTenant(deps, {
    code: config.code,
    nameAr: REVIEW_NAME_AR,
    adminPassword: config.password,
  });
}
