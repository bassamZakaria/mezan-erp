// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Breadcrumbs } from "./Breadcrumbs";
import { renderWithProviders, testAdminSession, TestNavigation } from "./data/test-support";

describe("Breadcrumbs — the last crumb names where you are", () => {
  it("a bank statement being reconciled is named as that, not by the statement's internal id", () => {
    renderWithProviders(
      <TestNavigation initialSegments={["3f0c7b1a-52de-4a8e-9d1b-7a6f0c2e4b19"]}>
        <Breadcrumbs screen="bank-reconciliation" />
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.getByText("تسوية كشف بنك")).toBeInTheDocument();
    expect(screen.queryByText(/3f0c7b1a/)).not.toBeInTheDocument();
  });

  it("a document addressed by its number still shows that number", () => {
    renderWithProviders(
      <TestNavigation initialSegments={["PI-000004"]}>
        <Breadcrumbs screen="purchase-invoices" />
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.getByText("PI-000004")).toBeInTheDocument();
  });
});
