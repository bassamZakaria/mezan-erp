import { normalizeEmail } from "../users/save-user.js";
import { isValidSlug } from "./slug.js";
import { isoTimestamp } from "./validation.js";
import {
  InvalidTenantError,
  InvalidTenantTransitionError,
  TenantCodeTakenError,
  TenantNotFoundError,
} from "./errors.js";
import { CompanyNameProblem, companyNameProblem, companyNameProblemAr } from "./company-name.js";

export enum TenantStatusCode {
  Provisioning = "provisioning",
  Active = "active",
  Suspended = "suspended",
  Archived = "archived",
}

export type TenantStatus = `${TenantStatusCode}`;

export interface Tenant {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly ownerEmail: string;
  readonly ownerUserId: string | null;
  readonly ownerContactVerified: boolean;
  readonly ownerNeeded?: boolean;
  readonly pendingOwner?: PendingOwner | null;
  readonly ownerRecordDue?: OwnerRecordDue | null;
  readonly status: TenantStatus;
  readonly dbFile: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PendingOwner {
  readonly userId: string;
  readonly email: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly tokenHash: string | null;
}

export enum OwnerConfirmation {
  PlatformConsole = "platform-console",
  PreviousOwnerLink = "previous-owner-link",
}

export interface OwnerRecordDue {
  readonly eventId: string;
  readonly userId: string;
  readonly previousUserId: string | null;
  readonly actor: string;
  readonly confirmedBy: OwnerConfirmation;
}

export const PENDING_OWNER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function pendingOwnerExpiresAt(requestedAt: string): string {
  return new Date(new Date(requestedAt).getTime() + PENDING_OWNER_MAX_AGE_MS).toISOString();
}

export function pendingOwnerExpired(pending: Pick<PendingOwner, "expiresAt">, now: string): boolean {
  return new Date(now).getTime() >= new Date(pending.expiresAt).getTime();
}

export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findByCode(code: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  save(tenant: Tenant): Promise<void>;
  /**
   * CONTRACT: writes `after`'s owner fields only while the stored row still carries
   * `before`'s, then runs `sideEffect` in the SAME transaction. False when
   * another writer moved the owner first; nothing is written then.
   */
  compareAndSetOwner(before: Tenant, after: Tenant, sideEffect: () => Promise<void>): Promise<boolean>;
  /**
   * CONTRACT: writes `after`'s status and code only while the stored row still carries
   * `before`'s. False when another writer moved the tenant first.
   */
  compareAndSetStatus(before: Tenant, after: Tenant): Promise<boolean>;
  setDbFile(id: string, from: string, to: string): Promise<boolean>;
}

export interface CreateTenantCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly ownerEmail: string;
  readonly now: string;
}

const FILE_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// SECURITY: a tenant's database is named by its id, never its code. A code is
// handed to the next company once a tenant is released; an id never is, so a
// reused code can never open another company's books.
export function tenantDbFile(tenantId: string): string {
  if (!FILE_SAFE_ID.test(tenantId)) throw new InvalidTenantError(["معرّف المنشأة لا يصلح اسمًا لملف قاعدة البيانات"]);
  return `tenants/${tenantId}.db`;
}

function validate(cmd: CreateTenantCommand): string[] {
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("المعرّف مطلوب");
  else if (!FILE_SAFE_ID.test(cmd.id)) reasons.push("معرّف المنشأة لا يصلح اسمًا لملف قاعدة البيانات");
  if (!isValidSlug(cmd.code)) reasons.push("الرمز يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو رقمًا أو شرطة داخلية");
  const nameProblem = companyNameProblem(cmd.nameAr);
  if (nameProblem === CompanyNameProblem.Empty) reasons.push("الاسم بالعربية مطلوب");
  else if (nameProblem) reasons.push(companyNameProblemAr(nameProblem));
  if (normalizeEmail(cmd.ownerEmail) === "") reasons.push("بريد المالك مطلوب");
  return reasons;
}

