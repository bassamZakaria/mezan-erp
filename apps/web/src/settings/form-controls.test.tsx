// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../data/test-support";
import {
  Field,
  FormColumns,
  FormError,
  FormPage,
  MultiChipField,
  NumberField,
  SectionCard,
  SelectField,
  TextAreaField,
  TextField,
  ToggleField,
} from "./form-controls";

describe("Field", () => {
  it("renders the label, hint and children", () => {
    renderWithProviders(
      <Field label="الاسم" hint="مطلوب">
        <input aria-label="الاسم" />
      </Field>,
    );
    expect(screen.getByText("الاسم")).toBeInTheDocument();
    expect(screen.getByText("مطلوب")).toBeInTheDocument();
  });
});

describe("TextField", () => {
  it("shows the current value and calls onChange with the typed string", () => {
    const onChange = vi.fn();
    renderWithProviders(<TextField label="الاسم" value="محمد" onChange={onChange} />);
    const input = screen.getByDisplayValue("محمد");
    fireEvent.change(input, { target: { value: "أحمد" } });
    expect(onChange).toHaveBeenCalledWith("أحمد");
  });

  it("is disabled when disabled=true", () => {
    renderWithProviders(<TextField label="الاسم" value="" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("LIMITATION (D67): the label is not associated with the input, so no screen reader announces it", () => {
    renderWithProviders(<TextField label="الاسم" value="" onChange={vi.fn()} />);

    // The label is on screen…
    expect(screen.getByText("الاسم")).toBeInTheDocument();
    // …and reaches nothing: no htmlFor, no matching id, so clicking it does not
    // focus the field and a screen reader announces an unnamed text box. Every
    // screen built on this wrapper is affected. When D67 is fixed, this
    // expectation flips to `toBe(screen.getByRole("textbox"))`.
    expect(screen.queryByLabelText("الاسم")).not.toBeInTheDocument();
  });
});

describe("NumberField", () => {
  it("calls onChange with a NUMBER, not the raw input string", () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(<NumberField label="العدد" value={1} onChange={onChange} />);
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
    expect(typeof onChange.mock.calls[0]![0]).toBe("number");
  });

  it("renders an empty field rather than 'NaN' when value is NaN", () => {
    const { container } = renderWithProviders(<NumberField label="العدد" value={NaN} onChange={vi.fn()} />);
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

describe("TextAreaField", () => {
  it("shows the value and calls onChange with the typed text", () => {
    const onChange = vi.fn();
    renderWithProviders(<TextAreaField label="ملاحظات" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "نص طويل" } });
    expect(onChange).toHaveBeenCalledWith("نص طويل");
  });
});

describe("SelectField", () => {
  it("calls onChange with the newly selected option's value", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SelectField
        label="الحالة"
        value="active"
        onChange={onChange}
        options={[
          { value: "active", label: "نشط" },
          { value: "inactive", label: "غير نشط" },
        ]}
      />,
    );
    // Select is a custom listbox (not a native <select>): open it, then click the option.
    fireEvent.click(screen.getByRole("combobox", { name: "الحالة" }));
    // The option commits on mousedown (so it fires before the trigger's own
    // blur/close handling), not on click.
    fireEvent.mouseDown(screen.getByRole("option", { name: "غير نشط" }));
    expect(onChange).toHaveBeenCalledWith("inactive");
  });
});

describe("ToggleField", () => {
  it("calls onChange with a BOOLEAN when toggled", () => {
    const onChange = vi.fn();
    renderWithProviders(<ToggleField label="مفعّل" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "مفعّل" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(typeof onChange.mock.calls[0]![0]).toBe("boolean");
  });

  it("is disabled when disabled=true and does not fire onChange when clicked", () => {
    const onChange = vi.fn();
    renderWithProviders(<ToggleField label="مفعّل" checked={false} onChange={onChange} disabled />);
    const toggle = screen.getByRole("switch", { name: "مفعّل" });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MultiChipField", () => {
  const options = [
    { value: "sat", label: "السبت" },
    { value: "sun", label: "الأحد" },
  ];

  it("toggles an option chip on click, adding then removing it from value", () => {
    const onChange = vi.fn();
    renderWithProviders(<MultiChipField label="أيام الإجازة" options={options} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("السبت"));
    expect(onChange).toHaveBeenCalledWith(["sat"]);
  });

  it("removes an already-selected option when clicked again", () => {
    const onChange = vi.fn();
    renderWithProviders(<MultiChipField label="أيام الإجازة" options={options} value={["sat"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("السبت"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("commits a custom value on Enter when allowCustom is set, normalising to lowercase and stripping a leading @/.", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiChipField label="النطاقات" options={[]} value={[]} onChange={onChange} allowCustom customPlaceholder="example.com" />,
    );
    const input = screen.getByPlaceholderText("example.com");
    fireEvent.change(input, { target: { value: "@Example.COM" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["example.com"]);
  });

  it("also commits on a comma key, and prevents the keystroke reaching the surrounding form", () => {
    const onChange = vi.fn();
    renderWithProviders(<MultiChipField label="النطاقات" options={[]} value={[]} onChange={onChange} allowCustom />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "sample.co" } });
    const event = new KeyboardEvent("keydown", { key: ",", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith(["sample.co"]);
  });

  it("does not add a duplicate or a blank custom entry", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MultiChipField label="النطاقات" options={[]} value={["existing.com"]} onChange={onChange} allowCustom />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "existing.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a custom (non-option) selected value as its own removable chip", () => {
    renderWithProviders(
      <MultiChipField label="النطاقات" options={[]} value={["custom.example"]} onChange={vi.fn()} allowCustom />,
    );
    expect(screen.getByText("custom.example")).toBeInTheDocument();
  });

  it("commits a pending custom entry on blur too, not only Enter", () => {
    const onChange = vi.fn();
    renderWithProviders(<MultiChipField label="النطاقات" options={[]} value={[]} onChange={onChange} allowCustom />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "blur.example" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(["blur.example"]);
  });
});

describe("SectionCard / FormPage / FormColumns / FormError", () => {
  it("SectionCard renders its title, optional description and children", () => {
    renderWithProviders(
      <SectionCard title="القسم الأول" description="وصف">
        <div>محتوى</div>
      </SectionCard>,
    );
    expect(screen.getByText("القسم الأول")).toBeInTheDocument();
    expect(screen.getByText("وصف")).toBeInTheDocument();
    expect(screen.getByText("محتوى")).toBeInTheDocument();
  });

  it("FormPage renders the eyebrow, title, description and actions", () => {
    renderWithProviders(
      <FormPage eyebrow="الإعدادات" title="تعديل الحساب" description="وصف الصفحة" actions={<button>حفظ</button>}>
        <div>الجسم</div>
      </FormPage>,
    );
    expect(screen.getByText("الإعدادات")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تعديل الحساب" })).toBeInTheDocument();
    expect(screen.getByText("وصف الصفحة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeInTheDocument();
  });

  it("FormColumns renders children and, when given, the aside content", () => {
    renderWithProviders(
      <FormColumns aside={<div>جانبي</div>}>
        <div>رئيسي</div>
      </FormColumns>,
    );
    expect(screen.getByText("رئيسي")).toBeInTheDocument();
    expect(screen.getByText("جانبي")).toBeInTheDocument();
  });

  it("FormColumns renders no aside element at all when none is passed", () => {
    const { container } = renderWithProviders(
      <FormColumns>
        <div>رئيسي</div>
      </FormColumns>,
    );
    expect(container.querySelector("aside")).toBeNull();
  });

  it("FormError renders nothing for a null message", () => {
    const { container } = renderWithProviders(<FormError message={null} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("FormError renders the message inside role=alert", () => {
    renderWithProviders(<FormError message="تعذر الحفظ" />);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذر الحفظ");
  });
});
