// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../data/test-support";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import type { ModuleJump } from "./shortcuts";

const jumps: ModuleJump[] = [
  { letter: "s", label: "المبيعات", go: vi.fn() },
  { letter: "p", label: "المشتريات", go: vi.fn() },
];

describe("ShortcutsOverlay", () => {
  it("renders nothing when closed", () => {
    const { container } = renderWithProviders(<ShortcutsOverlay open={false} onClose={vi.fn()} moduleJumps={jumps} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders an aria-modal dialog with every module jump listed when open", () => {
    renderWithProviders(<ShortcutsOverlay open onClose={vi.fn()} moduleJumps={jumps} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("المشتريات")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    renderWithProviders(<ShortcutsOverlay open onClose={onClose} moduleJumps={jumps} />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(<ShortcutsOverlay open onClose={onClose} moduleJumps={jumps} />);
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the close button when it opens", async () => {
    renderWithProviders(<ShortcutsOverlay open onClose={vi.fn()} moduleJumps={jumps} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("button")[0]));
  });

  it("renders with an empty moduleJumps list without crashing", () => {
    renderWithProviders(<ShortcutsOverlay open onClose={vi.fn()} moduleJumps={[]} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
