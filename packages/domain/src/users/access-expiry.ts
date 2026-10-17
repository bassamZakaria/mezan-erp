import { EXTERNAL_AUDITOR_MAX_ACCESS_DAYS, timeBoxedTemplateForRoleCode } from "../roles/templates.js";
import type { User } from "./user.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export enum AccessExpiryProblem {
  Unparseable = "unparseable",
  OnCompanyAdmin = "on_company_admin",
  RequiredForRole = "required_for_role",
  TooLong = "too_long",
}

export class InvalidAccessExpiryError extends Error {
  readonly code = "INVALID_ACCESS_EXPIRY";
  constructor(
    readonly problem: AccessExpiryProblem,
    message: string,
  ) {
    super(message);
    this.name = "InvalidAccessExpiryError";
  }
}

export function accessExpiresAtMs(user: Pick<User, "accessExpiresAt">): number | null {
  if (!user.accessExpiresAt) return null;
  const at = Date.parse(user.accessExpiresAt);
  // SECURITY: a stored expiry that no longer parses is treated as already passed, never as "no expiry".
  return Number.isNaN(at) ? 0 : at;
}

export function isAccessExpired(user: Pick<User, "accessExpiresAt">, nowMs: number): boolean {
  const at = accessExpiresAtMs(user);
  return at !== null && nowMs >= at;
}

export interface AccessExpiryRule {
  readonly accessExpiresAt: string | null;
  readonly isCompanyAdmin: boolean;
  readonly roleCode: string | null;
}

/**
 * A time-boxed role (the external auditor template, or a numbered copy of it)
 * must carry an expiry, and no longer than the template's ceiling; a company
 * admin may not carry one, because an admin whose access lapses can lock the
 * company out of its own books.
 */
export function accessExpiryProblem(rule: AccessExpiryRule, nowMs: number): InvalidAccessExpiryError | null {
  if (rule.accessExpiresAt === null) {
    const template = timeBoxedTemplateForRoleCode(rule.roleCode);
    return template
      ? new InvalidAccessExpiryError(AccessExpiryProblem.RequiredForRole, "هذا الدور مؤقت: حدّد تاريخ انتهاء الوصول للمستخدم.")
      : null;
  }
  const at = Date.parse(rule.accessExpiresAt);
  if (Number.isNaN(at)) return new InvalidAccessExpiryError(AccessExpiryProblem.Unparseable, "تاريخ انتهاء الوصول غير صالح.");
  if (rule.isCompanyAdmin) {
    return new InvalidAccessExpiryError(AccessExpiryProblem.OnCompanyAdmin, "لا يُحدَّد تاريخ انتهاء وصول لمدير الشركة.");
  }
  if (timeBoxedTemplateForRoleCode(rule.roleCode) && at - nowMs > EXTERNAL_AUDITOR_MAX_ACCESS_DAYS * DAY_MS) {
    return new InvalidAccessExpiryError(
      AccessExpiryProblem.TooLong,
      `الوصول المؤقت لا يتجاوز ${EXTERNAL_AUDITOR_MAX_ACCESS_DAYS} يومًا من اليوم.`,
    );
  }
  return null;
}
