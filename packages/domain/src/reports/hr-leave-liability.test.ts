import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Contract } from "../hr/contract.js";
import type { Employee } from "../hr/employee.js";
import type { LeaveBalance } from "../hr/leave-balance.js";
import type { LeavePolicy } from "../hr/leave-policy.js";
import { createLeaveLiabilityReport } from "./hr-workforce.js";

const employee = { id: "E1", code: "EMP-1", firstName: "A", lastName: "B", firstNameAr: "أحمد", lastNameAr: "محمود", status: "active" } as unknown as Employee;
const contract = {
  id: "C1",
  employeeId: "E1",
  startDate: "2024-01-01",
  endDate: null,
  monthlySalary: Money.fromMajor("3000"),
  allowances: [],
} as unknown as Contract;
const policy = { leaveType: "annual", payoutOnTermination: true, active: true } as unknown as LeavePolicy;

function balance(year: number, entitled: string, carriedOver: string, used: string): LeaveBalance {
  return {
    id: `B-${year}`,
    employeeId: "E1",
    leaveType: "annual",
    year,
    entitled: Qty.fromMajor(entitled),
    carriedOver: Qty.fromMajor(carriedOver),
    used: Qty.fromMajor(used),
    createdAt: "",
    updatedAt: "",
  } as LeaveBalance;
}

describe("التزام رصيد الإجازات", () => {
  it("prices only the as-of year's balance, whose carry-over already holds last year's unused days", () => {
    const report = createLeaveLiabilityReport();
    // 2025 closed with 6 unused days, which 2026 carries in; 2027 is after the as-of date.
    const rows = report.run(
      { asOfDate: "2026-09-18" },
      {
        employees: [employee],
        contracts: [contract],
        balances: [balance(2025, "21", "0", "15"), balance(2026, "0", "6", "0"), balance(2027, "21", "6", "0")],
        policies: [policy],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: "E1", leaveType: "annual", availableDays: 6, dailyRate: 100, liability: 600 });
    expect(new Set(rows.map(report.rowKey)).size).toBe(rows.length);
  });
});
