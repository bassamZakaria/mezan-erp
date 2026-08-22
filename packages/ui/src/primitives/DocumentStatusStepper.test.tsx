// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentStatusStepper, type DocumentStatusStep } from "./DocumentStatusStepper";

const STEPS: DocumentStatusStep[] = [
  { key: "draft", label: "مسودة" },
  { key: "pending", label: "بانتظار الموافقة" },
  { key: "posted", label: "مرحل" },
  { key: "reversed", label: "معكوس" },
];

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("DocumentStatusStepper", () => {
  it("renders every lifecycle step and marks the current one", () => {
    render(<DocumentStatusStepper steps={STEPS} currentKey="posted" />);
    for (const s of STEPS) expect(screen.getByText(s.label)).toBeInTheDocument();
    const current = screen.getByText("مرحل").closest("[aria-current]");
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("marks completed steps ahead of the current one with a check", () => {
    render(<DocumentStatusStepper steps={STEPS} currentKey="posted" />);
    // draft + pending precede posted → two check marks.
    expect(screen.getAllByText("✓")).toHaveLength(2);
  });

  it("renders a reversed terminal state in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      document.documentElement.setAttribute("data-theme", theme);
      const { unmount } = render(<DocumentStatusStepper steps={STEPS} currentKey="reversed" tone="danger" />);
      expect(screen.getByText("معكوس").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
      unmount();
    }
  });
});
