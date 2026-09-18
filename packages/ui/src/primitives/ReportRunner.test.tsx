// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportRunner, type ReportRunnerColumn, type ReportRunnerParamField, type ReportRunnerResult } from "./ReportRunner";

interface Row {
  id: string;
  label: string;
  amount: number;
}

const columns: ReportRunnerColumn<Row>[] = [
  { key: "label", header: "البند", value: (r) => r.label },
  { key: "amount", header: "المبلغ", format: "money", align: "end", total: true, value: (r) => r.amount },
];

const paramFields: ReportRunnerParamField[] = [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }];

function makeResult(rows: Row[]): ReportRunnerResult<Row> {
  return {
    rows,
    groups: [{ key: "_all", label: "", rows, totals: { amount: rows.reduce((s, r) => s + r.amount, 0) } }],
    grandTotals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
    reconciliation: null,
  };
}

describe("ReportRunner — definition → render", () => {
  it("renders the title, param bar, table headers, row values, and grand total", () => {
    const rows: Row[] = [{ id: "1", label: "نقدية", amount: 1000 }, { id: "2", label: "مبيعات", amount: 500 }];
    render(
      <ReportRunner
        title="تقرير تجريبي"
        description="وصف التقرير"
        paramFields={paramFields}
        params={{ asOfDate: "2026-08-22" }}
        onParamsChange={() => {}}
        result={makeResult(rows)}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );

    expect(screen.getByRole("heading", { name: "تقرير تجريبي" })).toBeInTheDocument();
    expect(screen.getByLabelText("حتى تاريخ")).toHaveValue("2026-08-22");
    expect(screen.getByText("البند")).toBeInTheDocument();
    expect(screen.getByText("نقدية")).toBeInTheDocument();
    expect(screen.getByText("مبيعات")).toBeInTheDocument();
    expect(screen.getByText("الإجمالي")).toBeInTheDocument(); // grand-total row label
  });

  it("shows a field-scoped validation error", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={paramFields}
        params={{ asOfDate: "bad" }}
        onParamsChange={() => {}}
        fieldErrors={{ asOfDate: "تاريخ غير صالح" }}
        result={null}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("تاريخ غير صالح")).toBeInTheDocument();
  });

  it("calls onParamsChange when a param field is edited", () => {
    const onParamsChange = vi.fn();
    render(
      <ReportRunner
        title="تقرير"
        paramFields={paramFields}
        params={{ asOfDate: "2026-08-01" }}
        onParamsChange={onParamsChange}
        result={makeResult([])}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.change(screen.getByLabelText("حتى تاريخ"), { target: { value: "2026-08-22" } });
    expect(onParamsChange).toHaveBeenCalledWith({ asOfDate: "2026-08-22" });
  });
});

describe("ReportRunner — on-demand gating", () => {
  it("shows a placeholder + 'عرض التقرير' button instead of the table before the first run", () => {
    render(
      <ReportRunner
        title="تقرير ثقيل"
        paramFields={paramFields}
        params={{ asOfDate: "2026-08-22" }}
        onParamsChange={() => {}}
        onDemand
        onRun={() => {}}
        result={null}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole("button", { name: "عرض التقرير" })).toBeInTheDocument();
    expect(screen.queryByText("البند")).not.toBeInTheDocument();
  });

  it("runs on button click and then renders the table", () => {
    function Harness() {
      const [result, setResult] = useState<ReportRunnerResult<Row> | null>(null);
      return (
        <ReportRunner
          title="تقرير ثقيل"
          paramFields={paramFields}
          params={{ asOfDate: "2026-08-22" }}
          onParamsChange={() => {}}
          onDemand
          onRun={() => setResult(makeResult([{ id: "1", label: "نقدية", amount: 1000 }]))}
          result={result}
          columns={columns}
          rowKey={(r) => r.id}
        />
      );
    }
    render(<Harness />);
    expect(screen.queryByText("نقدية")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    expect(screen.getByText("نقدية")).toBeInTheDocument();
  });

  it("does not gate a non-on-demand report: renders the table immediately given a result", () => {
    render(
      <ReportRunner
        title="تقرير خفيف"
        paramFields={paramFields}
        params={{ asOfDate: "2026-08-22" }}
        onParamsChange={() => {}}
        result={makeResult([{ id: "1", label: "نقدية", amount: 1000 }])}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.queryByRole("button", { name: "عرض التقرير" })).not.toBeInTheDocument();
    expect(screen.getByText("نقدية")).toBeInTheDocument();
  });
});

describe("ReportRunner — reconciliation banner", () => {
  it("renders a mismatch banner with the diff when out of tolerance", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={{
          rows: [],
          groups: [],
          grandTotals: {},
          reconciliation: { labelAr: "إجمالي المدين = إجمالي الدائن", reportTotal: 100, referenceTotal: 90, diff: 10, withinTolerance: false },
        }}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument();
    expect(screen.getByText("≠")).toBeInTheDocument();
  });
});

