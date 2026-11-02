import { InvalidDepartmentError } from "./errors.js";
import type { Department, DepartmentRepository } from "./department.js";
import type { ReasonInput } from "../bilingual-reasons.js";

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

function validate(command: CreateDepartmentCommand): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (command.code.trim().length === 0) reasons.push({ ar: "كود القسم مطلوب", en: "The department code is required" });
  if (command.name.trim().length === 0) reasons.push({ ar: "اسم القسم مطلوب", en: "The department name is required" });
  if (command.parentDepartmentId === command.id) reasons.push({ ar: "لا يمكن أن يكون القسم أباً لنفسه", en: "A department cannot be its own parent" });
  return reasons;
}

/** Creates and persists a new department. */
export async function createDepartment(command: CreateDepartmentCommand, repo: DepartmentRepository): Promise<Department> {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidDepartmentError(reasons);

  const existing = await repo.findByCode(command.code);
  if (existing) throw new InvalidDepartmentError([{ ar: `كود القسم "${command.code}" مستخدم بالفعل`, en: `The department code "${command.code}" is already in use` }]);

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
