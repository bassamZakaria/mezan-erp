// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, WarehouseDTO } from "@mezan/contracts";
import { WarehousesPage } from "./WarehousesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleBranches: BranchDTO[] = [
  { id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "b2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: "b1", phone: null, email: null, address: null, isMain: false, active: true },
];

const sampleWarehouses: WarehouseDTO[] = [
  { id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true },
  { id: "w2", code: "VAN-01", name: "سياره نقل ١", nameEn: null, branchId: "b1", type: "VAN", isDefault: false, active: true },
  { id: "w3", code: "WH-RET", name: "مستودع المرتجعات", nameEn: null, branchId: "b1", type: "RETURNS", isDefault: false, active: true },
  { id: "w4", code: "WH-ALEX", name: "مستودع فرع الإسكندرية", nameEn: null, branchId: "b2", type: "MAIN", isDefault: true, active: true },
  { id: "w5", code: "WH-PROD", name: "مستودع الإنتاج", nameEn: null, branchId: "b2", type: "PRODUCTION", isDefault: false, active: true },
];

function renderScreen(warehouses: WarehouseDTO[] = sampleWarehouses, branches: BranchDTO[] = sampleBranches) {
  let current = [...warehouses];
  const transport = stubTransport({
    "GET /warehouses": () => ({ body: current }),
    "GET /branches": () => ({ body: branches }),
    "POST /warehouses": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: WarehouseDTO = {
        id: body.id,
        code: body.code,
        name: body.name,
        nameEn: body.nameEn ?? null,
        branchId: body.branchId,
        type: body.type ?? "MAIN",
        isDefault: body.isDefault ?? false,
        active: true,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<WarehousesPage />, { transport, initialSession: testAdminSession });
}

describe("WarehousesPage", () => {
  it("lists the real warehouses across the 5 catalog types", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "المستودعات" })).toBeInTheDocument();
    expect(await screen.findByText("مستودع الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("سياره نقل ١")).toBeInTheDocument();
    // The 5 type filter chips are rendered.
    for (const label of ["رئيسي", "مستودع وسيط", "مرتجعات", "إنتاج", "ڤان (سيارة توزيع)"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("filters the list by warehouse type", async () => {
    renderScreen();
    await screen.findByText("مستودع الفرع الرئيسي");
    fireEvent.click(screen.getByRole("button", { name: "ڤان (سيارة توزيع)" }));
    expect(screen.getByText("سياره نقل ١")).toBeInTheDocument();
    expect(screen.queryByText("مستودع الفرع الرئيسي")).not.toBeInTheDocument();
  });

  it("adds a new warehouse through the side panel, defaulting to type MAIN and the first branch", async () => {
    renderScreen();
    await screen.findByText("مستودع الفرع الرئيسي");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مستودع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مستودع" });
    await waitFor(() => expect(within(dialog).getByLabelText("اسم الفرع")).toHaveValue("b1"));
    fireEvent.change(within(dialog).getByLabelText("اسم المستودع"), { target: { value: "مستودع تجريبي" } });
    fireEvent.change(within(dialog).getByLabelText("رمز المستودع"), { target: { value: "WH-TEST" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ المستودع" }));

    expect(await screen.findByText("مستودع تجريبي")).toBeInTheDocument();
  });
});
