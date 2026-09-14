// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { Select, type SelectOption } from "./Select";

/**
 * `Select` is a styled listbox, not a native `<select>`, and it is on
 * practically every screen in the product. That means it owns its own
 * keyboard model — and a data-entry clerk in this product drives forms from
 * the keyboard all day, so the arrow/Home/End/type-ahead behaviour below is
 * not an accessibility nicety, it is the primary way the control is used.
 *
 * `commit` fires on **mouseDown**, not click, so a pointer test has to use
 * `fireEvent.mouseDown` — a `click` alone selects nothing.
 */

const OPTIONS: SelectOption[] = [
  { value: "cash", label: "نقدي" },
  { value: "bank", label: "بنكي" },
  { value: "cheque", label: "شيك", disabled: true },
  { value: "credit", label: "آجل" },
];

/** A controlled Select, because an uncontrolled one cannot show what it committed. */
function ControlledSelect(props: { options?: SelectOption[]; initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <Select
      aria-label="طريقة الدفع"
      value={value}
      options={props.options ?? OPTIONS}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      placeholder="اختر طريقة الدفع"
    />
  );
}

const trigger = () => screen.getByRole("combobox", { name: "طريقة الدفع" });
const options = () => screen.queryAllByRole("option");
const activeLabel = () => {
  const list = screen.getByRole("listbox");
  const id = list.getAttribute("aria-activedescendant");
  return document.getElementById(id ?? "")?.textContent ?? null;
};

function key(k: string) {
  fireEvent.keyDown(trigger(), { key: k });
}

