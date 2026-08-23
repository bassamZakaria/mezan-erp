import type { LeaveApplication, LeaveApplicationRepository } from "../leave-request.js";

export function createInMemoryLeaveApplicationRepository(): LeaveApplicationRepository {
  const byId = new Map<string, LeaveApplication>();

  return {
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async list(filter) {
      return [...byId.values()].filter((r) => {
        if (filter?.employeeId && r.employeeId !== filter.employeeId) return false;
        if (filter?.status && r.status !== filter.status) return false;
        if (filter?.leaveTypeCode && r.leaveTypeCode !== filter.leaveTypeCode) return false;
        return true;
      });
    },
    async create(request) {
      byId.set(request.id, request);
    },
    async update(request) {
      byId.set(request.id, request);
    },
  };
}
