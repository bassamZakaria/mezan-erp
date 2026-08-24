// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { createEntitlements } from "@mezan/domain";
import { RoleEditorPage } from "./RoleEditorPage";
import { AppI18nProvider } from "../i18n";

/** The page reads the web catalogue, which only the provider supplies. */
const render = (ui: React.ReactElement) => rtlRender(<AppI18nProvider>{ui}</AppI18nProvider>);

function entitlements(activeModules: string[]) {
  return createEntitlements({ plan: "STANDARD", activeModules, features: {}, seats: 5, expiresAt: null });
}

describe("RoleEditorPage", () => {
  it("renders only permissions from licensed modules", () => {
    render(
      <RoleEditorPage
        role={null}
        entitlements={entitlements(["sales"])}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // "sales" is licensed -> its module section renders.
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    // "pos" is not in activeModules -> its module section must not render.
    expect(screen.queryByText("نقطة البيع")).not.toBeInTheDocument();
    // "admin" is always-licensed core surface -> renders even though absent from activeModules.
    expect(screen.getByText("الإدارة")).toBeInTheDocument();
  });

  it("checking a permission auto-selects its dependency and updates the summary", () => {
    render(
      <RoleEditorPage role={null} entitlements={entitlements(["sales"])} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const selectedCountValue = () =>
      screen.getByText("الصلاحيات المحددة").previousElementSibling?.textContent;
    expect(selectedCountValue()).toBe("0");

    const confirmCheckbox = document.querySelector(
      '[data-permission-code="sales.invoice.confirm"] input[type="checkbox"]',
    );
    fireEvent.click(confirmCheckbox as Element);

    // confirm + its dependency view_own => 2 selected.
    expect(selectedCountValue()).toBe("2");

    const viewOwnCheckbox = document.querySelector(
      '[data-permission-code="sales.invoice.view_own"] input[type="checkbox"]',
    );
    expect(viewOwnCheckbox).toHaveProperty("checked", true);
  });

  it("shows a validation error and does not call onSave when name/code are empty", async () => {
    const onSave = vi.fn();
    render(<RoleEditorPage role={null} entitlements={entitlements(["sales"])} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "حفظ الدور" }));
    expect(await screen.findByText("اسم الدور ورمزه مطلوبان")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submits the selected permission codes on save", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(<RoleEditorPage role={null} entitlements={entitlements(["sales"])} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("VAN_SALES"), { target: { value: "TEST_ROLE" } });
    const nameInputs = screen.getAllByDisplayValue("");
    fireEvent.change(nameInputs[0] as Element, { target: { value: "دور تجريبي" } });

    const viewCheckbox = document.querySelector(
      '[data-permission-code="sales.invoice.view_own"] input[type="checkbox"]',
    );
    fireEvent.click(viewCheckbox as Element);

    fireEvent.click(screen.getByRole("button", { name: "حفظ الدور" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TEST_ROLE", name: "دور تجريبي", permissions: ["sales.invoice.view_own"] }),
    );
  });
});
