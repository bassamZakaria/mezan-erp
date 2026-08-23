// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { BranchDTO, WarehouseDTO } from "@mezan/contracts";
import { WarehousesPage } from "./WarehousesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const BRANCH: BranchDTO = {
  id: "b1",
  code: "MAIN",
  name: "الفرع الرئيسي",
  parentBranchId: null,
  phone: null,
  email: null,
  address: null,
  isMain: true,
  active: true,
};

function warehouse(overrides: Partial<WarehouseDTO> = {}): WarehouseDTO {
  return { id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true, active: true, ...overrides };
}

const VAN = warehouse({ id: "w2", code: "VAN-01", name: "سياره نقل ١", type: "VAN", isDefault: false });

function renderPage() {
  let warehouses = [warehouse(), VAN];
  const transport = stubTransport({
    "GET /branches": () => ({ body: [BRANCH] }),
    "GET /warehouses": () => ({ body: warehouses }),
    "POST /warehouses": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as WarehouseDTO;
      const created = warehouse({ ...body });
      warehouses = [...warehouses, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<WarehousesPage />, { transport, initialSession: testAdminSession });
}

describe("WarehousesPage", () => {
  it("lists the warehouses the API returns, with the 5 catalog type filters", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "المستودعات" })).toBeInTheDocument();
    expect(await screen.findByText("مستودع الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("سياره نقل ١")).toBeInTheDocument();
    for (const label of ["رئيسي", "مستودع وسيط", "مرتجعات", "إنتاج", "ڤان (سيارة توزيع)"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("filters the list by warehouse type", async () => {
    renderPage();
    await screen.findByText("مستودع الفرع الرئيسي");
    fireEvent.click(screen.getByRole("button", { name: "ڤان (سيارة توزيع)" }));
    expect(screen.getByText("سياره نقل ١")).toBeInTheDocument();
    expect(screen.queryByText("مستودع الفرع الرئيسي")).not.toBeInTheDocument();
  });

  it("adds a new warehouse through the side panel, defaulting to type MAIN", async () => {
    renderPage();
    await screen.findByText("مستودع الفرع الرئيسي");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مستودع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مستودع" });
    fireEvent.change(within(dialog).getByLabelText("اسم المستودع"), { target: { value: "مستودع تجريبي" } });
    fireEvent.change(within(dialog).getByLabelText("رمز المستودع"), { target: { value: "WH-TEST" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ المستودع" }));

    expect(await screen.findByText("مستودع تجريبي")).toBeInTheDocument();
  });
});
