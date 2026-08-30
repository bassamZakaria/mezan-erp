// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { BranchDTO } from "@mezan/contracts";
import { SystemStatusScreen } from "./SystemStatusScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

const sampleBranches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

function renderScreen(healthOk: boolean, branchesOk: boolean) {
  let branchCalls = 0;
  const transport = stubTransport({
    "GET /health": () => (healthOk ? { body: { ok: true } } : { status: 500, body: { error: "DOWN" } }),
    "GET /branches": () => {
      branchCalls += 1;
      return branchesOk ? { body: sampleBranches } : { status: 500, body: { error: "DOWN" } };
    },
  });
  const result = renderWithProviders(<SystemStatusScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getBranchCalls: () => branchCalls };
}

describe("SystemStatusScreen", () => {
  it("shows both services operational and the everything-fine banner when both checks succeed", async () => {
    renderScreen(true, true);
    expect(screen.getByRole("heading", { name: "حالة النظام" })).toBeInTheDocument();
    expect(await screen.findByText("كل الأنظمة تعمل بشكل طبيعي")).toBeInTheDocument();
    expect(screen.getAllByText("تعمل بشكل طبيعي").length).toBeGreaterThanOrEqual(2); // API + database
    expect(screen.getByText("الخادم (API)")).toBeInTheDocument();
    expect(screen.getByText("قاعدة البيانات (SQLite)")).toBeInTheDocument();
  });

  it("shows the degraded banner and an Arabic 'unavailable' pill when the API check fails, never a raw status code alone", async () => {
    renderScreen(false, true);
    expect(await screen.findByText("توجد مشكلة في أحد الأنظمة")).toBeInTheDocument();
    expect(screen.getByText("غير متاحة")).toBeInTheDocument(); // the API service's Arabic "down" label
    expect(screen.getByText(/لا يستجيب/)).toBeInTheDocument(); // Arabic detail text, not a stack trace
  });

  it("shows the degraded banner when the database check fails", async () => {
    renderScreen(true, false);
    expect(await screen.findByText("توجد مشكلة في أحد الأنظمة")).toBeInTheDocument();
    expect(screen.getByText(/تعذّرت القراءة من قاعدة البيانات/)).toBeInTheDocument();
  });

  it("re-runs both checks when 'check again' is clicked", async () => {
    const { getBranchCalls } = renderScreen(true, true);
    await screen.findByText("كل الأنظمة تعمل بشكل طبيعي");
    const before = getBranchCalls();
    fireEvent.click(screen.getByRole("button", { name: "إعادة الفحص الآن" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getBranchCalls()).toBeGreaterThan(before);
  });

  it("renders the application-version card and the static changelog", async () => {
    renderScreen(true, true);
    expect(await screen.findByText("إصدار التطبيق")).toBeInTheDocument();
    expect(screen.getByText("آخر التحديثات")).toBeInTheDocument();
    expect(screen.getByText("سجل الأعطال")).toBeInTheDocument();
    expect(screen.getByText("لا توجد حوادث مسجّلة")).toBeInTheDocument();
  });
});
