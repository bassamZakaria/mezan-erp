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
  /** The Arabic name — the record. Every document and audit row reads this. */
  readonly nameAr: string;
  /** The Latin name, when the person has one. `null` falls back to `nameAr`. */
  readonly nameEn: string | null;
  /**
   * The login identifier AND the contact address — one field, one value.
   *
   * Stored already normalised (trimmed, lower-cased) so uniqueness is a plain
   * index rather than a collation the SQLite file has to agree about, and so
   * `Admin@x.com` cannot become a second account beside `admin@x.com`. It is
   * deliberately not the display name: a name is neither unique nor stable —
   * two «محمد أحمد» can work in one shop, and either may be corrected next
   * week, which would silently change who can log in.
   */
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
  /**
   * Profile photo as a `data:` URL, or null. Stored on the row because the
   * desktop edition ships one SQLite file and no blob store — the wire schema
   * bounds its size (`PHOTO_MAX_CHARS`) so a camera JPEG cannot ride along.
   */
  readonly photoUrl: string | null;
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
  /** Looks up by the normalised email. Callers pass the raw input; the adapter normalises. */
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
