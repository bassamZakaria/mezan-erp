import type { Project, ProjectStatus } from "./project.js";
import { canTransitionProject, PROJECT_STATUS_DEFINITIONS } from "./project.js";
import { InvalidProjectError, InvalidProjectTransitionError } from "./errors.js";
import type { ReasonInput } from "../bilingual-reasons.js";

function isValidStatus(status: ProjectStatus): boolean {
  return PROJECT_STATUS_DEFINITIONS.some((d) => d.code === status);
}

function validate(project: Project): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (project.nameAr.trim().length === 0) {
    reasons.push({ ar: "اسم المشروع مطلوب", en: "The project name is required" });
  }
  if (!isValidStatus(project.status)) {
    reasons.push({ ar: "حالة المشروع غير صالحة", en: "The project status is not valid" });
  }
  return reasons;
}

/** Applies a patch to an existing project, re-validating the result. Code, id and costCenterId are immutable. */
export function updateProject(current: Project, patch: Partial<Omit<Project, "id" | "code" | "costCenterId">>): Project {
  const next: Project = { ...current, ...patch };
  if (!isValidStatus(next.status)) throw new InvalidProjectError([{ ar: "حالة المشروع غير صالحة", en: "The project status is not valid" }]);
  if (!canTransitionProject(current.status, next.status)) {
    throw new InvalidProjectTransitionError(current.status, next.status);
  }
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidProjectError(reasons);
  return next;
}
