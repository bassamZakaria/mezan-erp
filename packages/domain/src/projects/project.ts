import { Money } from "../money/index.js";

/**
 * Projects — core entity (docs/archive/catalog/07-mfg-projects-assets.md "المشاريع
 * والمقاولات"). A `Project` is project/contract master data used to track
 * cost and billing; creating one auto-creates a linked `PRJ-{code}` cost
 * center for project costing (see create-project.ts).
 */

export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";

export interface ProjectStatusDefinition {
  readonly code: ProjectStatus;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const PROJECT_STATUS_DEFINITIONS: readonly ProjectStatusDefinition[] = [
  { code: "planned", labelAr: "مخطط", labelEn: "planned" },
  { code: "active", labelAr: "نشط", labelEn: "active" },
  { code: "on_hold", labelAr: "متوقف مؤقتاً", labelEn: "on hold" },
  { code: "completed", labelAr: "مكتمل", labelEn: "completed" },
  { code: "cancelled", labelAr: "ملغي", labelEn: "cancelled" },
] as const;

/**
 * Legal project status transitions. A project is planned before it starts, may
 * be paused and resumed any number of times, and ends either مكتمل or ملغي —
 * both terminal, because a completed or cancelled project that can be dragged
 * back to نشط makes its cost centre's closed figures meaningless.
 *
 * Nothing guarded this before: any status reached any other, on the client and
 * on the server alike, so a completed project could go back to "planned".
 */
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planned: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Whether `from → to` is a legal project transition. Staying put is always legal. */
export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return from === to || PROJECT_TRANSITIONS[from].includes(to);
}

export function getProjectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export function getProjectStatusLabelEn(status: ProjectStatus): string {
  return PROJECT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelEn ?? status;
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
