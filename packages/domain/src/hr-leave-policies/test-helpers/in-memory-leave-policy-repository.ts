import type { LeavePolicyRepository, LeavePolicyVersion } from "../leave-policy.js";
import type { LeaveTypeCode } from "../leave-type.js";
import { LEAVE_TYPE_CODES } from "../leave-type.js";

export function createInMemoryLeavePolicyRepository(): LeavePolicyRepository {
  const versions: LeavePolicyVersion[] = [];

  function versionsFor(leaveTypeCode: LeaveTypeCode): LeavePolicyVersion[] {
    return versions.filter((v) => v.leaveTypeCode === leaveTypeCode).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }

  return {
    async listVersions(leaveTypeCode) {
      return versionsFor(leaveTypeCode);
    },
    async listEffective(asOfDate) {
      const result: LeavePolicyVersion[] = [];
      for (const code of LEAVE_TYPE_CODES) {
        const effective = versionsFor(code).find((v) => v.effectiveDate <= asOfDate);
        if (effective) result.push(effective);
      }
      return result;
    },
    async findEffective(leaveTypeCode, asOfDate) {
      return versionsFor(leaveTypeCode).find((v) => v.effectiveDate <= asOfDate) ?? null;
    },
    async create(version) {
      versions.push(version);
    },
  };
}