export async function createTenant(cmd: CreateTenantCommand, repo: TenantRepository): Promise<Tenant> {
  const now = isoTimestamp(cmd.now);
  const reasons = validate(cmd);
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now || reasons.length > 0) throw new InvalidTenantError(reasons);
  if (await repo.findByCode(cmd.code)) throw new TenantCodeTakenError(cmd.code);
  const tenant: Tenant = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn?.trim() || null,
    ownerEmail: normalizeEmail(cmd.ownerEmail),
    ownerUserId: null,
    ownerContactVerified: true,
    status: TenantStatusCode.Provisioning,
    dbFile: tenantDbFile(cmd.id),
    createdAt: now,
    updatedAt: now,
  };
  await repo.save(tenant);
  return tenant;
}

export interface TenantTransitionCommand {
  readonly id: string;
  readonly now: string;
}

const TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> = {
  [TenantStatusCode.Provisioning]: [TenantStatusCode.Active],
  [TenantStatusCode.Active]: [TenantStatusCode.Suspended, TenantStatusCode.Archived],
  [TenantStatusCode.Suspended]: [TenantStatusCode.Active, TenantStatusCode.Archived],
  [TenantStatusCode.Archived]: [],
};

async function transition(
  cmd: TenantTransitionCommand,
  to: TenantStatus,
  repo: TenantRepository,
  from?: readonly TenantStatus[],
): Promise<Tenant> {
  const now = isoTimestamp(cmd.now);
  if (!now) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (!TRANSITIONS[current.status].includes(to) || (from !== undefined && !from.includes(current.status))) {
    throw new InvalidTenantTransitionError(current.status, to);
  }
  const next: Tenant = { ...current, status: to, updatedAt: now };
  return moved(current, next, repo);
}

async function moved(current: Tenant, next: Tenant, repo: TenantRepository): Promise<Tenant> {
  if (await repo.compareAndSetStatus(current, next)) return next;
  const latest = await repo.findById(current.id);
  if (!latest) throw new TenantNotFoundError(current.id);
  throw new InvalidTenantTransitionError(latest.status, next.status);
}

export const activateTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Active, repo, [TenantStatusCode.Provisioning]);
export const suspendTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Suspended, repo);
export const archiveTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Archived, repo);
export const resumeTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Active, repo, [TenantStatusCode.Suspended]);

export function releasedTenantCode(id: string): string {
  return `released-${id}`;
}

export async function releaseTenant(cmd: TenantTransitionCommand, repo: TenantRepository): Promise<Tenant> {
  const now = isoTimestamp(cmd.now);
  if (!now) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (current.status !== TenantStatusCode.Provisioning) throw new InvalidTenantTransitionError(current.status, TenantStatusCode.Archived);
  const next: Tenant = { ...current, status: TenantStatusCode.Archived, code: releasedTenantCode(current.id), updatedAt: now };
  return moved(current, next, repo);
}

export interface TenantOwnerAccount {
  readonly id: string;
  readonly email: string;
}

export enum OwnerContactProof {
  OwnerActed = "owner_acted",
  Unproven = "unproven",
}

// SECURITY: the recorded address moves only on the owner's own act. An address
// anyone else gave the owner's account marks the contact unverified and leaves
// the recorded one where it was, so a PIN or an invoice is never sent to an
// inbox the owner has not shown they hold. Null means nothing changes.
export function tenantWithOwnerContact(tenant: Tenant, owner: TenantOwnerAccount, proof: OwnerContactProof, now: string): Tenant | null {
  const at = isoTimestamp(now);
  if (!at) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  if (tenant.ownerUserId !== null && tenant.ownerUserId !== owner.id) return null;
  const email = normalizeEmail(owner.email);
  if (email === "") throw new InvalidTenantError(["بريد المالك مطلوب"]);
  const settled = email === tenant.ownerEmail || proof === OwnerContactProof.OwnerActed;
  const next: Tenant = {
    ...tenant,
    ownerUserId: owner.id,
    ownerEmail: settled ? email : tenant.ownerEmail,
    ownerContactVerified: settled,
    ...(tenant.ownerNeeded ? { ownerNeeded: false } : {}),
    updatedAt: at,
  };
  const unchanged =
    next.ownerUserId === tenant.ownerUserId &&
    next.ownerEmail === tenant.ownerEmail &&
    next.ownerContactVerified === tenant.ownerContactVerified &&
    (tenant.ownerNeeded ?? false) === false;
  return unchanged ? null : next;
}

