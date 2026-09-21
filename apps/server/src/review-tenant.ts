import { SEED_ADMIN_EMAIL, type BackendHandle } from "@mezan/backend";
import { provisionSeededTenant, type ProvisionDemoTenantDeps } from "./demo-tenant.js";

const REVIEW_NAME_AR = "شركة سياج — حساب المراجعة";

export interface ReviewTenantConfig {
  readonly code: string;
  readonly pin: string;
}

interface SeededUser {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly roleId: string | null;
  readonly isCompanyAdmin: boolean;
  readonly employeeId: string | null;
  readonly branchScope: unknown;
  readonly warehouseScope: unknown;
  readonly status: string;
  readonly photoUrl: string | null;
}

async function call(backend: BackendHandle, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Response> {
  return backend.app.fetch(
    new Request(`http://review-seed${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/**
 * SECURITY: the demo seed gives every persona the PIN published in this
 * repository, and a reviewer tenant has no basic auth in front of it. Every
 * account is moved onto the private reviewer PIN through the tenant's own
 * `PUT /users/:id`, so the published PIN opens nothing here.
 */
async function moveEveryUserToPin(backend: BackendHandle, pin: string): Promise<void> {
  const login = await call(backend, "POST", "/auth/login", {}, { username: SEED_ADMIN_EMAIL, pin });
  if (!login.ok) throw new Error(`[review-tenant] the seed admin could not sign in: ${login.status} ${await login.text()}`);
  const { token } = (await login.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}`, "x-branch-scope": "*", "x-warehouse-scope": "*" };

  const list = await call(backend, "GET", "/users", auth);
  if (!list.ok) throw new Error(`[review-tenant] could not list users: ${list.status} ${await list.text()}`);
  const users = (await list.json()) as SeededUser[];

  for (const user of users) {
    if (user.email === SEED_ADMIN_EMAIL) continue;
    const res = await call(backend, "PUT", `/users/${encodeURIComponent(user.id)}`, auth, {
      nameAr: user.nameAr,
      nameEn: user.nameEn,
      email: user.email,
      phone: user.phone,
      roleId: user.roleId,
      isCompanyAdmin: user.isCompanyAdmin,
      employeeId: user.employeeId,
      branchScope: user.branchScope,
      warehouseScope: user.warehouseScope,
      status: user.status,
      photoUrl: user.photoUrl,
      pin,
    });
    if (!res.ok) throw new Error(`[review-tenant] could not re-PIN ${user.email}: ${res.status} ${await res.text()}`);
  }
}

/**
 * The store reviewers' tenant: the demo seed under its own code, persistent,
 * with every login on a PIN that exists only in the deployment's secrets.
 * Seeded once; a later start finds the tenant and leaves the reviewer's own
 * writes in place.
 */
export async function provisionReviewTenant(deps: ProvisionDemoTenantDeps, config: ReviewTenantConfig): Promise<boolean> {
  return provisionSeededTenant(deps, {
    code: config.code,
    nameAr: REVIEW_NAME_AR,
    adminPin: config.pin,
    afterSeed: (backend) => moveEveryUserToPin(backend, config.pin),
  });
}
