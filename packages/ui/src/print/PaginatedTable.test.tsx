// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaginatedTable, type PaginatedTableColumn } from "./PaginatedTable";

interface Row {
  id: string;
  label: string;
  value: string;
}

const columns: PaginatedTableColumn<Row>[] = [
  { key: "label", header: "البند", render: (r) => r.label },
  { key: "value", header: "القيمة", align: "end", render: (r) => r.value, carry: (r) => r.value },
];

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, label: `بند ${i + 1}`, value: "100.00" }));
}

describe("PaginatedTable", () => {
  it("repeats the identity header on every page and numbers them", () => {
    render(
      <PaginatedTable<Row>
        columns={columns}
        rows={rows(7)}
        rowKey={(r) => r.id}
        rowsPerPage={3}
        identityHeader={<div>ترويسة المستند</div>}
      />,
    );
    expect(screen.getAllByText("ترويسة المستند")).toHaveLength(3);
    expect(screen.getByText("صفحة 1 من 3")).toBeInTheDocument();
    expect(screen.getByText("صفحة 3 من 3")).toBeInTheDocument();
  });

  it("carries the running subtotal forward, so page n's «ما قبله» is page n−1's «يُرحل»", () => {
    render(
      <PaginatedTable<Row>
        columns={columns}
        rows={rows(6)}
        rowKey={(r) => r.id}
        rowsPerPage={3}
        identityHeader={<div>ترويسة</div>}
      />,
    );
    // Page 1 carries 3 × 100 forward; page 2 brings the same figure in.
    expect(screen.getByText("يُرحل")).toBeInTheDocument();
    expect(screen.getByText("ما قبله")).toBeInTheDocument();
    expect(screen.getAllByText("300.00")).toHaveLength(2);
  });

  it("prints the totals and the signatures on the final page only", () => {
    render(
      <PaginatedTable<Row>
        columns={columns}
        rows={rows(5)}
        rowKey={(r) => r.id}
        rowsPerPage={2}
        identityHeader={<div>ترويسة</div>}
        footer={<div>كتلة الخصومات</div>}
        signatures={<div>التوقيعات</div>}
      />,
    );
    expect(screen.getAllByText("كتلة الخصومات")).toHaveLength(1);
    expect(screen.getAllByText("التوقيعات")).toHaveLength(1);
    expect(screen.getAllByText("ترويسة")).toHaveLength(3);
  });

  it("renders a single page with no carry rows when everything fits", () => {
    render(
      <PaginatedTable<Row>
        columns={columns}
        rows={rows(2)}
        rowKey={(r) => r.id}
        rowsPerPage={22}
        identityHeader={<div>ترويسة</div>}
      />,
    );
    expect(screen.queryByText("يُرحل")).toBeNull();
    expect(screen.queryByText("ما قبله")).toBeNull();
    expect(screen.getByText("صفحة 1 من 1")).toBeInTheDocument();
  });
});
