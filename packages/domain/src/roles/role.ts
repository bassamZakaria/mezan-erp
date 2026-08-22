/**
 * Role — a named, tenant-defined set of permission grants (docs/catalog/09 §
 * الأدوار والصلاحيات). A role stores the RAW set of permission codes an admin
 * ticked in the matrix (see `permissions/resolve.ts`'s header comment) — the
 * dependency-resolved effective set is computed downstream, once, when an
 * `AuthContext` is built for a user holding this role.
 */

/** A custom role is admin-authored; a system role ships with the tenant and cannot be edited/deleted. */
export interface Role {
  readonly id: string;
  /** Immutable, unique, upper-snake identifier (e.g. `VAN_SALES`). */
  readonly code: string;
  /** Arabic display name. */
  readonly name: string;
  readonly description: string;
  /** Raw granted permission codes, pre dependency-resolution. Never contains duplicates. */
  readonly permissions: readonly string[];
  readonly isSystem: boolean;
  readonly createdAt: string;
}

/**
 * Persistence port for roles. The domain depends on this interface only.
 */
export interface RoleRepository {
  save(role: Role): Promise<void>;
  findById(id: string): Promise<Role | null>;
  findByCode(code: string): Promise<Role | null>;
  list(): Promise<readonly Role[]>;
  delete(id: string): Promise<void>;
}