export function tenantNeedingOwner(tenant: Tenant, now: string): Tenant | null {
  const at = isoTimestamp(now);
  if (!at) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  if (tenant.ownerNeeded === true || tenant.pendingOwner) return null;
  return { ...tenant, ownerNeeded: true, updatedAt: at };
}

function successorOf(successor: TenantOwnerAccount, now: string): { readonly at: string; readonly email: string } {
  const at = isoTimestamp(now);
  const email = normalizeEmail(successor.email);
  const reasons: string[] = [];
  if (!at) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (email === "") reasons.push("بريد المالك مطلوب");
  if (!at || reasons.length > 0) throw new InvalidTenantError(reasons);
  return { at, email };
}

export function tenantHandedTo(tenant: Tenant, successor: TenantOwnerAccount, now: string): Tenant {
  const { at, email } = successorOf(successor, now);
  return {
    ...tenant,
    ownerUserId: successor.id,
    ownerEmail: email,
    ownerContactVerified: true,
    ...(tenant.ownerNeeded ? { ownerNeeded: false } : {}),
    ...(tenant.pendingOwner ? { pendingOwner: null } : {}),
    updatedAt: at,
  };
}

export function tenantWithPendingOwner(
  tenant: Tenant,
  successor: TenantOwnerAccount,
  request: { readonly requestedBy: string; readonly tokenHash: string | null },
  now: string,
): Tenant {
  const { at, email } = successorOf(successor, now);
  return { ...tenant, pendingOwner: { userId: successor.id, email, requestedBy: request.requestedBy, requestedAt: at, expiresAt: pendingOwnerExpiresAt(at), tokenHash: request.tokenHash },
    updatedAt: at,
  };
}

function pendingOf(tenant: Tenant): PendingOwner {
  if (!tenant.pendingOwner) throw new InvalidTenantError(["لا يوجد مالك بانتظار التأكيد لهذه المنشأة"]);
  return tenant.pendingOwner;
}

export function tenantWithPendingOwnerDeclined(tenant: Tenant, now: string): Tenant {
  pendingOf(tenant);
  const at = isoTimestamp(now);
  if (!at) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  return { ...tenant, pendingOwner: null, updatedAt: at };
}

export enum PendingOwnerLink {
  Reissued = "reissued",
  Withdrawn = "withdrawn",
}

export function tenantWithPendingOwnerLink(tenant: Tenant, link: PendingOwnerLink, tokenHash: string | null, now: string): Tenant {
  const pending = pendingOf(tenant);
  const at = isoTimestamp(now);
  if (!at) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  const next: PendingOwner = link === PendingOwnerLink.Reissued ? { ...pending, requestedAt: at, expiresAt: pendingOwnerExpiresAt(at), tokenHash } : { ...pending, tokenHash: null };
  return { ...tenant, pendingOwner: next, updatedAt: at };
}

export function tenantWithOwnerRecordDue(tenant: Tenant, due: OwnerRecordDue | null): Tenant {
  return { ...tenant, ownerRecordDue: due };
}

export function tenantWithPendingOwnerConfirmed(tenant: Tenant, now: string): Tenant {
  if (!tenant.pendingOwner) throw new InvalidTenantError(["لا يوجد مالك بانتظار التأكيد لهذه المنشأة"]);
  return tenantHandedTo(tenant, { id: tenant.pendingOwner.userId, email: tenant.pendingOwner.email }, now);
}
