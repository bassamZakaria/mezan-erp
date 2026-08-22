// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionMatrix, type PermissionMatrixModule } from "./PermissionMatrix";

function modules(): PermissionMatrixModule[] {
  return [
    {
      key: "sales",
      label: "المبيعات",
      subgroups: [
        {
          key: "invoices",
          label: "الفواتير",
          items: [
            { code: "sales.invoice.view_own", label: "عرض الفواتير الخاصة", selected: true },
            {
              code: "sales.invoice.confirm",
              label: "تأكيد الفاتورة",
              selected: false,
              dependsOn: ["sales.invoice.view_own"],
            },
            {
              code: "sales.invoice.view_cost",
              label: "عرض تكلفة الفاتورة",
              selected: false,
              sensitive: true,
              dependsOn: ["sales.invoice.view_own"],
            },
          ],
        },
      ],
    },
    {
      key: "field",
      label: "المبيعات الميدانية",
      subgroups: [
        {
          key: "van_trip",
          label: "Van Trip",
          items: [{ code: "field.van_trip.view_own", label: "عرض رحلات السيارة", selected: false }],
        },
      ],
    },
  ];
}

describe("PermissionMatrix", () => {
  it("renders module headers with a selected/total badge", () => {
    render(<PermissionMatrix modules={modules()} onToggle={() => {}} />);
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
  });

  it("calls onToggle with the permission code when a checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(<PermissionMatrix modules={modules()} onToggle={onToggle} />);
    const checkbox = screen.getByText("تأكيد الفاتورة").closest("label")?.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox as Element);
    expect(onToggle).toHaveBeenCalledWith("sales.invoice.confirm");
  });

  it("shows a sensitive marker and the depends-on line", () => {
    render(<PermissionMatrix modules={modules()} onToggle={() => {}} />);
    expect(screen.getByLabelText("صلاحية حساسة")).toBeInTheDocument();
    expect(screen.getAllByText(/يعتمد على:/).length).toBeGreaterThan(0);
  });

  it("select-all toggles every code in the module", () => {
    const onToggleModule = vi.fn();
    render(<PermissionMatrix modules={modules()} onToggle={() => {}} onToggleModule={onToggleModule} />);
    const selectAllBoxes = screen.getAllByLabelText(/تحديد الكل/);
    fireEvent.click(selectAllBoxes[0] as Element);
    expect(onToggleModule).toHaveBeenCalledWith(
      "sales",
      ["sales.invoice.view_own", "sales.invoice.confirm", "sales.invoice.view_cost"],
      true,
    );
  });

  it("filters by search across label and code", () => {
    render(<PermissionMatrix modules={modules()} onToggle={() => {}} searchValue="view_cost" onSearchChange={() => {}} />);
    expect(screen.getByText("عرض تكلفة الفاتورة")).toBeInTheDocument();
    expect(screen.queryByText("تأكيد الفاتورة")).not.toBeInTheDocument();
    expect(screen.queryByText("المبيعات الميدانية")).not.toBeInTheDocument();
  });
});
