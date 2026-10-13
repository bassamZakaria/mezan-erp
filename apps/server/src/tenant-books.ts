import { PlatformAuditUnavailableError, tenantBooksClaimed, type PlatformHandle } from "@mezan/backend";
import { PlatformRefusalCode, TenantBooksStanding } from "@mezan/contracts";
import { AuditSeverityCode, recordSecurityEvent, TenantStatusCode, UserStatusCode, type Tenant } from "@mezan/domain";
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
  Confirmed = "TENANT_BOOKS_CONFIRMED",
  Disowned = "TENANT_BOOKS_DISOWNED",
  Unbound = "TENANT_BOOKS_UNBOUND",
}

export class TenantBooksBoundError extends Error {
  readonly code = PlatformRefusalCode.BooksBound;
  readonly messageEn = "These books are bound to this company. Unbind them instead.";

  constructor() {
    super("هذه الدفاتر مربوطة بهذه المنشأة. استخدم فك الربط.");
    this.name = "TenantBooksBoundError";
  }
}

export class TenantBooksNotBoundError extends Error {
  readonly code = PlatformRefusalCode.BooksNotBound;
  readonly messageEn = "These books are not bound to this company.";

  constructor() {
    super("هذه الدفاتر غير مربوطة بهذه المنشأة.");
    this.name = "TenantBooksNotBoundError";
  }
}

export class TenantBooksChangedError extends Error {
  readonly code = PlatformRefusalCode.BooksChanged;
  readonly messageEn = "These books are no longer the ones that were shown. Read them again before confirming.";

  constructor() {
    super("هذه الدفاتر لم تعد كما عُرضت. أعد قراءتها قبل التأكيد.");
    this.name = "TenantBooksChangedError";
  }
}

export type TenantBooksConnection = Pick<SqliteOpenOptions, "driver" | "key" | "exclusive">;

export enum BooksFileState {
  Absent = "absent",
  Unreadable = "unreadable",
  Read = "read",
}

export type BooksFile =
  | { readonly state: BooksFileState.Absent }
  | { readonly state: BooksFileState.Unreadable; readonly cause: unknown }
  | { readonly state: BooksFileState.Read; readonly identity: TenantBooksIdentity };

export interface TenantBooksVerdict {
  readonly standing: TenantBooksStanding;
  readonly identity: TenantBooksIdentity | null;
  readonly refusal: TenantDbFileError | null;
}

const isActive = (user: TenantBooksUser): boolean => user.status === UserStatusCode.Active && !user.erased;

export function activeCompanyAdminsIn(books: TenantBooksIdentity): TenantBooksUser[] {
  return books.users.filter((user) => user.isCompanyAdmin && isActive(user));
}

// CONTRACT: reads the file where it is and writes nothing, to it or anywhere
// a refusal would have to undo.
export async function readBooksFile(file: string, scratchDir: string, connection: TenantBooksConnection): Promise<BooksFile> {
  if (!holdsSqliteDatabase(file)) return { state: BooksFileState.Absent };
  try {
    return { state: BooksFileState.Read, identity: await readTenantBooksIdentity(file, scratchDir, connection) };
  } catch (err) {
    if (err instanceof NotASqliteDatabaseError) return { state: BooksFileState.Unreadable, cause: err.cause };
    throw err;
  }
}

// SECURITY: the one rule for whose books a database holds, asked on every
// open, by the start-up scan and by the console. Books bound to this tenant
// are served; books bound to another, missing, unreadable or disowned are
// refused. Books nobody bound are served only when somebody claimed them, as
// they were before databases were bound, and are never bound here: only
// provisioning and the console's confirmation write a binding.
export function classifyTenantBooks(tenant: Tenant, file: BooksFile): TenantBooksVerdict {
  const provisioning = tenant.status === TenantStatusCode.Provisioning;
  const refused = (standing: TenantBooksStanding, refusal: TenantDbFileError, identity: TenantBooksIdentity | null = null): TenantBooksVerdict => ({ standing, identity, refusal });
  if (file.state === BooksFileState.Absent) {
    if (provisioning) return { standing: TenantBooksStanding.Provisioning, identity: null, refusal: null };
    return refused(TenantBooksStanding.Missing, new TenantDbFileMissingError(tenant.id, tenant.dbFile));
  }
  if (file.state === BooksFileState.Unreadable) return refused(TenantBooksStanding.Unreadable, new TenantDbFileUnreadableError(tenant.id, tenant.dbFile, file.cause));
  const books = file.identity;
  const accepted = (standing: TenantBooksStanding): TenantBooksVerdict => ({ standing, identity: books, refusal: null });
  if (tenant.booksReview) return refused(TenantBooksStanding.Disowned, new TenantDbFileDisownedError(tenant.id, tenant.dbFile), books);
  if (books.boundTenantId === tenant.id) return accepted(TenantBooksStanding.Bound);
  if (books.boundTenantId !== null) return refused(TenantBooksStanding.Foreign, new TenantDbFileForeignError(tenant.id, tenant.dbFile, books.boundTenantId), books);
  if (provisioning) return accepted(TenantBooksStanding.Provisioning);
  const claimed = tenantBooksClaimed({ claimedAt: books.claimedAt, userIds: books.users.map((user) => user.id) });
  if (!claimed) return refused(TenantBooksStanding.Foreign, new TenantDbFileForeignError(tenant.id, tenant.dbFile, null), books);
  return accepted(TenantBooksStanding.Unbound);
}

export interface BooksReviewRecord {
  readonly action: TenantBooksAudit;
  readonly actor: string;
  readonly details?: Record<string, unknown>;
  readonly inTheSameWrite?: () => void;
}

// REQUIRED ORDERING: the audit row is written inside the transaction that
// changes the platform row, and whatever is done to the books themselves comes
// after it in that same transaction. A row that cannot be written rolls the
// change back before the books are touched.
export async function recordBooksReview(platform: PlatformHandle, before: Tenant, after: Tenant, record: BooksReviewRecord): Promise<boolean> {
  return platform.stores.tenants.compareAndSetOwner(before, after, async () => {
    if (after.ownerEmail !== before.ownerEmail) await platform.stores.signupRequests.followOwnerEmail(before.code, before.ownerEmail, after.ownerEmail);
    await recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId: after.id,
      action: record.action,
      actor: record.actor,
      severity: AuditSeverityCode.Critical,
      timestamp: after.updatedAt,
      details: { code: after.code, before: before.booksReview ?? null, after: after.booksReview ?? null, ...record.details },
    }).catch((cause: unknown) => {
      throw new PlatformAuditUnavailableError(cause);
    });
    record.inTheSameWrite?.();
  });
}
