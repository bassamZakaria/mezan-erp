// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog, Skeleton, SkeletonTable, ToastProvider, useOptionalToast, useToast } from "./feedback";

function ShowToastButton(props: Parameters<ReturnType<typeof useToast>["show"]>[0]) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show(props)}>
      أظهر إشعارًا
    </button>
  );
}

function OptionalToastProbe() {
  const toast = useOptionalToast();
  return <span>{toast ? "متصل" : "غير متصل"}</span>;
}

describe("useToast", () => {
  it("throws when used outside a ToastProvider", () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow("useToast must be used within a ToastProvider");
  });
});

describe("useOptionalToast", () => {
  it("returns null outside a ToastProvider", () => {
    render(<OptionalToastProbe />);
    expect(screen.getByText("غير متصل")).toBeInTheDocument();
  });

  it("returns the context value inside a ToastProvider", () => {
    render(
      <ToastProvider>
        <OptionalToastProbe />
      </ToastProvider>,
    );
    expect(screen.getByText("متصل")).toBeInTheDocument();
  });
});

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a live region labelled in Arabic for the toast stack", () => {
    render(<ToastProvider>{null}</ToastProvider>);
    expect(screen.getByRole("region", { name: "رسائل النظام" })).toBeInTheDocument();
  });

  it("shows a success toast as a status with the message", () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="success" message="تم حفظ الفاتورة" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    expect(screen.getByRole("status")).toHaveTextContent("تم حفظ الفاتورة");
  });

  it("shows an error toast with role alert and assertive live announcement", () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="error" message="فشل الحفظ" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("فشل الحفظ");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("renders the detail line when given", () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="info" message="تنبيه" detail="تفاصيل إضافية" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    expect(screen.getByText("تفاصيل إضافية")).toBeInTheDocument();
  });

  it("auto-dismisses a success toast after its duration", async () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="success" message="تم" duration={1000} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never auto-dismisses an error toast, however long it waits", async () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="error" message="فشل" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("never auto-dismisses a warning toast", async () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="warning" message="تنبيه" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(screen.getByText("تنبيه")).toBeInTheDocument();
  });

  it("extends a short duration to at least 8s when the toast carries an undo action", async () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="success" message="تم الحذف" duration={100} undo={{ onUndo: () => {} }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(7900);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("runs the undo callback and dismisses the toast when its undo button is clicked", () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <ShowToastButton tone="success" message="تم الحذف" undo={{ onUndo, label: "تراجع" }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    fireEvent.click(screen.getByRole("button", { name: "تراجع" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dismisses a toast when its own close button is clicked", () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="info" message="معلومة" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "أظهر إشعارًا" }));
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stacks more than one toast at a time", () => {
    render(
      <ToastProvider>
        <ShowToastButton tone="info" message="الأولى" />
        <ShowToastButton tone="info" message="الثانية" />
      </ToastProvider>,
    );
    const [first, second] = screen.getAllByRole("button", { name: "أظهر إشعارًا" });
    fireEvent.click(first!);
    fireEvent.click(second!);
    expect(screen.getByText("الأولى")).toBeInTheDocument();
    expect(screen.getByText("الثانية")).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="تأكيد الحذف"
        consequence="سيتم حذف الفاتورة نهائيًا"
        confirmLabel="حذف"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a labelled modal dialog with the title and consequence when open", () => {
    render(
      <ConfirmDialog
        open
        title="تأكيد الحذف"
        consequence="سيتم حذف الفاتورة نهائيًا"
        confirmLabel="حذف"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "تأكيد الحذف" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("سيتم حذف الفاتورة نهائيًا")).toBeInTheDocument();
  });

  it("focuses the confirm button by default on open", () => {
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="متابعة"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "متابعة" })).toHaveFocus();
  });

  it("focuses the cancel button instead when tone is danger, so a destructive action never defaults", () => {
    render(
      <ConfirmDialog
        open
        title="تأكيد الحذف"
        consequence="سيتم حذف الفاتورة نهائيًا"
        confirmLabel="حذف"
        tone="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "رجوع" })).toHaveFocus();
  });

  it("uses the default cancel label unless overridden", () => {
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        cancelLabel="إلغاء العملية"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "إلغاء العملية" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "رجوع" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape while open", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the overlay behind the dialog is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    const overlay = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("traps Tab between the cancel and confirm buttons while open", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const cancelButton = screen.getByRole("button", { name: "رجوع" });
    const confirmButton = screen.getByRole("button", { name: "تأكيد" });
    // jsdom never lays elements out, so `offsetParent` (the trap's own
    // visibility check) is always null — stub it so the trap sees both
    // buttons as visible, the way a real browser would.
    Object.defineProperty(cancelButton, "offsetParent", { get: () => document.body, configurable: true });
    Object.defineProperty(confirmButton, "offsetParent", { get: () => document.body, configurable: true });

    expect(confirmButton).toHaveFocus();
    await user.tab();
    expect(cancelButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirmButton).toHaveFocus();
  });

  it("restores focus to the previously-focused element (the trigger) after closing", () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>افتح</button>
          <ConfirmDialog
            open={open}
            title="تأكيد"
            consequence="متابعة؟"
            confirmLabel="تأكيد"
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Wrapper />);
    const trigger = screen.getByRole("button", { name: "افتح" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(trigger).toHaveFocus();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(
      <ConfirmDialog
        open
        title="تأكيد"
        consequence="متابعة؟"
        confirmLabel="تأكيد"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("Skeleton", () => {
  it("renders 3 placeholder lines by default with an sr-only loading announcement", () => {
    const { container } = render(<Skeleton />);
    expect(screen.getByText("جارٍ التحميل…")).toHaveClass("sr-only");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("renders the requested number of lines", () => {
    const { container } = render(<Skeleton lines={5} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
  });

  it("renders at least one line even when lines is 0", () => {
    const { container } = render(<Skeleton lines={0} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });

  it("marks the placeholder lines aria-hidden so only the sr-only text is announced", () => {
    const { container } = render(<Skeleton lines={2} />);
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelectorAll(".animate-pulse")).toHaveLength(2);
  });
});

describe("SkeletonTable", () => {
  it("renders the default 5 rows and 4 columns as placeholder bars, plus one header row", () => {
    const { container } = render(<SkeletonTable />);
    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars).toHaveLength(4 + 5 * 4);
  });

  it("renders a custom row and column count", () => {
    const { container } = render(<SkeletonTable rows={2} columns={3} />);
    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars).toHaveLength(3 + 2 * 3);
  });

  it("renders at least one row and one column even at 0", () => {
    const { container } = render(<SkeletonTable rows={0} columns={0} />);
    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars).toHaveLength(1 + 1 * 1);
  });

  it("announces the loading state for assistive tech", () => {
    render(<SkeletonTable />);
    expect(screen.getByText("جارٍ التحميل…")).toHaveClass("sr-only");
  });
});
