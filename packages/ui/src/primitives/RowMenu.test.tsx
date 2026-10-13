// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowActionOutcome, RowMenu, type RowMenuItem } from "./RowMenu";
import { ToastProvider } from "./feedback";

function renderWithToasts(items: RowMenuItem[], label = "إجراءات INV-000001") {
  return render(
    <ToastProvider>
      <RowMenu items={items} label={label} />
    </ToastProvider>,
  );
}

describe("RowMenu", () => {
  it("renders nothing when there are no items", () => {
    const { container } = render(<RowMenu items={[]} label="إجراءات" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a trigger button labelled for the row, closed by default", () => {
    render(<RowMenu items={[{ key: "confirm", label: "تأكيد", onSelect: () => {} }]} label="إجراءات INV-000001" />);
    const trigger = screen.getByRole("button", { name: "إجراءات INV-000001" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is reachable by Tab and Enter opens the menu", async () => {
    const user = userEvent.setup();
    render(<RowMenu items={[{ key: "confirm", label: "تأكيد", onSelect: () => {} }]} label="إجراءات" />);
    await user.tab();
    expect(screen.getByRole("button", { name: "إجراءات" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu", { name: "إجراءات" })).toBeInTheDocument();
  });

  it("Space also opens the menu", async () => {
    const user = userEvent.setup();
    render(<RowMenu items={[{ key: "confirm", label: "تأكيد", onSelect: () => {} }]} label="إجراءات" />);
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("opens on click and lists each item as a menuitem", async () => {
    const user = userEvent.setup();
    render(
      <RowMenu
        items={[
          { key: "confirm", label: "تأكيد", onSelect: () => {} },
          { key: "cancel", label: "إلغاء", onSelect: () => {}, tone: "danger" },
        ]}
        label="إجراءات"
      />,
    );
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(screen.getByRole("button", { name: "إجراءات" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "تأكيد" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "إلغاء" })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<RowMenu items={[{ key: "confirm", label: "تأكيد", onSelect: () => {} }]} label="إجراءات" />);
    const trigger = screen.getByRole("button", { name: "إجراءات" });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when a pointer-down happens outside the menu", () => {
    render(
      <>
        <RowMenu items={[{ key: "confirm", label: "تأكيد", onSelect: () => {} }]} label="إجراءات" />
        <div>خارج القائمة</div>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("خارج القائمة"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("marks a disabled item's button disabled and never calls onSelect for it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowMenu items={[{ key: "confirm", label: "تأكيد", onSelect, disabled: true }]} label="إجراءات" />,
    );
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    const item = screen.getByRole("menuitem", { name: "تأكيد" });
    expect(item).toBeDisabled();
    await user.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("runs a plain item's onSelect immediately, with no confirmation, and reports success", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithToasts([{ key: "confirm", label: "تأكيد الفاتورة", onSelect }]);
    await user.click(screen.getByRole("button", { name: "إجراءات INV-000001" }));
    await user.click(screen.getByRole("menuitem", { name: "تأكيد الفاتورة" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(await screen.findByText("تم تنفيذ «تأكيد الفاتورة»")).toBeInTheDocument();
  });

  it("shows the caller's successMessage instead of the generic one", async () => {
    const user = userEvent.setup();
    renderWithToasts([{ key: "confirm", label: "تأكيد", onSelect: () => {}, successMessage: "تم تأكيد الفاتورة" }]);
    await user.click(screen.getByRole("button", { name: "إجراءات INV-000001" }));
    await user.click(screen.getByRole("menuitem", { name: "تأكيد" }));
    expect(await screen.findByText("تم تأكيد الفاتورة")).toBeInTheDocument();
  });

  it("says nothing of its own when the action reports that it was refused: the screen's refusal is the only message", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn(async () => RowActionOutcome.Refused);
    renderWithToasts([{ key: "confirm", label: "تأكيد السند", onSelect }]);
    await user.click(screen.getByRole("button", { name: "إجراءات INV-000001" }));
    await user.click(screen.getByRole("menuitem", { name: "تأكيد السند" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("تم تنفيذ «تأكيد السند»")).not.toBeInTheDocument();
    expect(screen.queryByText("تعذّر تنفيذ «تأكيد السند»")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("waits for the action before saying it is done", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSelect = () => new Promise<void>((resolve) => (finish = resolve));
    renderWithToasts([{ key: "confirm", label: "تأكيد السند", onSelect }]);
    await user.click(screen.getByRole("button", { name: "إجراءات INV-000001" }));
    await user.click(screen.getByRole("menuitem", { name: "تأكيد السند" }));
    expect(screen.queryByText("تم تنفيذ «تأكيد السند»")).not.toBeInTheDocument();
    finish();
    expect(await screen.findByText("تم تنفيذ «تأكيد السند»")).toBeInTheDocument();
  });

  it("shows an error toast with the thrown message when onSelect rejects", async () => {
    const user = userEvent.setup();
    renderWithToasts([
      { key: "confirm", label: "تأكيد", onSelect: () => Promise.reject(new Error("لا يوجد اتصال")) },
    ]);
    await user.click(screen.getByRole("button", { name: "إجراءات INV-000001" }));
    await user.click(screen.getByRole("menuitem", { name: "تأكيد" }));
    expect(await screen.findByText("تعذّر تنفيذ «تأكيد»")).toBeInTheDocument();
    expect(screen.getByText("لا يوجد اتصال")).toBeInTheDocument();
  });

  it("always confirms a danger-tone item, even with no explicit confirm config", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RowMenu items={[{ key: "void", label: "إلغاء", onSelect, tone: "danger" }]} label="إجراءات INV-000001" />);
    await user.click(screen.getByRole("button", { name: "إجراءات INV-000001" }));
    await user.click(screen.getByRole("menuitem", { name: "إلغاء" }));
    expect(onSelect).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("تأكيد: إلغاء");
    expect(dialog).toHaveTextContent("سيتم تنفيذ «إلغاء» على إجراءات INV-000001");
    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("uses a supplied confirm title/consequence/confirmLabel instead of the generic wording", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowMenu
        items={[
          {
            key: "void",
            label: "إلغاء",
            onSelect,
            tone: "danger",
            confirm: {
              title: "إلغاء الفاتورة نهائيًا",
              consequence: "لن يمكن التراجع عن هذا الإجراء.",
              confirmLabel: "نعم، إلغاء",
            },
          },
        ]}
        label="إجراءات"
      />,
    );
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    await user.click(screen.getByRole("menuitem", { name: "إلغاء" }));
    expect(screen.getByText("إلغاء الفاتورة نهائيًا")).toBeInTheDocument();
    expect(screen.getByText("لن يمكن التراجع عن هذا الإجراء.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "نعم، إلغاء" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("cancelling the confirm dialog never calls onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RowMenu items={[{ key: "void", label: "إلغاء", onSelect, tone: "danger" }]} label="إجراءات" />);
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    await user.click(screen.getByRole("menuitem", { name: "إلغاء" }));
    await user.click(screen.getByRole("button", { name: "رجوع" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("places the menu at the inline start when align is 'start'", async () => {
    const user = userEvent.setup();
    render(<RowMenu items={[{ key: "a", label: "أ", onSelect: () => {} }]} label="إجراءات" align="start" />);
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(screen.getByRole("menu")).toHaveClass("start-0");
  });

  it("places the menu at the inline end by default", async () => {
    const user = userEvent.setup();
    render(<RowMenu items={[{ key: "a", label: "أ", onSelect: () => {} }]} label="إجراءات" />);
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(screen.getByRole("menu")).toHaveClass("end-0");
  });

  it("does not propagate its own click to an ancestor row click handler", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <RowMenu items={[{ key: "a", label: "أ", onSelect: () => {} }]} label="إجراءات" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("works without a ToastProvider in the tree — the outcome is silently dropped rather than throwing", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RowMenu items={[{ key: "a", label: "أ", onSelect }]} label="إجراءات" />);
    await user.click(screen.getByRole("button", { name: "إجراءات" }));
    await user.click(screen.getByRole("menuitem", { name: "أ" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
  });
});
