// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { LeavePolicyVersionDTO } from "@mezan/contracts";
import { LeavePoliciesScreen } from "./LeavePoliciesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { LeavePolicyPresetRecord } from "../data/hooks";

const samplePresets: LeavePolicyPresetRecord[] = [
  {
    source: "PRESET_EG_LAW_12_2003",
    labelAr: "مصر — قانون 12 لسنة 2003",
    effectiveDate: "2003-07-07",
    rows: [
      { leaveTypeCode: "ANNUAL", baseBalanceDays: 21, accrualFrequency: "MONTHLY", carryover: "LIMITED", carryoverMaxDays: 6, payoutOnTermination: true, legallyMandatory: true },
    ],
  },
];

function renderScreen(versions: LeavePolicyVersionDTO[] = []) {
  let current = [...versions];
  const transport = stubTransport({
    "GET /hr/leave-policies": () => ({ body: current }),
    "GET /hr/leave-policies/presets": () => ({ body: samplePresets }),
    "POST /hr/leave-policies/apply-preset": () => {
      const applied: LeavePolicyVersionDTO = {
        id: "v1",
        leaveTypeCode: "ANNUAL",
        effectiveDate: "2003-07-07",
        baseBalanceDays: 21,
        accrualFrequency: "MONTHLY",
        carryover: "LIMITED",
        carryoverMaxDays: 6,
        payoutOnTermination: true,
        legallyMandatory: true,
        source: "PRESET_EG_LAW_12_2003",
        createdAt: "2026-08-01T00:00:00.000Z",
      };
      current = [applied];
      return { status: 201, body: [applied] };
    },
    "POST /hr/leave-policies": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const saved: LeavePolicyVersionDTO = { id: "v2", ...body, source: "MANUAL", createdAt: "2026-08-01T00:00:00.000Z" };
      current = [...current.filter((v) => v.leaveTypeCode !== body.leaveTypeCode), saved];
      return { status: 201, body: saved };
    },
  });
  return renderWithProviders(<LeavePoliciesScreen />, { transport, initialSession: testAdminSession });
}

describe("LeavePoliciesScreen", () => {
  it("shows the empty-state message when no policies are configured yet", async () => {
    renderScreen();
    expect(await screen.findByText(/لا توجد سياسات إجازات معدة حالياً/)).toBeInTheDocument();
  });

  it("lists all 8 leave types in the matrix", async () => {
    renderScreen();
    await screen.findByText(/لا توجد سياسات إجازات معدة حالياً/);
    expect(screen.getByText("إجازة سنوية")).toBeInTheDocument();
    expect(screen.getByText("إجازة مرضية")).toBeInTheDocument();
    expect(screen.getByText("إجازة أبوة")).toBeInTheDocument();
  });

  it("applies a preset, populating the matrix", async () => {
    renderScreen();
    await screen.findByText(/لا توجد سياسات إجازات معدة حالياً/);
    await screen.findByRole("option", { name: "مصر — قانون 12 لسنة 2003" });

    fireEvent.change(screen.getByLabelText("اختر إعداداً..."), { target: { value: "PRESET_EG_LAW_12_2003" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق إعداد جاهز" }));

    expect(await screen.findByText("21")).toBeInTheDocument();
  });

  it("edits a leave type's policy through the side panel", async () => {
    renderScreen();
    await screen.findByText(/لا توجد سياسات إجازات معدة حالياً/);

    fireEvent.click(screen.getAllByRole("button", { name: "تعديل" })[0]!);
    const dialog = screen.getByRole("dialog", { name: /تعديل سياسة —/ });
    fireEvent.change(within(dialog).getByLabelText("الرصيد الأساسي (بالأيام) *"), { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(await screen.findByText("25")).toBeInTheDocument();
  });
});