describe("Select — what the trigger shows", () => {
  it("shows the placeholder until something is chosen, then the chosen label", () => {
    render(<ControlledSelect />);
    expect(trigger()).toHaveTextContent("اختر طريقة الدفع");

    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("option", { name: "بنكي" }));

    expect(trigger()).toHaveTextContent("بنكي");
    expect(trigger()).not.toHaveTextContent("اختر طريقة الدفع");
  });

  it("shows the label of a value it was given, not the raw value", () => {
    render(<ControlledSelect initial="credit" />);
    expect(trigger()).toHaveTextContent("آجل");
    expect(trigger()).not.toHaveTextContent("credit");
  });

  it("reports its expanded state, so a screen reader knows the list opened", () => {
    render(<ControlledSelect />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("marks the chosen option as selected, and only that one", () => {
    render(<ControlledSelect initial="bank" />);
    fireEvent.click(trigger());

    const selected = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("بنكي");
  });
});

describe("Select — choosing with the pointer", () => {
  it("commits the option and closes", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);

    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("option", { name: "آجل" }));

    expect(onChange).toHaveBeenCalledWith("credit");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("refuses a disabled option — no change, and the list stays open", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);

    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("option", { name: "شيك" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("does not open at all when the whole control is disabled", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="طريقة الدفع" value="" options={OPTIONS} onChange={onChange} disabled placeholder="اختر" />,
    );

    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Enter" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Select — the keyboard model", () => {
  it("opens on ArrowDown, ArrowUp, Enter and Space", () => {
    for (const k of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      const view = render(<ControlledSelect />);
      key(k);
      expect(screen.getByRole("listbox"), `${k} should open the list`).toBeInTheDocument();
      view.unmount();
    }
  });

  it("opens on the CURRENT selection, so arrowing starts where the user is", () => {
    render(<ControlledSelect initial="credit" />);
    key("ArrowDown");
    expect(activeLabel()).toBe("آجل");
  });

  it("ArrowDown moves to the next option and ArrowUp back again", () => {
    render(<ControlledSelect initial="cash" />);
    key("ArrowDown");
    expect(activeLabel()).toBe("نقدي");

    key("ArrowDown");
    expect(activeLabel()).toBe("بنكي");

    key("ArrowUp");
    expect(activeLabel()).toBe("نقدي");
  });

  it("steps OVER a disabled option rather than landing on it", () => {
    // «شيك» is disabled and sits between «بنكي» and «آجل». Arrowing down from
    // «بنكي» must reach «آجل», not stall on the one that cannot be chosen.
    render(<ControlledSelect initial="bank" />);
    key("ArrowDown");
    expect(activeLabel()).toBe("بنكي");

    key("ArrowDown");
    expect(activeLabel()).toBe("آجل");
  });

  it("stops at the ends instead of wrapping around", () => {
    render(<ControlledSelect initial="cash" />);
    key("ArrowDown");
    key("ArrowUp");
    key("ArrowUp");
    expect(activeLabel()).toBe("نقدي");

    for (let i = 0; i < 6; i += 1) key("ArrowDown");
    expect(activeLabel()).toBe("آجل");
  });

  it("Home and End go to the first and last ENABLED option", () => {
    render(<ControlledSelect initial="bank" />);
    key("ArrowDown");

    key("End");
    expect(activeLabel()).toBe("آجل");

    key("Home");
    expect(activeLabel()).toBe("نقدي");
  });

  it("End skips a trailing disabled option", () => {
    render(
      <ControlledSelect
        options={[
          { value: "a", label: "ألف" },
          { value: "b", label: "باء" },
          { value: "z", label: "زاي", disabled: true },
        ]}
      />,
    );
    key("ArrowDown");
    key("End");
    expect(activeLabel()).toBe("باء");
  });

  it("Home skips a leading disabled option", () => {
    render(
      <ControlledSelect
        options={[
          { value: "z", label: "زاي", disabled: true },
          { value: "a", label: "ألف" },
          { value: "b", label: "باء" },
        ]}
      />,
    );
    key("ArrowDown");
    key("End");
    key("Home");
    expect(activeLabel()).toBe("ألف");
  });

  it("Enter commits the active option", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");

    expect(onChange).toHaveBeenCalledWith("bank");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes WITHOUT committing — the whole point of a cancel key", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    key("ArrowDown");
    key("ArrowDown");
    key("Escape");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("اختر طريقة الدفع");
  });

  it("Tab closes without committing, so tabbing out of a form does not choose for you", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    key("ArrowDown");
    key("Tab");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape on a CLOSED select does nothing rather than swallowing the key", () => {
    // A form's own Escape handler has to keep working when the select is shut.
    render(<ControlledSelect />);
    const event = fireEvent.keyDown(trigger(), { key: "Escape", cancelable: true });
    expect(event).toBe(true); // not preventDefault-ed
  });
});

describe("Select — type-ahead", () => {
  it("jumps to the option starting with the typed letter", () => {
    render(<ControlledSelect />);
    key("ArrowDown");
    fireEvent.keyDown(trigger(), { key: "آ" });
    expect(activeLabel()).toBe("آجل");
  });

  it("accumulates letters typed in quick succession", () => {
    render(
      <ControlledSelect
        options={[
          { value: "1", label: "مصروفات" },
          { value: "2", label: "مصر الوطني" },
        ]}
      />,
    );
    key("ArrowDown");
    // "مص" alone matches both; the third letter is what separates them, so a
    // control that only ever used the LAST keystroke would land on the wrong one.
    for (const ch of "مصر") fireEvent.keyDown(trigger(), { key: ch });
    expect(activeLabel()).toBe("مصر الوطني");
  });

  it("narrows on a growing query instead of walking across the options that share a prefix (D137)", () => {
    // An Arabic catalogue is full of names sharing a first word, so this is the
    // common case here rather than a corner of it: each further keystroke has to
    // keep the match it already has, not step to the next one.
    render(
      <ControlledSelect
        options={[
          { value: "1", label: "بنك مصر" },
          { value: "2", label: "بنك القاهرة" },
        ]}
      />,
    );
    key("ArrowDown");
    expect(activeLabel()).toBe("بنك مصر");

    fireEvent.keyDown(trigger(), { key: "ب" });
    expect(activeLabel()).toBe("بنك القاهرة");
    fireEvent.keyDown(trigger(), { key: "ن" });
    expect(activeLabel()).toBe("بنك القاهرة");
    fireEvent.keyDown(trigger(), { key: "ك" });
    expect(activeLabel()).toBe("بنك القاهرة");
  });

  it("still cycles through the matches when the SAME character is repeated", () => {
    // Repeating one character is the standard way a user asks for the next
    // match, and it is the one case that must not narrow.
    render(
      <ControlledSelect
        options={[
          { value: "1", label: "بنك مصر" },
          { value: "2", label: "بنك القاهرة" },
        ]}
      />,
    );
    key("ArrowDown");
    fireEvent.keyDown(trigger(), { key: "ب" });
    expect(activeLabel()).toBe("بنك القاهرة");
    fireEvent.keyDown(trigger(), { key: "ب" });
    expect(activeLabel()).toBe("بنك مصر");
  });

  it("reaches the second of two names sharing a first word, space and all (D137)", () => {
    const onChange = vi.fn();
    render(
      <ControlledSelect
        onChange={onChange}
        options={[
          { value: "1", label: "بنك مصر" },
          { value: "2", label: "بنك القاهرة" },
        ]}
      />,
    );
    key("ArrowDown");
    for (const char of ["ب", "ن", "ك", " ", "ا", "ل", "ق"]) {
      fireEvent.keyDown(trigger(), { key: char });
    }
    expect(activeLabel()).toBe("بنك القاهرة");
    // The space extended the query rather than committing, so the listbox is
    // still open and nothing has been selected yet.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a space with no query in flight still selects, which is the listbox contract", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    key("ArrowDown");
    fireEvent.keyDown(trigger(), { key: " " });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("starts a fresh query after the 700ms pause, rather than growing forever", () => {
    vi.useFakeTimers();
    try {
      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValue(1_000);

      render(<ControlledSelect />);
      key("ArrowDown");
      fireEvent.keyDown(trigger(), { key: "ب" });
      expect(activeLabel()).toBe("بنكي");

      // Long after the buffer expired, "آ" must be read as a new query and not
      // appended to "ب" — otherwise the control becomes unusable after a pause.
      nowSpy.mockReturnValue(1_000 + 701);
      fireEvent.keyDown(trigger(), { key: "آ" });
      expect(activeLabel()).toBe("آجل");
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("never lands on a disabled option", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    key("ArrowDown");
    fireEvent.keyDown(trigger(), { key: "ش" });

    // «شيك» is the only match and it is disabled, so nothing moves.
    expect(activeLabel()).toBe("نقدي");
  });

  it("commits directly when the list is CLOSED, so typing picks without opening", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: "آ" });

    expect(onChange).toHaveBeenCalledWith("credit");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ignores a modified key, so Ctrl+F still reaches the browser", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: "f", ctrlKey: true });
    fireEvent.keyDown(trigger(), { key: "f", metaKey: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("Select — an empty option list", () => {
  it("shows the empty message and offers nothing to choose", () => {
    render(
      <Select
        aria-label="طريقة الدفع"
        value=""
        options={[]}
        onChange={vi.fn()}
        emptyMessage="لا توجد خيارات"
        placeholder="اختر"
      />,
    );
    fireEvent.click(trigger());

    expect(screen.getByText("لا توجد خيارات")).toBeInTheDocument();
    expect(options()).toHaveLength(0);
  });

  it("survives every key with no options, rather than dividing by zero", () => {
    const onChange = vi.fn();
    render(<Select aria-label="طريقة الدفع" value="" options={[]} onChange={onChange} placeholder="اختر" />);

    for (const k of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "ب", "Escape"]) {
      fireEvent.keyDown(trigger(), { key: k });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Select — grouped options", () => {
  it("renders each group's heading once, above its own options", () => {
    render(
      <ControlledSelect
        options={[
          { value: "c1", label: "الخزنة الرئيسية", group: "نقدية" },
          { value: "c2", label: "خزنة الفرع", group: "نقدية" },
          { value: "b1", label: "حساب البنك الأهلي", group: "بنوك" },
        ]}
      />,
    );
    fireEvent.click(trigger());

    const list = screen.getByRole("listbox");
    expect(within(list).getAllByText("نقدية")).toHaveLength(1);
    expect(within(list).getAllByText("بنوك")).toHaveLength(1);
    expect(options()).toHaveLength(3);
  });
});
