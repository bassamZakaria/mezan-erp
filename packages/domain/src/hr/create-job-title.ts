import { InvalidJobTitleError } from "./errors.js";
import type { JobTitle, JobTitleRepository } from "./job-title.js";
import type { ReasonInput } from "../bilingual-reasons.js";

export interface CreateJobTitleCommand {
  readonly id: string;
  readonly departmentId: string;
  readonly name: string;
  readonly nameAr?: string | null;
}

function validate(command: CreateJobTitleCommand): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (command.departmentId.trim().length === 0) reasons.push({ ar: "القسم مطلوب", en: "The department is required" });
  if (command.name.trim().length === 0) reasons.push({ ar: "اسم المسمى الوظيفي مطلوب", en: "The job title name is required" });
  return reasons;
}

/** Creates and persists a new job title, scoped to one department. */
export async function createJobTitle(command: CreateJobTitleCommand, repo: JobTitleRepository): Promise<JobTitle> {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidJobTitleError(reasons);

  const jobTitle: JobTitle = {
    id: command.id,
    departmentId: command.departmentId,
    name: command.name,
    nameAr: command.nameAr ?? null,
    active: true,
    createdAt: new Date().toISOString(),
  };

  await repo.create(jobTitle);
  return jobTitle;
}

/** Applies a patch to an existing job title (edit dialog). Department is locked after create (catalog: "القسم * — disabled/locked in edit mode"). */
export function updateJobTitle(current: JobTitle, patch: Partial<Pick<JobTitle, "name" | "nameAr" | "active">>): JobTitle {
  const next: JobTitle = { ...current, ...patch };
  const reasons = validate({ id: next.id, departmentId: next.departmentId, name: next.name, nameAr: next.nameAr });
  if (reasons.length > 0) throw new InvalidJobTitleError(reasons);
  return next;
}
