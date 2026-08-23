import type { AttendanceRecord, AttendanceRecordRepository } from "../attendance.js";

export function createInMemoryAttendanceRepository(): AttendanceRecordRepository {
  const byId = new Map<string, AttendanceRecord>();

  return {
    async findByEmployeeAndDate(employeeId, date) {
      for (const record of byId.values()) {
        if (record.employeeId === employeeId && record.date === date) return record;
      }
      return null;
    },
    async listForRange(employeeIds, fromDate, toDate) {
      const set = employeeIds ? new Set(employeeIds) : null;
      return [...byId.values()].filter(
        (r) => (!set || set.has(r.employeeId)) && r.date >= fromDate && r.date <= toDate,
      );
    },
    async save(record) {
      for (const [key, existing] of byId) {
        if (existing.employeeId === record.employeeId && existing.date === record.date && key !== record.id) {
          byId.delete(key);
          break;
        }
      }
      byId.set(record.id, record);
    },
  };
}
