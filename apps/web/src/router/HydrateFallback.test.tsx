// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HydrateFallback } from "./HydrateFallback";

describe("HydrateFallback", () => {
  it("renders a busy status region with the brand mark", () => {
    render(<HydrateFallback />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("ميزان");
  });
});
