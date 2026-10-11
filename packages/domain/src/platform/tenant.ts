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
  /** The last address the owner themself is known to answer at. The tenant's own user row is the truth; this is a cache of it. */
  readonly ownerEmail: string;
  /** The owner's user id inside the tenant's own database. Null until the owner account exists or has been linked. */
  readonly ownerUserId: string | null;
  /** False while the owner's sign-in address differs from `ownerEmail` and the owner has not yet proved the new one. */
  readonly ownerContactVerified: boolean;
  readonly status: TenantStatus;
  readonly dbFile: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findByCode(code: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  save(tenant: Tenant): Promise<void>;
  /**
   * Writes `after`'s owner fields only while the stored row still carries
   * `before`'s, then runs `sideEffect` in the SAME transaction. False when
   * another writer moved the owner first; nothing is written then.
   */
  compareAndSetOwner(before: Tenant, after: Tenant, sideEffect: () => Promise<void>): Promise<boolean>;
}

export interface CreateTenantCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly ownerEmail: string;
  readonly now: string;
}

export function tenantDbFile(code: string): string {
  return `tenants/${code}.db`;
}

function validate(cmd: CreateTenantCommand): string[] {
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("المعرّف مطلوب");
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
    dbFile: tenantDbFile(cmd.code),
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
  await repo.save(next);
  return next;
}

export const activateTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Active, repo, [TenantStatusCode.Provisioning]);
export const suspendTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Suspended, repo);
export const archiveTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Archived, repo);
export const resumeTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, TenantStatusCode.Active, repo, [TenantStatusCode.Suspended]);

export function releasedTenantCode(id: string): string {
  return `released-${id}`;
}

/**
 * Archives a tenant that never finished provisioning and gives it a code and
 * database file of its own, so the code it was holding can be signed up again.
 * The caller moves the database file to match before this is written.
 */
export async function releaseTenant(cmd: TenantTransitionCommand, repo: TenantRepository): Promise<Tenant> {
  const now = isoTimestamp(cmd.now);
  if (!now) throw new InvalidTenantError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (current.status !== TenantStatusCode.Provisioning) throw new InvalidTenantTransitionError(current.status, TenantStatusCode.Archived);
  const code = releasedTenantCode(current.id);
  const next: Tenant = { ...current, status: TenantStatusCode.Archived, code, dbFile: tenantDbFile(code), updatedAt: now };
  await repo.save(next);
  return next;
}

export interface TenantOwnerAccount {
  readonly id: string;
  readonly email: string;
}

export enum OwnerContactProof {
  /** The owner themself set or signed in with the address. */
  OwnerActed = "owner_acted",
  /** The address is only what the tenant's database currently says. */
  Unproven = "unproven",
}

/**
 * The tenant row once it reflects `owner`, or null when it already does.
 *
 * SECURITY: the recorded address moves only on the owner's own act. An address
 * anyone else gave the owner's account marks the contact unverified and leaves
 * the recorded one where it was, so a PIN or an invoice is never sent to an
 * inbox the owner has not shown they hold.
 */
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
    updatedAt: at,
  };
  const unchanged =
    next.ownerUserId === tenant.ownerUserId && next.ownerEmail === tenant.ownerEmail && next.ownerContactVerified === tenant.ownerContactVerified;
  return unchanged ? null : next;
}

/** The tenant row once `successor` owns it. `verified` is whether the successor themself made the hand-over. */
export function tenantHandedTo(tenant: Tenant, successor: TenantOwnerAccount, verified: boolean, now: string): Tenant {
  const at = isoTimestamp(now);
  const email = normalizeEmail(successor.email);
  const reasons: string[] = [];
  if (!at) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (email === "") reasons.push("بريد المالك مطلوب");
  if (!at || reasons.length > 0) throw new InvalidTenantError(reasons);
  return { ...tenant, ownerUserId: successor.id, ownerEmail: email, ownerContactVerified: verified, updatedAt: at };
}
