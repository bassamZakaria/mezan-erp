import { Money } from "../money/index.js";
import { createCostCenter, type CostCenterRepository } from "../cost-centers/index.js";
import type { Project, ProjectRepository } from "./project.js";
import { DuplicateProjectCodeError } from "./errors.js";

export interface CreateProjectCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly customerId?: string | null;
  readonly managerId?: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly budget?: Money;
  readonly siteAddress?: string | null;
  readonly notes?: string | null;
  /**
   * The cost centre to book this project against.
   *
   * An id that already exists is LINKED, not recreated — that is how a project
   * is attached to a cost centre the books already use. An id that does not is
   * created as this project's own. Omitted, it defaults to `cc-prj-${id}`.
   */
  readonly costCenterId?: string;
}

export interface CreateProjectDeps {
  readonly projects: ProjectRepository;
  readonly costCenters: CostCenterRepository;
}

/**
 * Creates and persists a new project, auto-creating a linked `PRJ-{code}`
 * cost center via the real cost-centers domain (docs/archive/catalog/07
 * "المشاريع والمقاولات") — the module's whole point. New projects always
 * start `planned`.
 */
export async function createProject(cmd: CreateProjectCommand, deps: CreateProjectDeps): Promise<Project> {
  const existing = await deps.projects.list();
  if (existing.some((p) => p.code === cmd.code)) {
    throw new DuplicateProjectCodeError(cmd.code);
  }

  const costCenterId = cmd.costCenterId ?? `cc-prj-${cmd.id}`;
  const existingCostCenter = await deps.costCenters.findById(costCenterId);
  const costCenter =
    existingCostCenter ??
    (await createCostCenter(
      { id: costCenterId, code: `PRJ-${cmd.code}`, nameAr: cmd.nameAr, type: "project" },
      deps.costCenters,
    ));

  const project: Project = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn ?? null,
    status: "planned",
    customerId: cmd.customerId ?? null,
    managerId: cmd.managerId ?? null,
    startDate: cmd.startDate ?? null,
    endDate: cmd.endDate ?? null,
    budget: cmd.budget ?? Money.zero(),
    siteAddress: cmd.siteAddress ?? null,
    notes: cmd.notes ?? null,
    costCenterId: costCenter.id,
  };

  await deps.projects.create(project);
  return project;
}
