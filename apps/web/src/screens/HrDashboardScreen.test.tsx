// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import type { BranchDTO, HrDashboardSummaryDTO } from "@mezan/contracts";
import { HrDashboardScreen } from "./HrDashboardScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleBranches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const sampleSummary: HrDashboardSummaryDTO = {
  activeEmployees: 5,
  onLeave: 1,
  hiresThisMonth: 2,
  terminationsThisMonth: 0,
  contractsExpiringSoon: 1,
  probationEndingSoon: 0,
  byDepartment: [{ departmentId: "dept-1", departmentName: "Sales", departmentNameAr: "المبيعات", count: 5 }],
  byBranch: [{ branchId: "MAIN", count: 5 }],
  leaveConsumption: [
    { leaveType: "annual", entitled: 21, used: 3, pending: 1, usedPercent: 14 },
    { leaveType: "sick", entitled: null, used: 0, pending: 0, usedPercent: null },
    { leaveType: "personal", entitled: null, used: 0, pending: 0, usedPercent: null },
  ],
  headcountTrend: [{ month: "2026-08", hires: 2, leavers: 0 }],
  attendance: {
    from: "2026-07-27",
    to: "2026-08-26",
    workingDays: 100,
    daysPresent: 80,
    daysLate: 10,
    halfDays: 2,
    daysAbsent: 5,
    daysOnLeave: 3,
    absenceRatePercent: 5,
    lateArrivalRatePercent: 11,
  },
};

function renderScreen() {
  const transport = stubTransport({
    "GET /hr/dashboard": () => ({ body: sampleSummary }),
    "GET /branches": () => ({ body: sampleBranches }),
  });
  return renderWithProviders(<HrDashboardScreen />, { transport, initialSession: testAdminSession });
}

describe("HrDashboardScreen", () => {
  it("renders the KPI tiles from the real backend summary", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "لوحة الموارد البشرية" })).toBeInTheDocument();
    expect(await screen.findByText("الموظفون النشطون")).toBeInTheDocument();
    const kpi = await screen.findAllByText("5");
    expect(kpi.length).toBeGreaterThan(0);
  });

  it("renders the leave-consumption table", async () => {
    renderScreen();
    expect(await screen.findByText("استهلاك الإجازات")).toBeInTheDocument();
    expect(await screen.findByText("إجازة سنوية")).toBeInTheDocument();
  });
});
