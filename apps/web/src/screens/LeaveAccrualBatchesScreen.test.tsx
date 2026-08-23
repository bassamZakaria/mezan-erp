// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { LeaveAccrualBatchDTO } from "@mezan/contracts";
import { LeaveAccrualBatchesScreen } from "./LeaveAccrualBatchesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleBatches: LeaveAccrualBatchDTO[] = [
  {
    id: "batch-1",
    period: "2026-08",
    runDate: "2026-08-01",
    runType: "MANUAL",
    status: "posted",
    lines: [{ employeeId: "emp-1", leaveTypeCode: "ANNUAL", creditedDays: 1.75, value: "175.000000" }],
    totalDays: 1.75,
    totalValue: "175.000000",
    journalEntryId: "je-1",
    executedBy: "USER-ADMIN",
    createdAt: "2026-08-01T00:00:00.000Z",
    postedAt: "2026-08-01T00:00:00.000Z",
  },
];

function renderScreen(batches: LeaveAccrualBatchDTO[] = sampleBatches) {
  let current = [...batches];
  const transport = stubTransport({
    "GET /hr/leave-accrual": () => ({ body: current }),
    "POST /hr/leave-accrual/run-now": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: LeaveAccrualBatchDTO = {
        id: "batch-2",
        period: String(body.runDate).slice(0, 7),
        runDate: body.runDate,
        runType: "MANUAL",
        status: "posted",
        lines: [{ employeeId: "emp-1", leaveTypeCode: "ANNUAL", creditedDays: 1.75, value: "175.000000" }],
        totalDays: 1.75,
        totalValue: "175.000000",
        journalEntryId: "je-2",
        executedBy: "USER-ADMIN",
        createdAt: "2026-09-01T00:00:00.000Z",
        postedAt: "2026-09-01T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<LeaveAccrualBatchesScreen />, { transport, initialSession: testAdminSession });
}

describe("LeaveAccrualBatchesScreen", () => {
  it("lists accrual batches from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "استحقاقات الإجازات" })).toBeInTheDocument();
    expect(await screen.findByText("2026-08-01")).toBeInTheDocument();
    expect(screen.getAllByText("مرحّل").length).toBeGreaterThan(0);
  });

  it("shows the empty state when there are no batches yet", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد دورات استحقاق بعد/)).toBeInTheDocument();
  });

  it("runs a new accrual batch through the side panel", async () => {
    renderScreen();
    await screen.findByText("2026-08-01");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل استحقاق الآن" }));

    const dialog = screen.getByRole("dialog", { name: "تشغيل استحقاق الآن" });
    fireEvent.change(within(dialog).getByLabelText("تاريخ التشغيل *"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("2026-09-01")).toBeInTheDocument();
  });

  it("opens the batch detail panel listing its lines on row click", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("2026-08-01"));

    const detail = screen.getByRole("dialog", { name: /دورة استحقاق —/ });
    expect(within(detail).getByText(/je-1/)).toBeInTheDocument();
    expect(within(detail).getByText("emp-1")).toBeInTheDocument();
  });
});
