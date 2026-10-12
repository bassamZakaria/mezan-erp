// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SidePanel } from "@mezan/ui";
import { Field, NumberField, SelectField, TextAreaField, TextField, ToggleField } from "../settings/form-controls";
import { ReadOnlyFields, ReadOnlyForm, READ_ONLY_KEEP } from "./ReadOnlyForm";

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
        <SidePanel open onClose={() => {}} title="تعديل ضريبة">
          <TaxForm />
        </SidePanel>
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
    const { unmount } = render(
      <ReadOnlyForm reason={REASON}>
        <ReadOnlyFields>{form}</ReadOnlyFields>
      </ReadOnlyForm>,
    );
    expect(screen.getByLabelText("الوصف")).toBeDisabled();
    expect(screen.getByRole("button", { name: "اختيار" })).toBeDisabled();
    expect(screen.getAllByText(REASON).length).toBeGreaterThanOrEqual(1);
    unmount();

    render(<ReadOnlyForm reason={null}>{form}</ReadOnlyForm>);
    expect(screen.getByLabelText("الوصف")).toBeEnabled();
    expect(screen.getByRole("button", { name: "اختيار" })).toBeEnabled();
    expect(screen.getByText("يظهر في القائمة")).toBeInTheDocument();
  });

  it("leaves a list's filters, search and paging open on a read-only screen: only an edit form is closed", () => {
    render(
      <ReadOnlyForm reason={REASON}>
        <SelectField label="الحالة" value="all" onChange={() => {}} options={[{ value: "all", label: "الكل" }]} />
        <TextField label="بحث" value="" onChange={() => {}} />
        <button type="button">التالي</button>
        <button type="button">تصدير</button>
        <SidePanel open onClose={() => {}} title="تعديل ضريبة">
          <TextField label="اسم الضريبة" value="" onChange={() => {}} />
        </SidePanel>
      </ReadOnlyForm>,
    );
    expect(screen.getByRole("combobox", { name: "الحالة" })).toBeEnabled();
    expect(screen.getByLabelText("بحث")).toBeEnabled();
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "تصدير" })).toBeEnabled();
    expect(screen.getByLabelText("اسم الضريبة")).toBeDisabled();
  });

  it("closes every control of a hand-built form it wraps, and keeps Cancel working", async () => {
    let cancelled = 0;
    const HandBuilt = () => (
      <ReadOnlyFields>
        <form>
          <input aria-label="الكود" defaultValue="" />
          <select aria-label="النوع">
            <option>أصل</option>
          </select>
          <textarea aria-label="وصف" defaultValue="" />
          <button type="button">إضافة بند</button>
          <button type="button" {...READ_ONLY_KEEP} onClick={() => (cancelled += 1)}>
            إلغاء
          </button>
          <button type="submit">حفظ</button>
        </form>
      </ReadOnlyFields>
    );
    const { unmount } = render(
      <ReadOnlyForm reason={REASON}>
        <HandBuilt />
      </ReadOnlyForm>,
    );
    await waitFor(() => expect(screen.getByLabelText("الكود")).toBeDisabled());
    expect(screen.getByLabelText("النوع")).toBeDisabled();
    expect(screen.getByLabelText("وصف")).toBeDisabled();
    expect(screen.getByRole("button", { name: "إضافة بند" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
    const cancel = screen.getByRole("button", { name: "إلغاء" });
    expect(cancel).toBeEnabled();
    cancel.click();
    expect(cancelled).toBe(1);
    expect(screen.getByRole("note")).toHaveTextContent(REASON);
    unmount();

    render(
      <ReadOnlyForm reason={null}>
        <HandBuilt />
      </ReadOnlyForm>,
    );
    expect(screen.getByLabelText("الكود")).toBeEnabled();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeEnabled();
  });
});
