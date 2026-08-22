// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money, StatusPill } from "./atoms";

describe("Money", () => {
  it("renders a positive amount with the default currency label", () => {
    render(<Money value={1150} />);
    expect(screen.getByText("1,150.00")).toBeInTheDocument();
    expect(screen.getByText("ج.م")).toBeInTheDocument();
  });

  it("keeps the negative sign attached to the LTR-isolated figure", () => {
    render(<Money value={-18087.5} />);
    expect(screen.getByText("-18,087.50")).toBeInTheDocument();
  });

  it("supports both light and dark theme roots without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Money value={42} />);
    expect(screen.getByText("42.00")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("StatusPill", () => {
  it("renders the given label", () => {
    render(<StatusPill label="مؤكد" tone="success" />);
    expect(screen.getByText("مؤكد")).toBeInTheDocument();
  });
});
