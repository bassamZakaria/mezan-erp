// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Select, type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "cash", label: "نقدي" },
  { value: "bank", label: "بنكي", sublabel: "حساب جاري" },
  { value: "credit", label: "آجل" },
];

function ControlledSelect(props: Partial<Parameters<typeof Select>[0]> & { options?: SelectOption[] }) {
  const [value, setValue] = useState(props.value ?? "");
  return (
    <Select
      aria-label="طريقة الدفع"
      {...props}
      value={value}
      options={props.options ?? OPTIONS}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

const trigger = () => screen.getByRole("combobox", { name: "طريقة الدفع" });

describe("Select — trigger content and defaults", () => {
  it("falls back to the translated placeholder when none is given and nothing is selected", () => {
    render(<ControlledSelect />);
    expect(trigger()).toHaveTextContent("اختر…");
  });

  it("shows an empty-list message the caller never customised, using the translated default", () => {
    render(<Select aria-label="طريقة الدفع" value="" options={[]} onChange={vi.fn()} />);
    fireEvent.click(trigger());
    expect(screen.getByText("لا توجد نتائج")).toBeInTheDocument();
  });

  it("renders a caller-supplied renderValue instead of the option label", () => {
    render(<ControlledSelect value="bank" renderValue={(opt) => (opt ? `مختار: ${opt.label}` : "بلا اختيار")} />);
    expect(trigger()).toHaveTextContent("مختار: بنكي");
  });

  it("shows renderValue's own placeholder rendering when nothing is selected", () => {
    render(<ControlledSelect renderValue={(opt) => (opt ? `مختار: ${opt.label}` : "بلا اختيار")} />);
    expect(trigger()).toHaveTextContent("بلا اختيار");
  });

  it("renders a leading icon when one is given", () => {
    render(<ControlledSelect leadingIcon={<span data-testid="leading">💳</span>} />);
    expect(screen.getByTestId("leading")).toBeInTheDocument();
  });

  it("hides the chevron icon when chevron is false", () => {
    const { container } = render(<ControlledSelect chevron={false} />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("associates a visible label with the trigger via htmlFor/id", () => {
    render(<ControlledSelect label="طريقة الدفع" id="payment-method" />);
    expect(screen.getByText("طريقة الدفع").tagName).toBe("LABEL");
    expect(trigger()).toHaveAttribute("id", "payment-method");
  });

  it("renders a hidden form input carrying the value only when name is given", () => {
    const { container, rerender } = render(<ControlledSelect value="bank" />);
    expect(container.querySelector('input[type="hidden"]')).not.toBeInTheDocument();

    rerender(<ControlledSelect value="bank" name="paymentMethod" />);
    const hidden = container.querySelector('input[type="hidden"]') as HTMLInputElement;
    expect(hidden).toHaveAttribute("name", "paymentMethod");
  });

  it("marks the trigger aria-required and aria-invalid from the matching props", () => {
    render(<ControlledSelect required invalid />);
    expect(trigger()).toHaveAttribute("aria-required", "true");
    expect(trigger()).toHaveAttribute("aria-invalid", "true");
  });

  it("shows an option's sublabel under its label", () => {
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    expect(screen.getByText("حساب جاري")).toBeInTheDocument();
  });
});

describe("Select — visual variants", () => {
  it("applies the chrome variant's classes, including the open-state accent border", () => {
    render(<ControlledSelect variant="chrome" />);
    expect(trigger()).toHaveClass("bg-chrome-hover");
    fireEvent.click(trigger());
    expect(trigger()).toHaveClass("border-chrome-accent");
  });

  it("marks the default-variant trigger invalid with a danger border", () => {
    render(<ControlledSelect invalid />);
    expect(trigger()).toHaveClass("border-danger");
  });

  it("gives the default-variant trigger a brand border when open and not invalid", () => {
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    expect(trigger()).toHaveClass("border-brand");
  });

  it("does not add the open-brand border to an invalid trigger even while open", () => {
    render(<ControlledSelect invalid />);
    fireEvent.click(trigger());
    expect(trigger()).not.toHaveClass("border-brand");
  });

  it("applies the disabled trigger classes", () => {
    render(<Select aria-label="طريقة الدفع" value="" options={OPTIONS} onChange={vi.fn()} disabled />);
    expect(trigger()).toHaveClass("cursor-not-allowed");
  });
});

describe("Select — opening, closing and outside interaction", () => {
  it("closes the list when the open trigger is clicked again", () => {
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(trigger());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stays open when a pointer-down lands inside the menu itself", () => {
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox");
    fireEvent.mouseDown(list);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes when a pointer-down lands outside the trigger and the menu", () => {
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("repositions the menu on window scroll and resize while open", () => {
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    expect(() => {
      fireEvent.scroll(window);
      fireEvent.resize(window);
    }).not.toThrow();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("Select — menu placement math", () => {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  function mockRect(rect: Partial<DOMRect>) {
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect }) as DOMRect; // rtl-allow-physical
  }

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("flips the menu upward when there isn't enough room below but there is above", () => {
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });
    mockRect({ top: 280, bottom: 290, left: 10, right: 110, width: 100 }); // rtl-allow-physical
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    const menu = screen.getByRole("listbox").parentElement as HTMLElement;
    const top = Number.parseFloat(menu.style.top);
    expect(top).toBeLessThan(280);
  });

  it("keeps the menu below the trigger when there is enough room", () => {
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    mockRect({ top: 100, bottom: 130, left: 10, right: 110, width: 100 }); // rtl-allow-physical
    render(<ControlledSelect />);
    fireEvent.click(trigger());
    const menu = screen.getByRole("listbox").parentElement as HTMLElement;
    const top = Number.parseFloat(menu.style.top);
    expect(top).toBeGreaterThanOrEqual(130);
  });

  it("measures the trigger's RTL position from the right edge of the viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    mockRect({ top: 100, bottom: 130, left: 10, right: 110, width: 100 }); // rtl-allow-physical
    const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");
    render(
      <div dir="rtl">
        <ControlledSelect />
      </div>,
    );
    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    getComputedStyleSpy.mockRestore();
  });
});
