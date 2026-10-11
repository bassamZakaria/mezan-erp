// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, NumberField, SelectField, TextAreaField, TextField, ToggleField } from "../settings/form-controls";
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

  it("disables a control a screen placed in a labelled field by hand, and says why", () => {
    const form = (
      <Field label="الوصف" hint="يظهر في القائمة">
        <textarea aria-label="الوصف" defaultValue="" />
        <button type="button">اختيار</button>
      </Field>
    );
    const { unmount } = render(<ReadOnlyForm reason={REASON}>{form}</ReadOnlyForm>);
    expect(screen.getByLabelText("الوصف")).toBeDisabled();
    expect(screen.getByRole("button", { name: "اختيار" })).toBeDisabled();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    unmount();

    render(<ReadOnlyForm reason={null}>{form}</ReadOnlyForm>);
    expect(screen.getByLabelText("الوصف")).toBeEnabled();
    expect(screen.getByRole("button", { name: "اختيار" })).toBeEnabled();
    expect(screen.getByText("يظهر في القائمة")).toBeInTheDocument();
  });
});
