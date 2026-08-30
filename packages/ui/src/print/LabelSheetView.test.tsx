// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LabelSheetView, trimMoneyString, type LabelSheetEntry, type LabelSheetLayout } from "./LabelSheetView";

/**
 * ورقة ملصقات — the shelf-label sheet. What a label prints is what the
 * customer reads on the shelf, so a wrong price here is a wrong price in the
 * shop, and a label sheet that silently drops or duplicates labels is a run of
 * wasted stock paper.
 *
 * Prices arrive as exact decimal STRINGS (the Money wire format) and must
 * never be parsed as floats — not even to render them.
 */

const LAYOUT: LabelSheetLayout = {
  pageSize: "A4",
  columns: 3,
  rows: 8,
  labelWidthMm: 63.5,
  labelHeightMm: 33.9,
  columnGapMm: 2.5,
  rowGapMm: 0,
  marginBlockMm: 13,
  marginInlineMm: 7,
  showItemName: true,
  showItemCode: true,
  showPrice: true,
  showUnit: true,
  showBarcode: true,
  showBarcodeText: true,
  barcodeHeightMm: 10,
};

function entry(overrides: Partial<LabelSheetEntry> = {}): LabelSheetEntry {
  return {
    key: "it-1",
    name: "كابل HDMI — 5 متر",
    code: "ITM-0001",
    unit: "قطعة",
    price: "125.500000",
    barcode: "6221031492015",
    copies: 1,
    ...overrides,
  };
}

function renderSheet(entries: readonly LabelSheetEntry[], layout: Partial<LabelSheetLayout> = {}) {
  return render(
    <LabelSheetView layout={{ ...LAYOUT, ...layout }} entries={entries} showToolbar={false} currencyLabel="ج.م" />,
  );
}

/** Every rendered label, in document order. */
function labels(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("div[style*='padding: 1mm']")];
}

/** Every rendered page sheet. */
function pages(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("div[dir='rtl'][style*='grid']")];
}

describe("trimMoneyString — money is trimmed by string surgery, never parsed", () => {
  it("keeps two fraction digits from an exact six-decimal wire value", () => {
    expect(trimMoneyString("125.500000")).toBe("125.50");
    expect(trimMoneyString("0.000000")).toBe("0.00");
    expect(trimMoneyString("1250.750000")).toBe("1250.75");
  });

  it("pads a value that carries fewer digits than asked for", () => {
    // "10.5" must not print as "10.5" on a shelf label beside "10.50".
    expect(trimMoneyString("10.5")).toBe("10.50");
    expect(trimMoneyString("10")).toBe("10.00");
  });

  it("renders an empty or bare-sign value as a zero, not as \".00\" (D136)", () => {
    // `"".split(".")` is `[""]`, not `[undefined]`, so the destructuring
    // default never fired and this returned ".00". It is exported from the
    // package index and PhysicalCountsScreen calls it on a variance figure,
    // where an empty value is exactly what a count with no variance sends.
    expect(trimMoneyString("")).toBe("0.00");
    expect(trimMoneyString("", 0)).toBe("0");
    expect(trimMoneyString(".5")).toBe("0.50");
    expect(trimMoneyString("-")).toBe("-0.00");
  });

  it("drops the fraction entirely at fractionDigits = 0", () => {
    expect(trimMoneyString("125.990000", 0)).toBe("125");
    expect(trimMoneyString("125", 0)).toBe("125");
  });

  it("keeps a negative sign with the integer part", () => {
    expect(trimMoneyString("-40.250000")).toBe("-40.25");
  });

  it("does not go through a float — a value beyond float precision survives intact", () => {
    // 9007199254740993 is not representable as a double; any implementation
    // that parsed this would come back with a different integer part.
    expect(trimMoneyString("9007199254740993.120000")).toBe("9007199254740993.12");
  });

  it("LIMITATION: it TRUNCATES rather than rounds, so a half-piastre price prints low", () => {
    // "10.995000" is 11.00 to two places under HALF_UP, which is what the till
    // charges. The shelf label prints 10.99. The gap is one piastre, and it is
    // the shelf label that the customer argues from.
    expect(trimMoneyString("10.995000")).toBe("10.99");
    expect(trimMoneyString("10.999999")).toBe("10.99");
  });
});

describe("how many labels come out", () => {
  it("prints one label per copy, not one per entry", () => {
    const { container } = renderSheet([entry({ copies: 5 })]);
    expect(labels(container)).toHaveLength(5);
  });

  it("prints nothing for an entry asking for zero copies", () => {
    const { container } = renderSheet([entry({ copies: 0 })]);
    expect(labels(container)).toHaveLength(0);
  });

  it("treats a negative copy count as zero rather than looping backwards", () => {
    const { container } = renderSheet([entry({ copies: -3 })]);
    expect(labels(container)).toHaveLength(0);
  });

  it("floors a fractional copy count", () => {
    // Half a label is not a thing; 2.9 must be 2, never 3.
    const { container } = renderSheet([entry({ copies: 2.9 })]);
    expect(labels(container)).toHaveLength(2);
  });

  it("sums copies across entries, in entry order", () => {
    const { container } = renderSheet([
      entry({ key: "a", name: "صنف أ", copies: 2 }),
      entry({ key: "b", name: "صنف ب", copies: 3 }),
    ]);

    const rendered = labels(container).map((l) => l.textContent ?? "");
    expect(rendered).toHaveLength(5);
    expect(rendered.slice(0, 2).every((text) => text.includes("صنف أ"))).toBe(true);
    expect(rendered.slice(2).every((text) => text.includes("صنف ب"))).toBe(true);
  });
});

