// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AllScreensPanel } from "./AllScreensPanel";
import type { NavGroup } from "./types";

/**
 * «كل الشاشات» — the panel that reaches every screen in the product. It is how
 * the shell routes: an operator who cannot find a screen here cannot reach it
 * at all, because most destinations have no other entry point. So the search,
 * the workspace filter and the keyboard walk are the navigation, not a
 * convenience on top of it.
 */

function groups(): NavGroup[] {
  return [
    {
      key: "sales",
      label: "المبيعات",
      items: [
        { key: "invoices", label: "فواتير المبيعات", onClick: vi.fn() },
        { key: "customers", label: "العملاء", onClick: vi.fn() },
      ],
      sections: [
        {
          key: "sales-reports",
          label: "تقارير المبيعات",
          items: [{ key: "by-item", label: "المبيعات حسب الصنف", onClick: vi.fn() }],
        },
      ],
    },
    {
      key: "purchases",
      label: "المشتريات",
      items: [
        { key: "pinvoices", label: "فواتير المشتريات", onClick: vi.fn() },
        { key: "suppliers", label: "الموردون", onClick: vi.fn() },
      ],
    },
  ];
}

function renderPanel(overrides: Partial<Parameters<typeof AllScreensPanel>[0]> = {}) {
  const onClose = vi.fn();
  const nav = overrides.groups ?? groups();
  const view = render(
    <AllScreensPanel open onClose={onClose} groups={nav} {...overrides} />,
  );
  return { ...view, onClose, nav };
}

const dialog = () => screen.getByRole("dialog");

/**
 * `onRowsKeyDown` is bound to the scrolling rows container, not to the dialog,
 * so an event fired at the dialog never reaches it. Fire at whatever holds
 * focus — always a row once the walk has started — and let it bubble.
 */
