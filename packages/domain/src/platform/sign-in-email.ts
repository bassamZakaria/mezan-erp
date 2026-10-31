export interface SignInEmailRepository {
  tenantOf(email: string): Promise<string | null>;
  claim(email: string, tenantId: string): Promise<boolean>;
  release(email: string, tenantId: string): Promise<void>;
  replaceTenant(tenantId: string, emails: readonly string[]): Promise<readonly string[]>;
  forgetTenant(tenantId: string): Promise<void>;
}
