import { isValidSlug } from "./slug.js";
import {
  InvalidTenantError,
  InvalidTenantTransitionError,
  TenantCodeTakenError,
  TenantNotFoundError,
} from "./errors.js";

export type TenantStatus = "provisioning" | "active" | "suspended" | "archived";

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

export function normalizeTenantEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function tenantDbFile(code: string): string {
  return `tenants/${code}.db`;
}

function validate(cmd: CreateTenantCommand): string[] {
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("id is required");
  if (!isValidSlug(cmd.code)) reasons.push("code must be a slug of 3 to 32 lower-case letters, digits or inner hyphens");
  if (cmd.nameAr.trim() === "") reasons.push("nameAr is required");
  if (normalizeTenantEmail(cmd.ownerEmail) === "") reasons.push("ownerEmail is required");
  return reasons;
}

export async function createTenant(cmd: CreateTenantCommand, repo: TenantRepository): Promise<Tenant> {
  const reasons = validate(cmd);
  if (reasons.length > 0) throw new InvalidTenantError(reasons);
  if (await repo.findByCode(cmd.code)) throw new TenantCodeTakenError(cmd.code);
  const tenant: Tenant = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn?.trim() || null,
    ownerEmail: normalizeTenantEmail(cmd.ownerEmail),
    status: "provisioning",
    dbFile: tenantDbFile(cmd.code),
    createdAt: cmd.now,
    updatedAt: cmd.now,
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
): Promise<Tenant> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (!TRANSITIONS[current.status].includes(to)) {
    throw new InvalidTenantTransitionError(current.status, to);
  }
  const next: Tenant = { ...current, status: to, updatedAt: cmd.now };
  await repo.save(next);
  return next;
}

export const activateTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "active", repo);
export const suspendTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "suspended", repo);
export const archiveTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "archived", repo);

export async function resumeTenant(cmd: TenantTransitionCommand, repo: TenantRepository): Promise<Tenant> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (current.status !== "suspended") throw new InvalidTenantTransitionError(current.status, "active");
  return transition(cmd, "active", repo);
}
