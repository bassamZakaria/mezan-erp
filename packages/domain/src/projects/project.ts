import { Money } from "../money/index.js";

/**
 * Projects — core entity (docs/catalog/07-mfg-projects-assets.md "المشاريع
 * والمقاولات"). A `Project` is project/contract master data used to track
 * cost and billing; creating one auto-creates a linked `PRJ-{code}` cost
 * center for project costing (see create-project.ts).
 */

export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";

export interface ProjectStatusDefinition {
  readonly code: ProjectStatus;
  readonly labelAr: string;
}

export const PROJECT_STATUS_DEFINITIONS: readonly ProjectStatusDefinition[] = [
  { code: "planned", labelAr: "مخطط" },
  { code: "active", labelAr: "نشط" },
  { code: "on_hold", labelAr: "متوقف مؤقتاً" },
  { code: "completed", labelAr: "مكتمل" },
  { code: "cancelled", labelAr: "ملغي" },
] as const;

export function getProjectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export interface Project {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly status: ProjectStatus;
  readonly customerId: string | null;
  readonly managerId: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly budget: Money;
  readonly siteAddress: string | null;
  readonly notes: string | null;
  /** Id of the auto-created `PRJ-{code}` cost center (see create-project.ts). */
  readonly costCenterId: string;
}

/** Persistence port for projects. The domain depends on this interface only — no SQL, no driver. */
export interface ProjectRepository {
  findById(id: string): Promise<Project | null>;
  findByCode(code: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  create(project: Project): Promise<void>;
  update(project: Project): Promise<void>;
}
