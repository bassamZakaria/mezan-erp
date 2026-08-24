import type { Project, ProjectStatus } from "./project.js";
import { canTransitionProject, PROJECT_STATUS_DEFINITIONS } from "./project.js";
import { InvalidProjectError, InvalidProjectTransitionError } from "./errors.js";

function isValidStatus(status: ProjectStatus): boolean {
  return PROJECT_STATUS_DEFINITIONS.some((d) => d.code === status);
}

function validate(project: Project): string[] {
  const reasons: string[] = [];
  if (project.nameAr.trim().length === 0) {
    reasons.push("اسم المشروع مطلوب");
  }
  if (!isValidStatus(project.status)) {
    reasons.push("حالة المشروع غير صالحة");
  }
  return reasons;
}

/** Applies a patch to an existing project, re-validating the result. Code, id and costCenterId are immutable. */
export function updateProject(current: Project, patch: Partial<Omit<Project, "id" | "code" | "costCenterId">>): Project {
  const next: Project = { ...current, ...patch };
  if (!isValidStatus(next.status)) throw new InvalidProjectError(["حالة المشروع غير صالحة"]);
  if (!canTransitionProject(current.status, next.status)) {
    throw new InvalidProjectTransitionError(current.status, next.status);
  }
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidProjectError(reasons);
  return next;
}