function pressInRows(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

/** Enters the row list from the search box, leaving focus on the first row. */
function enterRows() {
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
}

describe("AllScreensPanel — it renders nothing until it is opened", () => {
  it("renders no dialog when closed", () => {
    render(<AllScreensPanel open={false} onClose={vi.fn()} groups={groups()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists every destination once it is open, grouped under its workspace", () => {
    renderPanel();
    expect(screen.getByText("فواتير المبيعات")).toBeInTheDocument();
    expect(screen.getByText("العملاء")).toBeInTheDocument();
    expect(screen.getByText("الموردون")).toBeInTheDocument();
    // A nested section's item is reachable too — the reports tree is three
    // levels deep and a flat renderer would drop this one.
    expect(screen.getByText("المبيعات حسب الصنف")).toBeInTheDocument();
  });

  it("marks the screen on display as the current page, and only that one", () => {
    renderPanel({ activeKey: "customers" });
    const current = within(dialog()).getAllByRole("button", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("العملاء");
  });
});

describe("AllScreensPanel — search", () => {
  it("narrows to the matching destinations and REMOVES the rest", () => {
    // The half that matters: asserting only that the match is present would
    // pass against a search that filters nothing at all.
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "الموردون" } });

    expect(screen.getByText("الموردون")).toBeInTheDocument();
    expect(screen.queryByText("فواتير المبيعات")).toBeNull();
    expect(screen.queryByText("العملاء")).toBeNull();
  });

  it("matches on the workspace name too, so «المشتريات» finds everything under it", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "المشتريات" } });

    expect(screen.getByText("فواتير المشتريات")).toBeInTheDocument();
    expect(screen.getByText("الموردون")).toBeInTheDocument();
    expect(screen.queryByText("العملاء")).toBeNull();
  });

  it("matches on the section name, so «تقارير» finds the report inside it", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "تقارير" } });
    expect(screen.getByText("المبيعات حسب الصنف")).toBeInTheDocument();
    expect(screen.queryByText("العملاء")).toBeNull();
  });

  it("ignores surrounding whitespace rather than finding nothing", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  العملاء  " } });
    expect(screen.getByText("العملاء")).toBeInTheDocument();
  });

  it("drops a group heading once its last row is filtered out", () => {
    // A heading with nothing under it reads as an empty workspace rather than
    // as a filtered one. Scoped to headings, because «المبيعات» is also the
    // label of a workspace filter chip that legitimately stays on screen.
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "الموردون" } });

    const headings = within(dialog())
      .getAllByRole("heading")
      .map((h) => h.textContent?.trim());
    expect(headings).not.toContain("المبيعات");
    expect(headings).toContain("المشتريات");
  });

  it("shows nothing at all for a query that matches nothing", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "زجزجزج" } });

    for (const label of ["فواتير المبيعات", "العملاء", "الموردون", "المبيعات حسب الصنف"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

describe("AllScreensPanel — the workspace filter", () => {
  it("pre-selects the workspace it was opened from, so the click lands where the user was", () => {
    renderPanel({ workspaceKey: "purchases" });

    expect(screen.getByText("الموردون")).toBeInTheDocument();
    expect(screen.queryByText("العملاء")).toBeNull();
  });

  it("shows everything when no workspace was named", () => {
    renderPanel();
    expect(screen.getByText("العملاء")).toBeInTheDocument();
    expect(screen.getByText("الموردون")).toBeInTheDocument();
  });
});

describe("AllScreensPanel — choosing a destination", () => {
  it("runs the item's own handler and closes the panel", () => {
    const nav = groups();
    const { onClose } = renderPanel({ groups: nav });

    fireEvent.click(screen.getByText("الموردون"));

    expect(nav[1]?.items[1]?.onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs ONLY that item's handler", () => {
    const nav = groups();
    renderPanel({ groups: nav });

    fireEvent.click(screen.getByText("العملاء"));

    expect(nav[0]?.items[1]?.onClick).toHaveBeenCalledTimes(1);
    expect(nav[0]?.items[0]?.onClick).not.toHaveBeenCalled();
    expect(nav[1]?.items[0]?.onClick).not.toHaveBeenCalled();
  });

  it("closes cleanly for an item that carries no handler at all", () => {
    const { onClose } = renderPanel({
      groups: [{ key: "g", label: "مجموعة", items: [{ key: "x", label: "بلا إجراء" }] }],
    });

    fireEvent.click(screen.getByText("بلا إجراء"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AllScreensPanel — the keyboard walk", () => {
  it("Escape closes the panel", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown from the search box moves into the first row", () => {
    renderPanel();
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(document.activeElement).toHaveTextContent("فواتير المبيعات");
  });

  it("ArrowDown and ArrowUp walk the rows in document order", () => {
    renderPanel();
    enterRows();

    pressInRows("ArrowDown");
    expect(document.activeElement).toHaveTextContent("العملاء");

    pressInRows("ArrowUp");
    expect(document.activeElement).toHaveTextContent("فواتير المبيعات");
  });

  it("wraps from the last row back to the first, and from the first back to the last", () => {
    // A long list is a ring here, not a dead end — the panel is a launcher.
    renderPanel();
    enterRows();

    pressInRows("End");
    const last = document.activeElement;
    // Document order is: the sales items, then the sales SECTION's item, then
    // the purchases items — so the last row is «الموردون», not the first
    // purchases row. A renderer that appended sections after all groups would
    // put a different row here.
    expect(last).toHaveTextContent("الموردون");

    pressInRows("ArrowDown");
    const first = document.activeElement;
    expect(first).toHaveTextContent("فواتير المبيعات");
    expect(first).not.toBe(last);

    pressInRows("ArrowUp");
    expect(document.activeElement).toBe(last);
  });

  it("Home and End reach the first and last rows", () => {
    renderPanel();
    enterRows();

    pressInRows("Home");
    expect(document.activeElement).toHaveTextContent("فواتير المبيعات");

    pressInRows("End");
    expect(document.activeElement).toHaveTextContent("الموردون");
  });

  it("walks only the rows that survived the search", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "المشتريات" } });
    enterRows();

    pressInRows("Home");
    expect(document.activeElement).toHaveTextContent("فواتير المشتريات");

    pressInRows("End");
    expect(document.activeElement).toHaveTextContent("الموردون");
  });

  it("survives arrowing when the search matched nothing, rather than dividing by zero", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "زجزجزج" } });

    const search = screen.getByRole("searchbox");
    expect(() => {
      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "End" });
      fireEvent.keyDown(search, { key: "Home" });
    }).not.toThrow();
    // Focus stayed in the search box rather than jumping into a list that has
    // no rows to jump to.
    expect(document.activeElement).toBe(search);
  });

  it("leaves other keys alone, so typing into the search box still works", () => {
    renderPanel();
    const search = screen.getByRole("searchbox");
    const event = fireEvent.keyDown(search, { key: "a", cancelable: true });
    expect(event).toBe(true); // not preventDefault-ed
  });
});
