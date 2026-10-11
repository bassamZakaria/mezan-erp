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
    status: "provisioning",
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
  provisioning: ["active"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: [],
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

export const activateTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "active", repo, ["provisioning"]);
export const suspendTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "suspended", repo);
export const archiveTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "archived", repo);
export const resumeTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "active", repo, ["suspended"]);
