// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { renderWithProviders } from "../data/test-support";
import { AppProviders } from "../data/AppProviders";
import { AgingMatrix, type AgingMatrixRow } from "./AgingMatrix";

function withProviders(ui: ReactElement) {
  return (
    <AppProviders>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppProviders>
  );
}

const bucketLabels = ["حتى 30", "31-60", "61-90", "91-120", "أكثر من 120"];
const rows: AgingMatrixRow[] = [
  { key: "c1", label: "عميل الشرق", buckets: ["1000", "0", "500", "0", "0"] },
  { key: "c2", label: "عميل الغرب", buckets: ["0", "0", "0", "0", "0"] },
];

describe("AgingMatrix", () => {
  it("renders the empty label when there are no rows", () => {
    renderWithProviders(
      <AgingMatrix partyHeader="العميل" bucketLabels={bucketLabels} rows={[]} emptyLabel="لا توجد أرصدة متأخرة" />,
    );
    expect(screen.getByText("لا توجد أرصدة متأخرة")).toBeInTheDocument();
  });

  it("renders the party header, bucket headers and every row's label", () => {
    renderWithProviders(
      <AgingMatrix partyHeader="العميل" bucketLabels={bucketLabels} rows={rows} emptyLabel="لا توجد أرصدة متأخرة" />,
    );
    expect(screen.getByText("العميل")).toBeInTheDocument();
    for (const label of bucketLabels) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("عميل الشرق")).toBeInTheDocument();
    expect(screen.getByText("عميل الغرب")).toBeInTheDocument();
  });

  it("formats every bucket value as money, including zero buckets", () => {
    renderWithProviders(
      <AgingMatrix partyHeader="العميل" bucketLabels={bucketLabels} rows={rows} emptyLabel="لا توجد أرصدة متأخرة" />,
    );
    expect(screen.getByText("1,000.00")).toBeInTheDocument();
    expect(screen.getByText("500.00")).toBeInTheDocument();
    expect(screen.getAllByText("0.00").length).toBeGreaterThan(0);
  });

  it("renders a zero bucket plainly (surface background) rather than tinted", () => {
    const { container } = renderWithProviders(
      <AgingMatrix partyHeader="العميل" bucketLabels={bucketLabels} rows={rows} emptyLabel="لا توجد أرصدة متأخرة" />,
    );
    const zeroRowSpans = [...container.querySelectorAll("tbody tr")][1]?.querySelectorAll("span.mz-num") ?? [];
    for (const span of zeroRowSpans) {
      expect((span as HTMLElement).style.background).toBe("var(--surface-2)");
    }
  });

  it("survives a re-render with a new set of rows", () => {
    const { rerender } = renderWithProviders(
      <AgingMatrix partyHeader="العميل" bucketLabels={bucketLabels} rows={rows} emptyLabel="لا توجد أرصدة متأخرة" />,
    );
    expect(screen.getByText("1,000.00")).toBeInTheDocument();

    rerender(
      withProviders(
        <AgingMatrix
          partyHeader="العميل"
          bucketLabels={bucketLabels}
          rows={[{ key: "c3", label: "عميل الجنوب", buckets: ["250", "0", "0", "0", "0"] }]}
          emptyLabel="لا توجد أرصدة متأخرة"
        />,
      ),
    );
    expect(screen.getByText("250.00")).toBeInTheDocument();
    expect(screen.queryByText("عميل الشرق")).not.toBeInTheDocument();
  });
});
