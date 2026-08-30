// @vitest-environment jsdom
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox, Field, SearchInput, Switch, TextArea, TextInput, controlClassName } from "./form";

describe("controlClassName", () => {
  it("applies the invalid border class when invalid", () => {
    expect(controlClassName("md", true)).toContain("border-danger");
  });

  it("applies the default border class when not invalid", () => {
    expect(controlClassName("md", false)).toContain("border-border");
  });

  it("defaults to full width when the caller supplies no width utility", () => {
    expect(controlClassName("md", false, "text-start")).toContain("w-full");
  });

  it("does not force full width when the caller already sizes the control", () => {
    expect(controlClassName("md", false, "w-40")).not.toContain("w-full");
  });
});

describe("Field", () => {
  it("renders the label, required marker and children", () => {
    render(
      <Field label="الاسم" required htmlFor="name-input">
        <input id="name-input" />
      </Field>,
    );
    expect(screen.getByText("الاسم")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("associates the label with the control via htmlFor/id", () => {
    render(
      <Field label="الاسم" htmlFor="name-input">
        <input id="name-input" />
      </Field>,
    );
    expect(screen.getByLabelText("الاسم")).toBeInTheDocument();
  });

  it("documents current behaviour: the label is NOT associated when htmlFor is omitted, even though an id exists on the child", () => {
    render(
      <Field label="الاسم">
        <input id="name-input" />
      </Field>,
    );
    expect(screen.queryByLabelText("الاسم")).not.toBeInTheDocument();
  });

  it("shows the error message instead of the hint when both are given", () => {
    render(
      <Field label="الاسم" hint="أدخل الاسم الكامل" error="هذا الحقل مطلوب">
        <input />
      </Field>,
    );
    expect(screen.getByText("هذا الحقل مطلوب")).toBeInTheDocument();
    expect(screen.queryByText("أدخل الاسم الكامل")).not.toBeInTheDocument();
  });

  it("shows the hint when there is no error", () => {
    render(
      <Field label="الاسم" hint="أدخل الاسم الكامل">
        <input />
      </Field>,
    );
    expect(screen.getByText("أدخل الاسم الكامل")).toBeInTheDocument();
  });

  it("renders no label element when label is omitted", () => {
    const { container } = render(
      <Field>
        <input />
      </Field>,
    );
    expect(container.querySelector("label")).not.toBeInTheDocument();
  });
});

describe("TextInput", () => {
  it("forwards a ref to the underlying input", () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextInput ref={ref} aria-label="حقل نصي" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("is reachable by Tab and accepts typed text", async () => {
    const user = userEvent.setup();
    render(<TextInput aria-label="حقل نصي" />);
    await user.tab();
    expect(screen.getByRole("textbox")).toHaveFocus();
    await user.keyboard("مرحبا");
    expect(screen.getByRole("textbox")).toHaveValue("مرحبا");
  });

  it("applies the numeric class for right-aligned tabular figures", () => {
    render(<TextInput numeric aria-label="رقم" />);
    expect(screen.getByRole("textbox")).toHaveClass("mz-num");
  });

  it("marks the invalid border when invalid", () => {
    render(<TextInput invalid aria-label="حقل" />);
    expect(screen.getByRole("textbox")).toHaveClass("border-danger");
  });

  it("does not receive focus via Tab when disabled", async () => {
    const user = userEvent.setup();
    render(
      <>
        <TextInput disabled aria-label="معطل" />
        <button type="button">التالي</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "التالي" })).toHaveFocus();
  });
});

describe("TextArea", () => {
  it("defaults to 3 rows and forwards a ref", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<TextArea ref={ref} aria-label="ملاحظات" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "3");
  });

  it("accepts a custom row count", () => {
    render(<TextArea rows={6} aria-label="ملاحظات" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "6");
  });
});

describe("Checkbox", () => {
  it("associates its label via a generated id when none is supplied", () => {
    render(<Checkbox label="موافق على الشروط" />);
    expect(screen.getByLabelText("موافق على الشروط")).toBeInTheDocument();
  });

  it("uses a caller-supplied id instead of generating one", () => {
    render(<Checkbox id="agree" label="موافق" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("id", "agree");
  });

  it("is reachable by Tab and toggles with Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="موافق" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalled();
  });

  it("sets the indeterminate DOM property when indeterminate is true", () => {
    render(<Checkbox label="تحديد جزئي" indeterminate />);
    expect(screen.getByRole("checkbox")).toHaveProperty("indeterminate", true);
  });

  it("renders the hint beneath the label", () => {
    render(<Checkbox label="موافق" hint="لا يمكن التراجع" />);
    expect(screen.getByText("لا يمكن التراجع")).toBeInTheDocument();
  });

  it("is not reachable by Tab when disabled", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Checkbox label="معطل" disabled />
        <button type="button">التالي</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "التالي" })).toHaveFocus();
  });
});

describe("Switch", () => {
  it("exposes role switch with aria-checked reflecting the value", () => {
    render(<Switch checked label="تفعيل" onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "تفعيل" })).toHaveAttribute("aria-checked", "true");
  });

  it("reports aria-checked false when unchecked", () => {
    render(<Switch checked={false} label="تفعيل" onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("is reachable by Tab, and Enter toggles it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} label="تفعيل" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("switch")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Space also toggles it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked label="تفعيل" onChange={onChange} />);
    await user.tab();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not call onChange when disabled and clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} label="تفعيل" onChange={onChange} disabled />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SearchInput", () => {
  it("has role searchbox and is reachable by Tab", async () => {
    const user = userEvent.setup();
    render(<SearchInput value="" onValueChange={() => {}} aria-label="بحث" />);
    await user.tab();
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("calls onValueChange with the field's new value", () => {
    const onValueChange = vi.fn();
    render(<SearchInput value="" onValueChange={onValueChange} aria-label="بحث" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "فاتورة" } });
    expect(onValueChange).toHaveBeenCalledWith("فاتورة");
  });

  it("reflects the controlled value", () => {
    render(<SearchInput value="عميل" onValueChange={() => {}} aria-label="بحث" />);
    expect(screen.getByRole("searchbox")).toHaveValue("عميل");
  });

  it("forwards a ref to the underlying input", () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchInput ref={ref} value="" onValueChange={() => {}} aria-label="بحث" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
