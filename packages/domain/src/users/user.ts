import type { ScopeSelection } from "../permissions/auth-context.js";

export type UserStatus = "active" | "inactive";

/**
 * A tenant user account (docs/catalog/09 §المستخدمون). Scoping is
 * two-dimensional and orthogonal, matching the reference UX exactly:
 *   - WHAT it may do: either a single custom `roleId`, or the
 *     `isCompanyAdmin` bypass flag (full permissions, independent of the
 *     granular role/permission system — never both, never neither).
 *   - WHERE it may act: `branchScope` / `warehouseScope`, the same
 *     `ScopeSelection` shape `AuthContext` already understands.
 */
export interface User {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  /** Opaque hash produced by a `SecretHasher` — the domain never sees plaintext. */
  readonly passwordHash: string;
  readonly pinHash: string | null;
  /** Null exactly when `isCompanyAdmin` is true. */
  readonly roleId: string | null;
  readonly isCompanyAdmin: boolean;
  /** Optional link to an HR employee record (e.g. a van-sales driver login). */
  readonly employeeId: string | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  readonly status: UserStatus;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

/** Persistence port for users. The domain depends on this interface only. */
export interface UserRepository {
  save(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(): Promise<readonly User[]>;
}

/**
 * Secret-hashing port. Kept out of the domain core deliberately (see
 * `licensing/encoding.ts`) — the domain only ever handles opaque hashes; a
 * persistence-layer adapter binds the real algorithm (docs/plan.md §3.2 layer
 * boundary: no `node:crypto` inside packages/domain).
 */
export interface SecretHasher {
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}
