// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintTemplatesPage } from "./PrintTemplatesPage";

describe("PrintTemplatesPage", () => {
  it("renders the sample invoice through the shared PrintView, with a real amount-in-words computed by @mezan/domain", () => {
    render(<PrintTemplatesPage />);

    expect(screen.getByRole("heading", { name: "قوالب الطباعة" })).toBeInTheDocument();
    expect(screen.getByText("فاتورة مبيعات")).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText("1,159.95")).toBeInTheDocument();
    expect(
      screen.getByText("ألف ومائة وتسعة وخمسون جنيه مصري وخمسة وتسعون قرش فقط لا غير"),
    ).toBeInTheDocument();
  });
});
