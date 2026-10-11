import { InvalidJobTitleError } from "./errors.js";
import type { JobTitle, JobTitleRepository } from "./job-title.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

export interface CreateJobTitleCommand {
  readonly id: string;
  readonly departmentId: string;
  readonly name: string;
  readonly nameAr?: string | null;
}

function validate(command: CreateJobTitleCommand): string[] {
  const reasons: string[] = [];
  if (command.departmentId.trim().length === 0) reasons.push("القسم مطلوب");
  if (command.name.trim().length === 0) reasons.push("اسم المسمى الوظيفي مطلوب");
  return reasons;
}

/** Creates and persists a new job title, scoped to one department. */
export async function createJobTitle(command: CreateJobTitleCommand, repo: JobTitleRepository): Promise<JobTitle> {
  assertRecordIdIsNew(await repo.findById(command.id), command.id);
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
