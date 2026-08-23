import { z } from "zod";

/** Wire contract for the minimal employee directory read-model `hr-time-leave`'s screens use for employee pickers, ahead of `hr/master-data`'s full Employee model landing. */
export const employeeRefSchema = z.object({
  id: z.string().min(1),
  code: z.string(),
  nameAr: z.string(),
  departmentId: z.string().nullable(),
  active: z.boolean(),
});

export type EmployeeRefDTO = z.infer<typeof employeeRefSchema>;