describe("how the sheet paginates", () => {
  it("fills one page to columns x rows before starting the next", () => {
    // 3 x 8 = 24 per page. 25 labels is two pages, not one long one, and the
    // second page holds exactly the overflow.
    const { container } = renderSheet([entry({ copies: 25 })]);

    const sheets = pages(container);
    expect(sheets).toHaveLength(2);
    expect(within(sheets[0] as HTMLElement).getAllByText("كابل HDMI — 5 متر")).toHaveLength(24);
    expect(within(sheets[1] as HTMLElement).getAllByText("كابل HDMI — 5 متر")).toHaveLength(1);
  });

  it("puts exactly a full page on one sheet, with no empty second sheet", () => {
    // The off-by-one that would show up as a blank page in every print run.
    const { container } = renderSheet([entry({ copies: 24 })]);
    expect(pages(container)).toHaveLength(1);
  });

  it("breaks after every page except the last, so the printer does not eject a blank", () => {
    const { container } = renderSheet([entry({ copies: 25 })]);
    const sheets = pages(container);

    expect(sheets[0]?.style.breakAfter).toBe("page");
    expect(sheets[1]?.style.breakAfter).toBe("auto");
  });

  it("never divides by zero when a layout says zero columns or rows", () => {
    // A saved layout with a zero would otherwise chunk by 0 and loop forever.
    const { container } = renderSheet([entry({ copies: 3 })], { columns: 0, rows: 0 });
    expect(labels(container)).toHaveLength(3);
    expect(pages(container)).toHaveLength(3);
  });

  it("shows the empty message when there is nothing to print, and no page at all", () => {
    const { container } = renderSheet([]);
    expect(pages(container)).toHaveLength(0);
    expect(labels(container)).toHaveLength(0);
  });
});

describe("what each label shows", () => {
  it("shows the name, code, unit, barcode digits and trimmed price with the currency", () => {
    renderSheet([entry()]);

    expect(screen.getByText("كابل HDMI — 5 متر")).toBeInTheDocument();
    expect(screen.getByText("ITM-0001")).toBeInTheDocument();
    expect(screen.getByText("قطعة")).toBeInTheDocument();
    expect(screen.getByText("6221031492015")).toBeInTheDocument();
    expect(screen.getByText("125.50")).toBeInTheDocument();
    expect(screen.getByText("ج.م", { exact: false })).toBeInTheDocument();
  });

  it("hides each field the layout switches off, and only that field", () => {
    const { container } = renderSheet([entry()], {
      showItemName: false,
      showItemCode: false,
      showUnit: false,
      showPrice: false,
    });

    const text = labels(container)[0]?.textContent ?? "";
    expect(text).not.toContain("كابل HDMI");
    expect(text).not.toContain("ITM-0001");
    expect(text).not.toContain("قطعة");
    expect(text).not.toContain("125.50");
    // The barcode was left on, so it must still be here — otherwise this test
    // would pass against a component that rendered nothing at all.
    expect(text).toContain("6221031492015");
  });

  it("omits the barcode text while keeping the barcode itself", () => {
    const { container } = renderSheet([entry()], { showBarcodeText: false });
    expect(labels(container)[0]?.textContent).not.toContain("6221031492015");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("drops the barcode entirely when the layout switches it off", () => {
    const { container } = renderSheet([entry()], { showBarcode: false });
    expect(container.querySelector("svg")).toBeNull();
    expect(labels(container)[0]?.textContent).not.toContain("6221031492015");
  });

  it("prints no price line for an item that has none, rather than an empty currency", () => {
    const { container } = renderSheet([entry({ price: null })]);
    expect(labels(container)[0]?.textContent).not.toContain("ج.م");
  });

  it("prints no barcode for an item that has none, even with the barcode switched on", () => {
    const { container } = renderSheet([entry({ barcode: null })]);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the barcode digits left-to-right inside the RTL page", () => {
    // A barcode read right-to-left is a different number. The digits carry
    // their own direction.
    renderSheet([entry()]);
    expect(screen.getByText("6221031492015").getAttribute("dir")).toBe("ltr");
  });
});

describe("the page geometry comes from the tenant's layout", () => {
  it("sizes an A4 sheet 210mm x 297mm and an A5 sheet 148mm x 210mm", () => {
    const { container, unmount } = renderSheet([entry()]);
    expect(pages(container)[0]?.style.width).toBe("210mm");
    expect(pages(container)[0]?.style.height).toBe("297mm");
    unmount();

    const a5 = renderSheet([entry()], { pageSize: "A5" });
    expect(pages(a5.container)[0]?.style.width).toBe("148mm");
    expect(pages(a5.container)[0]?.style.height).toBe("210mm");
  });

  it("lays the grid out with the configured columns, label size and gaps", () => {
    const { container } = renderSheet([entry()]);
    const sheet = pages(container)[0] as HTMLElement;

    expect(sheet.style.gridTemplateColumns).toBe("repeat(3, 63.5mm)");
    expect(sheet.style.gridAutoRows).toBe("33.9mm");
    expect(sheet.style.columnGap).toBe("2.5mm");
    expect(sheet.style.paddingBlock).toBe("13mm");
    expect(sheet.style.paddingInline).toBe("7mm");
  });

  it("declares the @page size so the printer uses the sheet, not its own default", () => {
    const { container } = renderSheet([entry()]);
    expect(container.querySelector("style")?.textContent).toContain("@page { size: A4; margin: 0; }");
  });

  it("keeps the page right-to-left", () => {
    const { container } = renderSheet([entry()]);
    expect(pages(container)[0]?.getAttribute("dir")).toBe("rtl");
  });
});
