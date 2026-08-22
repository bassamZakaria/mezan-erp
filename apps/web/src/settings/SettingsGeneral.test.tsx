// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsGeneral } from "./SettingsGeneral";

describe("SettingsGeneral", () => {
  it("renders the general tab by default with company info fields available", () => {
    render(<SettingsGeneral />);
    expect(screen.getByRole("heading", { name: "الإعدادات" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "عام" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("العملة الافتراضية")).toBeInTheDocument();
  });

  it("keeps the save button disabled until a field is dirtied", () => {
    render(<SettingsGeneral />);
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.change(screen.getByLabelText("اسم المنشأة"), { target: { value: "Cyag" } });

    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  it("saves a valid patch and clears the dirty flag", () => {
    render(<SettingsGeneral />);
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(screen.getByLabelText("نسبة الضريبة الافتراضية (%)"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
  });

  it("surfaces a domain validation error instead of saving an out-of-range value", () => {
    render(<SettingsGeneral />);
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(screen.getByLabelText("نسبة الضريبة الافتراضية (%)"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    // Still dirty — the invalid patch was rejected, not silently saved.
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
    expect(screen.getByText(/Invalid settings/)).toBeInTheDocument();
  });

  it("exposes the credit-control / inventory / purchase / treasury policy toggles", () => {
    render(<SettingsGeneral />);
    fireEvent.click(screen.getByRole("tab", { name: "السياسات" }));
    expect(screen.getByRole("switch", { name: "تفعيل الرقابة الائتمانية" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "السماح بالمخزون السالب" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "يجب وجود أمر شراء قبل استلام البضاعة" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "منع الرصيد السالب للحسابات النقدية" })).toBeInTheDocument();
  });
});
