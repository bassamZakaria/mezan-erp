/**
 * Licensable sub-modules — parts of a module a plan can grant on their own
 * (docs/superpowers/specs/2026-10-31-licensable-sub-modules-design.md).
 *
 * A part is a dotted id in the same `activeModules` list as whole modules.
 * Holding the parent grants every part; holding a part never grants the
 * parent or a sibling. A free part is held by every plan.
 */

export enum HrSubModule {
  People = "hr.people",
  Contracts = "hr.contracts",
  Time = "hr.time",
  Payroll = "hr.payroll",
  Self = "hr.self",
}

export const SUB_MODULES: Readonly<Record<string, readonly string[]>> = {
  hr: Object.values(HrSubModule),
};

/** Parts every plan holds without listing them. */
export const FREE_SUB_MODULES: ReadonlySet<string> = new Set<string>([HrSubModule.People]);

export const SUB_MODULE_NAMES: Readonly<Record<string, { readonly ar: string; readonly en: string }>> = {
  [HrSubModule.People]: { ar: "الأفراد", en: "People" },
  [HrSubModule.Contracts]: { ar: "العقود", en: "Contracts" },
  [HrSubModule.Time]: { ar: "الدوام والإجازات", en: "Time and leave" },
  [HrSubModule.Payroll]: { ar: "الرواتب", en: "Payroll" },
  [HrSubModule.Self]: { ar: "الخدمة الذاتية", en: "Self-service" },
};

const PARENT_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(SUB_MODULES).flatMap(([parent, parts]) => parts.map((part) => [part, parent] as const)),
);

/** The parent module of a known part, or null for a whole module or an unknown id. */
export function parentOf(id: string): string | null {
  return PARENT_OF.get(id) ?? null;
}

export function isSubModule(id: string): boolean {
  return PARENT_OF.has(id);
}
