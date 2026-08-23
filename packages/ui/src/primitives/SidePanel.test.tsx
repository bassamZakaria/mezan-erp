// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidePanel } from "./SidePanel";

describe("SidePanel", () => {
  it("renders the title and children when open", () => {
    render(
      <SidePanel open onClose={() => {}} title="لوحة العميل">
        <div>محتوى اللوحة</div>
      </SidePanel>,
    );
    expect(screen.getByRole("dialog", { name: "لوحة العميل" })).toBeInTheDocument();
    expect(screen.getByText("محتوى اللوحة")).toBeInTheDocument();
  });

  it("marks the dialog aria-hidden when closed", () => {
    render(
      <SidePanel open={false} onClose={() => {}} title="لوحة العميل">
        <div>محتوى اللوحة</div>
      </SidePanel>,
    );
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("aria-hidden", "true");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SidePanel open onClose={onClose} title="لوحة العميل">
        <div>محتوى</div>
      </SidePanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "إغلاق اللوحة" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the overlay is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SidePanel open onClose={onClose} title="لوحة العميل">
        <div>محتوى</div>
      </SidePanel>,
    );
    const overlay = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape while open", () => {
    const onClose = vi.fn();
    render(
      <SidePanel open onClose={onClose} title="لوحة العميل">
        <div>محتوى</div>
      </SidePanel>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blurs the focused descendant before hiding, so aria-hidden never applies while focus is retained", () => {
    function Wrapper() {
      const [open, setOpen] = useState(true);
      return (
        <SidePanel open={open} onClose={() => setOpen(false)} title="لوحة العميل">
          <div>محتوى</div>
        </SidePanel>
      );
    }
    render(<Wrapper />);

    const closeButton = screen.getByRole("button", { name: "إغلاق اللوحة" });
    closeButton.focus();
    expect(closeButton).toHaveFocus();

    fireEvent.click(closeButton);

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toHaveAttribute("aria-hidden", "true");
    expect(dialog.contains(document.activeElement)).toBe(false);
  });

  it("restores focus to the previously-focused element (e.g. the trigger) after closing", () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>افتح</button>
          <SidePanel open={open} onClose={() => setOpen(false)} title="لوحة العميل">
            <div>محتوى</div>
          </SidePanel>
        </>
      );
    }
    render(<Wrapper />);

    const trigger = screen.getByRole("button", { name: "افتح" });
    trigger.focus();
    fireEvent.click(trigger);

    const closeButton = screen.getByRole("button", { name: "إغلاق اللوحة" });
    closeButton.focus();
    expect(closeButton).toHaveFocus();
    fireEvent.click(closeButton);

    expect(trigger).toHaveFocus();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(
      <SidePanel open onClose={() => {}} title="لوحة العميل">
        <div>محتوى</div>
      </SidePanel>,
    );
    expect(screen.getByText("محتوى")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
