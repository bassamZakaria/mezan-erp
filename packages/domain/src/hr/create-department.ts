import { InvalidDepartmentError } from "./errors.js";
import type { Department, DepartmentRepository } from "./department.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

export interface CreateDepartmentCommand {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null;
  readonly parentDepartmentId?: string | null;
  readonly managerId?: string | null;
  readonly overtimeEligible?: boolean;
  readonly standardWorkHours?: number | null;
}

function validate(command: CreateDepartmentCommand): string[] {
  const reasons: string[] = [];
  if (command.code.trim().length === 0) reasons.push("كود القسم مطلوب");
  if (command.name.trim().length === 0) reasons.push("اسم القسم مطلوب");
  if (command.parentDepartmentId === command.id) reasons.push("لا يمكن أن يكون القسم أباً لنفسه");
  return reasons;
}

/** Creates and persists a new department. */
export async function createDepartment(command: CreateDepartmentCommand, repo: DepartmentRepository): Promise<Department> {
  assertRecordIdIsNew(await repo.findById(command.id), command.id);
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidDepartmentError(reasons);

  const existing = await repo.findByCode(command.code);
  if (existing) throw new InvalidDepartmentError([`كود القسم "${command.code}" مستخدم بالفعل`]);

  const department: Department = {
    id: command.id,
    code: command.code,
    name: command.name,
    nameAr: command.nameAr ?? null,
    parentDepartmentId: command.parentDepartmentId ?? null,
    managerId: command.managerId ?? null,
    overtimeEligible: command.overtimeEligible ?? true,
    standardWorkHours: command.standardWorkHours ?? null,
    active: true,
    createdAt: new Date().toISOString(),
  };

  await repo.create(department);
  return department;
}

/** Applies a patch to an existing department (edit dialog), re-validating. Code is immutable after create. */
export function updateDepartment(current: Department, patch: Partial<Omit<Department, "id" | "code" | "createdAt">>): Department {
  const next: Department = { ...current, ...patch };
  const reasons = validate({ ...next, id: next.id, code: next.code });
  if (reasons.length > 0) throw new InvalidDepartmentError(reasons);
  return next;
}