describe("ReportRunner — export", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("is disabled when there is no result yet", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        onDemand
        onRun={() => {}}
        result={null}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole("button", { name: "تصدير Excel" })).toBeDisabled();
  });

  it("builds and downloads a workbook when clicked with rows present", async () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([{ id: "1", label: "نقدية", amount: 1000 }])}
        columns={columns}
        rowKey={(r) => r.id}
        exportBaseFilename="demo-report"
      />,
    );
    const button = screen.getByRole("button", { name: "تصدير Excel" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  });
});

/** guards P-6 — no report or financial statement could be printed or saved as a PDF. */
describe("ReportRunner — print and PDF", () => {
  const wideColumns: ReportRunnerColumn<Row>[] = [
    ...columns,
    { key: "c3", header: "٣", value: () => "" },
    { key: "c4", header: "٤", value: () => "" },
    { key: "c5", header: "٥", value: () => "" },
    { key: "c6", header: "٦", value: () => "" },
    { key: "c7", header: "٧", value: () => "" },
  ];

  function runner(props: Partial<React.ComponentProps<typeof ReportRunner<Row>>> = {}) {
    return render(
      <ReportRunner
        title="تقرير تجريبي"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([{ id: "1", label: "نقدية", amount: 1000 }])}
        columns={columns}
        rowKey={(r) => r.id}
        {...props}
      />,
    );
  }

  afterEach(() => {
    delete (window as unknown as { mezan?: unknown }).mezan;
  });

  it("offers «طباعة», which prints the page the reader is looking at", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    runner();
    fireEvent.click(screen.getByRole("button", { name: "طباعة" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("offers no «حفظ PDF» in the browser — its own print dialog already saves one", () => {
    runner();
    expect(screen.queryByRole("button", { name: "حفظ PDF" })).toBeNull();
  });

  it("saves through the desktop bridge, turning a wide report on its side", async () => {
    const savePDF = vi.fn().mockResolvedValue({ ok: true, path: "/tmp/تقرير.pdf" });
    (window as unknown as { mezan: unknown }).mezan = { savePDF };
    runner({ columns: wideColumns, exportBaseFilename: "wide-report" });

    fireEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));

    await waitFor(() => expect(savePDF).toHaveBeenCalledTimes(1));
    expect(savePDF).toHaveBeenCalledWith({ landscape: true, defaultFileName: "wide-report" });
    expect(await screen.findByRole("status")).toHaveTextContent("/tmp/تقرير.pdf");
  });

  it("keeps a narrow report portrait", async () => {
    const savePDF = vi.fn().mockResolvedValue({ ok: false, cancelled: true });
    (window as unknown as { mezan: unknown }).mezan = { savePDF };
    runner();

    fireEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));

    await waitFor(() => expect(savePDF).toHaveBeenCalledTimes(1));
    expect(savePDF.mock.calls[0]?.[0]).toMatchObject({ landscape: false });
  });

  it("says nothing when the operator dismisses the save dialog, and reports a real failure", async () => {
    const savePDF = vi.fn().mockResolvedValue({ ok: false, cancelled: true });
    (window as unknown as { mezan: unknown }).mezan = { savePDF };
    const { rerender } = runner();

    fireEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));
    await waitFor(() => expect(savePDF).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();

    savePDF.mockResolvedValue({ ok: false, cancelled: false, message: "تعذّر حفظ ملف PDF." });
    rerender(
      <ReportRunner
        title="تقرير تجريبي"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([{ id: "1", label: "نقدية", amount: 1000 }])}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));
    expect(await screen.findByRole("status")).toHaveTextContent("تعذّر حفظ ملف PDF.");
  });
});
