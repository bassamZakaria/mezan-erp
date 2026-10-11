// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NumberField, SelectField, TextAreaField, TextField, ToggleField } from "../settings/form-controls";
import { ReadOnlyForm } from "./ReadOnlyForm";

const REASON = "إعداد مشترك لكل الفروع — تعدّله الإدارة.";

function TaxForm() {
  return (
    <>
      <TextField label="اسم الضريبة" value="ضريبة القيمة المضافة" onChange={() => {}} hint="يظهر على الفاتورة" />
      <NumberField label="النسبة" value={14} onChange={() => {}} />
      <TextAreaField label="ملاحظات" value="" onChange={() => {}} />
      <SelectField label="طريقة الحساب" value="exclusive" onChange={() => {}} options={[{ value: "exclusive", label: "تضاف على السعر" }]} />
      <ToggleField label="افتراضية" checked={false} onChange={() => {}} />
    </>
  );
}

describe("a shared configuration form, for a branch-restricted user (D111)", () => {
  it("disables each control and says why beside it", () => {
    render(
      <ReadOnlyForm reason={REASON}>
        <TaxForm />
      </ReadOnlyForm>,
    );
    expect(screen.getByLabelText("اسم الضريبة")).toBeDisabled();
    expect(screen.getByLabelText("النسبة")).toBeDisabled();
    expect(screen.getByLabelText("ملاحظات")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "طريقة الحساب" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "افتراضية" })).toBeDisabled();
    expect(screen.getAllByText(REASON).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("يظهر على الفاتورة")).not.toBeInTheDocument();
  });

  it("leaves every control open where the screen is not read-only", () => {
    render(
      <ReadOnlyForm reason={null}>
        <TaxForm />
      </ReadOnlyForm>,
    );
    expect(screen.getByLabelText("اسم الضريبة")).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "طريقة الحساب" })).toBeEnabled();
    expect(screen.getByText("يظهر على الفاتورة")).toBeInTheDocument();
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
  });
});
