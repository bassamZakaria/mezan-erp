import { existsSync } from "node:fs";
import { PlatformAuditUnavailableError, SEED_ADMIN_USER_ID, type PlatformHandle } from "@mezan/backend";
import { TenantBooksStanding } from "@mezan/contracts";
import { AuditSeverityCode, recordSecurityEvent, TenantBooksReview, TenantStatusCode, UserStatusCode, type Tenant } from "@mezan/domain";
import { NotASqliteDatabaseError, readTenantBooksIdentity, type SqliteOpenOptions, type TenantBooksIdentity, type TenantBooksUser } from "@mezan/persistence";
import {
  holdsSqliteDatabase,
  TenantDbFileDisownedError,
  TenantDbFileForeignError,
  TenantDbFileMissingError,
  TenantDbFileUnreadableError,
  type TenantDbFileError,
} from "./tenant-db-file.js";

export enum TenantBooksAudit {
  Unconfirmed = "TENANT_BOOKS_UNCONFIRMED",
  Confirmed = "TENANT_BOOKS_CONFIRMED",
  Disowned = "TENANT_BOOKS_DISOWNED",
  Unbound = "TENANT_BOOKS_UNBOUND",
}

export const BOOKS_CHECK_ACTOR = "platform:books-check";

export class TenantBooksUnconfirmedError extends Error {
  readonly code = "TENANT_BOOKS_UNCONFIRMED";
  readonly messageEn = "Confirm this company's books first.";

  constructor() {
    super("أكّد دفاتر هذه المنشأة أولًا.");
    this.name = "TenantBooksUnconfirmedError";
  }
}

export class TenantBooksBoundError extends Error {
  readonly code = "TENANT_BOOKS_BOUND";
  readonly messageEn = "These books are bound to this company. Unbind them instead.";

  constructor() {
    super("هذه الدفاتر مربوطة بهذه المنشأة. استخدم فك الربط.");
    this.name = "TenantBooksBoundError";
  }
}

export class TenantBooksNotBoundError extends Error {
  readonly code = "TENANT_BOOKS_NOT_BOUND";
  readonly messageEn = "These books are not bound to this company.";

  constructor() {
    super("هذه الدفاتر غير مربوطة بهذه المنشأة.");
    this.name = "TenantBooksNotBoundError";
  }
}

export type TenantBooksConnection = Pick<SqliteOpenOptions, "driver" | "key" | "exclusive">;

export interface TenantBooksVerdict {
  readonly standing: TenantBooksStanding;
  readonly identity: TenantBooksIdentity | null;
  readonly refusal: TenantDbFileError | null;
}

const isActive = (user: TenantBooksUser): boolean => user.status === UserStatusCode.Active && !user.erased;

export function activeCompanyAdminsIn(books: TenantBooksIdentity): TenantBooksUser[] {
  return books.users.filter((user) => user.isCompanyAdmin && isActive(user));
}

function claimed(books: TenantBooksIdentity): boolean {
  return books.claimed || books.users.some((user) => user.id !== SEED_ADMIN_USER_ID && isActive(user));
}

// SECURITY: the proof that binds a database nobody bound, with no person
// asked. An owner id is proof only when it is an id of its own: the seed
// admin's id is in every company's database. An owner e-mail is proof only
// while no other tenant row carries it, or two companies of one owner whose
// files changed places would each be bound to the other's books for good.
function holdsRecordedOwner(tenant: Tenant, books: TenantBooksIdentity, ownerEmailShared: boolean): boolean {
  if (tenant.ownerUserId !== null && tenant.ownerUserId !== SEED_ADMIN_USER_ID) return books.users.some((user) => user.id === tenant.ownerUserId);
  if (ownerEmailShared) return false;
  return activeCompanyAdminsIn(books).some((user) => user.email === tenant.ownerEmail && (tenant.ownerUserId === null || user.id === tenant.ownerUserId));
}

// SECURITY: asked on every open, at start-up and by the console, and it only
// reads. A tenant still being provisioned may have no database yet, or one
// nobody has bound. Any other tenant's unbound database is served only when
// somebody claimed it, never seeded, and bound without a person only on the
// proof above; once marked for confirmation only the console binds it.
export function judgeTenantBooks(tenant: Tenant, file: string, connection: TenantBooksConnection, ownerEmailShared: boolean): TenantBooksVerdict {
  const provisioning = tenant.status === TenantStatusCode.Provisioning;
  const refused = (standing: TenantBooksStanding, refusal: TenantDbFileError, identity: TenantBooksIdentity | null = null): TenantBooksVerdict => ({ standing, identity, refusal });
  if (provisioning && !existsSync(file)) return { standing: TenantBooksStanding.NotCreated, identity: null, refusal: null };
  if (!provisioning && !holdsSqliteDatabase(file)) return refused(TenantBooksStanding.Missing, new TenantDbFileMissingError(tenant.id, tenant.dbFile));
  let books: TenantBooksIdentity;
  try {
    books = readTenantBooksIdentity(file, connection);
  } catch (err) {
    if (err instanceof NotASqliteDatabaseError) return refused(TenantBooksStanding.Unreadable, new TenantDbFileUnreadableError(tenant.id, tenant.dbFile, err.cause));
    throw err;
  }
  const accepted = (standing: TenantBooksStanding): TenantBooksVerdict => ({ standing, identity: books, refusal: null });
  if (tenant.booksReview === TenantBooksReview.Disowned) return refused(TenantBooksStanding.Disowned, new TenantDbFileDisownedError(tenant.id, tenant.dbFile), books);
  if (books.boundTenantId === tenant.id) return accepted(TenantBooksStanding.Bound);
  if (books.boundTenantId !== null) return refused(TenantBooksStanding.Foreign, new TenantDbFileForeignError(tenant.id, tenant.dbFile, books.boundTenantId), books);
  if (provisioning) return accepted(TenantBooksStanding.WillBind);
  if (!claimed(books)) return refused(TenantBooksStanding.Foreign, new TenantDbFileForeignError(tenant.id, tenant.dbFile, null), books);
  if (tenant.booksReview === TenantBooksReview.Unconfirmed) return accepted(TenantBooksStanding.Unconfirmed);
  return accepted(holdsRecordedOwner(tenant, books, ownerEmailShared) ? TenantBooksStanding.WillBind : TenantBooksStanding.Unconfirmed);
}

export interface BooksReviewRecord {
  readonly action: TenantBooksAudit;
  readonly severity: AuditSeverityCode;
  readonly actor: string;
  readonly details?: Record<string, unknown>;
  readonly inTheSameWrite?: () => void;
}

// REQUIRED ORDERING: the audit row is written inside the transaction that
// moves the mark, and whatever is done to the books themselves comes after it
// in that same transaction. A row that cannot be written rolls the mark back
// before the books are touched.
export async function recordBooksReview(platform: PlatformHandle, before: Tenant, after: Tenant, record: BooksReviewRecord): Promise<boolean> {
  return platform.stores.tenants.compareAndSetOwner(before, after, async () => {
    if (after.ownerEmail !== before.ownerEmail) await platform.stores.signupRequests.followOwnerEmail(before.code, before.ownerEmail, after.ownerEmail);
    await recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId: after.id,
      action: record.action,
      actor: record.actor,
      severity: record.severity,
      timestamp: after.updatedAt,
      details: { code: after.code, before: before.booksReview ?? null, after: after.booksReview ?? null, ...record.details },
    }).catch((cause: unknown) => {
      throw new PlatformAuditUnavailableError(cause);
    });
    record.inTheSameWrite?.();
  });
}
