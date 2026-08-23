import { z } from "zod";

/** Wire contracts for الحضور والانصراف — Attendance (docs/catalog/06-crm-hr.md §"الحضور والانصراف"). */

export const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "HALF_DAY", "ON_LEAVE", "PUBLIC_HOLIDAY"]);
export const attendanceDayStatusSchema = z.enum([
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "ON_LEAVE",
  "PUBLIC_HOLIDAY",
  "WEEKLY_OFF",
]);

export const attendanceRecordSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  date: z.string(),
  status: attendanceStatusSchema,
  overtimeHours: z.number(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const markAttendanceSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string(),
  status: attendanceStatusSchema,
  overtimeHours: z.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});

export const employeeDayStatusSchema = z.object({
  date: z.string(),
  status: attendanceDayStatusSchema.nullable(),
  overtimeHours: z.number(),
});

export const employeeMonthGridSchema = z.object({
  employeeId: z.string(),
  days: z.array(employeeDayStatusSchema),
});

export const monthlyAttendanceSummarySchema = z.object({
  employeeId: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  workingDays: z.number(),
  presentDays: z.number(),
  absentDays: z.number(),
  halfDays: z.number(),
  onLeaveDays: z.number(),
  publicHolidayDays: z.number(),
  overtimeHours: z.number(),
  attendanceRate: z.number(),
});

export type AttendanceStatusDTO = z.infer<typeof attendanceStatusSchema>;
export type AttendanceDayStatusDTO = z.infer<typeof attendanceDayStatusSchema>;
export type AttendanceRecordDTO = z.infer<typeof attendanceRecordSchema>;
export type MarkAttendanceDTO = z.infer<typeof markAttendanceSchema>;
export type EmployeeDayStatusDTO = z.infer<typeof employeeDayStatusSchema>;
export type EmployeeMonthGridDTO = z.infer<typeof employeeMonthGridSchema>;
export type MonthlyAttendanceSummaryDTO = z.infer<typeof monthlyAttendanceSummarySchema>;
