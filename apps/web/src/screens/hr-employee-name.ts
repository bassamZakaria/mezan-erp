import type { EmployeeDTO } from "@mezan/contracts";
import type { Locale } from "../i18n";

type NameFields = Pick<EmployeeDTO, "firstName" | "lastName" | "firstNameAr" | "lastNameAr">;

/**
 * An employee's name in the reading language, falling back to the other script
 * when that side of the record is blank.
 *
 * The HR screens used to prefer the Arabic name unconditionally, so the English
 * UI listed every employee in Arabic.
 */
export function employeeDisplayName(employee: NameFields, locale: Locale): string {
  const ar = [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim();
  const en = [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim();
  return locale === "ar" ? ar || en : en || ar;
}

/** A department or job title in the reading language, falling back to the other script. */
export function bilingualName(row: { name: string; nameAr: string | null }, locale: Locale): string {
  return locale === "ar" ? (row.nameAr ?? row.name) : (row.name || (row.nameAr ?? ""));
}
