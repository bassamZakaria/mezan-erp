// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { EntityPicker, type EntityPickerOption } from "./EntityPicker";

const options: EntityPickerOption[] = [
  { id: "1", label: "شركة الأمل للتجارة", sublabel: "CUST-001" },
  { id: "2", label: "مؤسسة النور للمقاولات", sublabel: "CUST-002" },
  { id: "3", label: "شركة سياج للصناعات", sublabel: "CUST-003" },
];

describe("EntityPicker", () => {
  it("associates the label with the input via htmlFor/id, even without an explicit id prop", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    expect(screen.getByLabelText("العميل")).toBe(screen.getByRole("combobox"));
  });

  it("uses a caller-supplied id instead of generating one", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" id="picker-customer" />);
    const input = screen.getByLabelText("العميل");
    expect(input).toHaveAttribute("id", "picker-customer");
  });

  it("shows the selected entity as the field's VALUE when closed, never as placeholder ink", () => {
    render(<EntityPicker value={options[0] ?? null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("شركة الأمل للتجارة");
    expect(input).not.toHaveAttribute("placeholder", "شركة الأمل للتجارة");
  });

  it("opens the listbox on focus and lists all options", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters options as the user types", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "سياج" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("شركة سياج للصناعات")).toBeInTheDocument();
  });

  it("calls onChange with the selected option", () => {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("مؤسسة النور للمقاولات"));
    expect(onChange).toHaveBeenCalledWith(options[1]);
  });

  it("shows an empty message when nothing matches", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} emptyMessage="لا نتائج" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz-no-match" } });
    expect(screen.getByText("لا نتائج")).toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("EntityPicker — the keyboard path", () => {
  function open() {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    return { input, onChange };
  }

  it("moves the highlight down with ArrowDown and selects it with Enter", () => {
    const { input, onChange } = open();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[1]);
  });

  it("selects the first option with Enter alone, without arrowing", () => {
    const { input, onChange } = open();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[0]);
  });

  it("moves back up with ArrowUp and stops at the first option", () => {
    const { input, onChange } = open();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[0]);
  });

  it("stops at the last option rather than wrapping past the end", () => {
    const { input, onChange } = open();
    for (let i = 0; i < 10; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[2]);
  });

  it("closes on Escape without selecting anything", () => {
    const { input, onChange } = open();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens on ArrowDown from a closed picker, so the list is reachable without the mouse", () => {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("selects within the FILTERED list, not the original one", () => {
    const { input, onChange } = open();
    fireEvent.change(input, { target: { value: "سياج" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[2]);
  });

  it("selects nothing when the filter matches nothing", () => {
    const { input, onChange } = open();
    fireEvent.change(input, { target: { value: "لا يوجد" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("EntityPicker — Arabic search (D114)", () => {
  it("finds a hamza-spelled entity from an unhamzated query, the way the list screens do", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    // «الأمل» typed without the hamza — the way an operator in a hurry types it,
    // and the way the customer list itself matches, because that list runs the
    // app's own normaliser.
    fireEvent.change(input, { target: { value: "الامل" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("شركة الأمل للتجارة");

    // Spelled exactly, it still matches: forgiving the variant must not cost
    // the correct spelling.
    fireEvent.change(input, { target: { value: "الأمل" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("folds ة/ه, ى/ي and Arabic-Indic digits, and still refuses a word that is not there", () => {
    const arabicOptions: EntityPickerOption[] = [
      { id: "1", label: "مؤسسة فاطمة الزهراء", sublabel: "CUST-010" },
      { id: "2", label: "شركة ليلى للتوريدات", sublabel: "CUST-011" },
      { id: "3", label: "فرع ٢٠٢٦ التجاري", sublabel: "CUST-012" },
    ];
    render(<EntityPicker value={null} onChange={() => {}} options={arabicOptions} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: "فاطمه" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "ليلي" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "2026" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    // Negative control: the normaliser folds spelling variance, never meaning.
    fireEvent.change(input, { target: { value: "الاسكندرية" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("matches on the sublabel too, so a code finds its entity", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "CUST-002" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("ignores case and surrounding space in a Latin query", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "  cust-003  " } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  describe("server search", () => {
    it("reports each query and shows the caller's options unfiltered, since the server matched on fields the label lacks", () => {
      const onQueryChange = vi.fn();
      render(<EntityPicker value={null} onChange={() => {}} options={options} label="الصنف" onQueryChange={onQueryChange} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "6221" } });
      expect(onQueryChange).toHaveBeenLastCalledWith("6221");
      expect(screen.getAllByRole("option")).toHaveLength(3);
    });

    it("says it is searching, not that nothing matched, while the first results are on their way", () => {
      render(<EntityPicker value={null} onChange={() => {}} options={[]} label="الصنف" onQueryChange={() => {}} loading />);
      fireEvent.focus(screen.getByRole("combobox"));
      expect(screen.getByText("جارٍ البحث…")).toBeInTheDocument();
      expect(screen.queryByText("لا توجد نتائج")).toBeNull();
    });

    it("never binds a row from the previous search: Enter waits for fresh results, then takes the first", () => {
      const onChange = vi.fn();
      const stale: EntityPickerOption[] = [{ id: "itm-soap", label: "صابون" }];
      const fresh: EntityPickerOption[] = [{ id: "itm-tea", label: "شاي" }];
      const picker = (options: EntityPickerOption[], loading: boolean) => (
        <EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} loading={loading} />
      );
      const { rerender } = render(picker(stale, false));
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "شاي" } });
      rerender(picker(stale, true));
      expect(screen.queryByText("صابون")).toBeNull();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();

      rerender(picker(fresh, false));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(fresh[0]);
    });

    function ServerPicker({ onChange, results, loading }: { onChange: (o: EntityPickerOption | null) => void; results: (q: string) => EntityPickerOption[]; loading: (q: string) => boolean }) {
      const [query, setQuery] = useState("");
      const [value, setValue] = useState<EntityPickerOption | null>(null);
      return (
        <EntityPicker
          value={value}
          onChange={(o) => {
            setValue(o);
            onChange(o);
          }}
          options={results(query)}
          label="الصنف"
          onQueryChange={setQuery}
          loading={loading(query)}
        />
      );
    }

    it("a second scan on the same focus searches only what was scanned, not the previous item's name", () => {
      const onChange = vi.fn();
      const catalogue: EntityPickerOption[] = [
        { id: "a", label: "Alpha 111" },
        { id: "g", label: "Gamma 333" },
        { id: "z", label: "Zeta 3" },
      ];
      render(<ServerPicker onChange={onChange} results={(q) => catalogue.filter((o) => q !== "" && o.label.includes(q))} loading={() => false} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "111" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input).toHaveValue("Alpha 111");
      fireEvent.change(input, { target: { value: "Alpha 111333" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange.mock.calls.map(([o]) => o?.id)).toEqual(["a", "g"]);
    });

    it("Enter in a closed or empty picker opens it and binds nothing", () => {
      const onChange = vi.fn();
      render(<ServerPicker onChange={onChange} results={() => options} loading={() => false} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("with nothing typed, Enter takes the row the arrow keys moved to", () => {
      const onChange = vi.fn();
      render(<EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith(options[1]);
    });

    it("an arrow key from an earlier visit, or one pressed before any rows arrived, does not let a bare Enter bind a row", () => {
      const onChange = vi.fn();
      const picker = (loading: boolean) => <EntityPicker value={null} onChange={onChange} options={loading ? [] : options} label="الصنف" onQueryChange={() => {}} loading={loading} />;
      const { rerender } = render(picker(false));
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.blur(input);
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();

      rerender(picker(true));
      fireEvent.blur(input);
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      rerender(picker(false));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("an Enter pressed during a refetch after the user moved the highlight binds nothing, rather than the first row", () => {
      const onChange = vi.fn();
      const picker = (loading: boolean) => <EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} loading={loading} />;
      const { rerender } = render(picker(false));
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "شركة" } });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      rerender(picker(true));
      fireEvent.keyDown(input, { key: "Enter" });
      rerender(picker(false));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("a failed search drops a waiting Enter, so a later recovery binds nothing on its own", () => {
      const onChange = vi.fn();
      const picker = (state: "loading" | "error" | "ready") => (
        <EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} loading={state === "loading"} error={state === "error"} />
      );
      const { rerender } = render(picker("loading"));
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "شركة" } });
      fireEvent.keyDown(input, { key: "Enter" });
      rerender(picker("error"));
      rerender(picker("ready"));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("an arrow key that moves nothing does not count as a choice", () => {
      const onChange = vi.fn();
      render(<EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("after a refetch reorders the rows, Enter binds the row the user highlighted, not whatever now sits at its old position", () => {
      const onChange = vi.fn();
      const [a, b, c] = options as [EntityPickerOption, EntityPickerOption, EntityPickerOption];
      const picker = (rows: EntityPickerOption[], loading: boolean) => <EntityPicker value={null} onChange={onChange} options={rows} label="الصنف" onQueryChange={() => {}} loading={loading} />;
      const { rerender } = render(picker([a, b, c], false));
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "شركة" } });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      rerender(picker([a, b, c], true));
      rerender(picker([c, a, b], false));
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith(b);
    });

    it("Escape cancels an Enter that was waiting for results", () => {
      const onChange = vi.fn();
      const picker = (loading: boolean) => <EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} loading={loading} />;
      const { rerender } = render(picker(true));
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "شركة" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Escape" });
      rerender(picker(false));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("announces a failed search instead of an empty one, and Enter does nothing", () => {
      const onChange = vi.fn();
      render(<EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} error />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      expect(screen.getByRole("status")).toHaveTextContent("تعذّر البحث، حاول مرة أخرى");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("clears the server query once an option is chosen", () => {
      const onQueryChange = vi.fn();
      render(<EntityPicker value={null} onChange={() => {}} options={options} label="الصنف" onQueryChange={onQueryChange} />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "شركة" } });
      fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));
      expect(onQueryChange).toHaveBeenLastCalledWith("");
    });
  });

  it("clicking the focused field reopens the list after a choice", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.mouseDown(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("points assistive tech at the highlighted row, and keeps one status region while the list is open", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    const status = screen.getByRole("status");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id);
    fireEvent.change(input, { target: { value: "لا شيء يطابق" } });
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("لا توجد نتائج");
  });

  it("Tab leaves an open picker for the next field instead of losing focus", () => {
    render(
      <>
        <EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />
        <input aria-label="التالي" />
      </>,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    for (const button of screen.getByRole("listbox").querySelectorAll("button")) expect(button).toHaveAttribute("tabindex", "-1");
  });

  it("an arrow key pressed while a refetch hides the rows keeps the row the user highlighted", () => {
    const onChange = vi.fn();
    const picker = (loading: boolean) => <EntityPicker value={null} onChange={onChange} options={options} label="الصنف" onQueryChange={() => {}} loading={loading} />;
    const { rerender } = render(picker(false));
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "شركة" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    rerender(picker(true));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    rerender(picker(false));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[2]);
  });

  it("only a primary-button press picks a row", () => {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"), { button: 2 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reopening after a pick starts from the first row, and a list change keeps the highlighted row", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange.mock.calls.map(([o]) => o.id)).toEqual(["2", "1"]);

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    rerender(<EntityPicker value={null} onChange={onChange} options={[{ id: "0", label: "زيتا" }, ...options]} label="العميل" />);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(options[2]);
  });
});
