export interface SignInEmailRepository {
  tenantOf(email: string): Promise<string | null>;
  /** True when `email` is now (or already was) this tenant's; false when another tenant holds it. */
  claim(email: string, tenantId: string): Promise<boolean>;
  release(email: string, tenantId: string): Promise<void>;
  /** Leaves exactly `emails` on the tenant; answers those another tenant holds. */
  replaceTenant(tenantId: string, emails: readonly string[]): Promise<readonly string[]>;
  forgetTenant(tenantId: string): Promise<void>;
}
