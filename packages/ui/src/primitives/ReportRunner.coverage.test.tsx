// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  ReportRunner,
  type ReportRunnerColumn,
  type ReportRunnerParamField,
  type ReportRunnerResult,
} from "./ReportRunner";

interface Row {
  id: string;
  label: string;
  amount: number;
}

const columns: ReportRunnerColumn<Row>[] = [
  { key: "label", header: "البند", value: (r) => r.label },
  { key: "amount", header: "المبلغ", format: "money", align: "end", total: true, value: (r) => r.amount },
];

function makeResult(rows: Row[], extra: Partial<ReportRunnerResult<Row>> = {}): ReportRunnerResult<Row> {
  return {
    rows,
    groups: [{ key: "_all", label: "", rows, totals: { amount: rows.reduce((s, r) => s + r.amount, 0) } }],
    grandTotals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
    reconciliation: null,
    ...extra,
  };
}

const row1: Row = { id: "1", label: "نقدية", amount: 1000 };

describe("ReportRunner — param bar", () => {
  it("renders no param bar at all when there are no param fields", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders a select field and calls onParamsChange with the chosen value", () => {
    const onParamsChange = vi.fn();
    const fields: ReportRunnerParamField[] = [
      { kind: "select", key: "branch", label: "الفرع", options: [{ value: "main", label: "الفرع الرئيسي" }, { value: "cairo", label: "فرع القاهرة" }] },
    ];
    render(
      <ReportRunner title="تقرير" paramFields={fields} params={{ branch: "main" }} onParamsChange={onParamsChange} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "الفرع" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "فرع القاهرة" }));
    expect(onParamsChange).toHaveBeenCalledWith({ branch: "cairo" });
  });

  it("renders a text field with its placeholder and calls onParamsChange as the reader types", () => {
    const onParamsChange = vi.fn();
    const fields: ReportRunnerParamField[] = [{ kind: "text", key: "query", label: "بحث", placeholder: "اكتب هنا" }];
    render(
      <ReportRunner title="تقرير" paramFields={fields} params={{}} onParamsChange={onParamsChange} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    fireEvent.change(screen.getByPlaceholderText("اكتب هنا"), { target: { value: "قيد" } });
    expect(onParamsChange).toHaveBeenCalledWith({ query: "قيد" });
  });

  it("renders both ends of a date-range field and calls onParamsChange for each end", () => {
    const onParamsChange = vi.fn();
    const fields: ReportRunnerParamField[] = [{ kind: "dateRange", fromKey: "from", toKey: "to", label: "الفترة" }];
    render(
      <ReportRunner title="تقرير" paramFields={fields} params={{}} onParamsChange={onParamsChange} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    fireEvent.change(screen.getByLabelText("الفترة — من"), { target: { value: "2026-08-01" } });
    expect(onParamsChange).toHaveBeenCalledWith({ from: "2026-08-01" });
    fireEvent.change(screen.getByLabelText("الفترة — إلى"), { target: { value: "2026-08-31" } });
    expect(onParamsChange).toHaveBeenCalledWith({ to: "2026-08-31" });
  });

  it("keys a date-range field's validation error off its fromKey", () => {
    const fields: ReportRunnerParamField[] = [{ kind: "dateRange", fromKey: "from", toKey: "to", label: "الفترة" }];
    render(
      <ReportRunner
        title="تقرير"
        paramFields={fields}
        params={{}}
        onParamsChange={() => {}}
        fieldErrors={{ from: "تاريخ البداية بعد تاريخ النهاية" }}
        result={makeResult([])}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("تاريخ البداية بعد تاريخ النهاية")).toBeInTheDocument();
  });

  it("shows the top-level _root error banner when the server rejects without naming a field", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        fieldErrors={{ _root: "تعذر تشغيل التقرير" }}
        result={makeResult([])}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("تعذر تشغيل التقرير");
  });
});

describe("ReportRunner — quick period chips", () => {
  const fields: ReportRunnerParamField[] = [{ kind: "dateRange", fromKey: "from", toKey: "to", label: "الفترة" }];

  it("shows no quick-period chips when the report has no date-range field", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[{ kind: "date", key: "d", label: "تاريخ" }]} params={{}} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByRole("button", { name: "هذا الشهر" })).not.toBeInTheDocument();
  });

  it("marks a quick-period chip pressed only once its computed range matches the current params", () => {
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    render(
      <ReportRunner title="تقرير" paramFields={fields} params={{ from, to: "9999-01-01" }} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole("button", { name: "هذا الشهر" })).toHaveAttribute("aria-pressed", "false");
  });

  it("sets both ends of the range when a quick-period chip is clicked", () => {
    const onParamsChange = vi.fn();
    render(
      <ReportRunner title="تقرير" paramFields={fields} params={{}} onParamsChange={onParamsChange} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "هذا الشهر" }));
    expect(onParamsChange).toHaveBeenCalledTimes(1);
    const call = onParamsChange.mock.calls[0]![0];
    expect(call.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("ReportRunner — not-on-demand empty/loading placeholder", () => {
  it("shows a loading placeholder before the first result when loading is true", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} loading result={null} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByText("جارٍ التحميل…")).toBeInTheDocument();
  });

  it("shows the empty-data placeholder when not loading and there is no result", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={null} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByText("لا توجد بيانات.")).toBeInTheDocument();
  });

  it("disables the run button while loading, and shows the loading label on it", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[{ kind: "date", key: "d", label: "تاريخ" }]} params={{}} onParamsChange={() => {}} onDemand onRun={() => {}} loading result={null} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole("button", { name: "جارٍ التحميل…" })).toBeDisabled();
  });
});

describe("ReportRunner — reconciliation and balance check", () => {
  it("renders an agreement banner with '=' when the reconciliation is within tolerance", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], { reconciliation: { labelAr: "إجمالي المدين = إجمالي الدائن", reportTotal: 100, referenceTotal: 100, diff: 0, withinTolerance: true } })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("=")).toBeInTheDocument();
    expect(screen.queryByText(/فرق/)).not.toBeInTheDocument();
  });

  it("renders the balanced status banner with a check mark", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], { balanceCheck: { label: "ميزان المراجعة متوازن", balanced: true } })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("ميزان المراجعة متوازن");
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders the unbalanced status banner with a cross mark", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], { balanceCheck: { label: "ميزان المراجعة غير متوازن", balanced: false } })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("✕")).toBeInTheDocument();
  });

  it("renders no balance-check banner when the result carries none", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("ReportRunner — summary strip", () => {
  it("composes the headline from the first two KPIs when none is given", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], {
          summary: { kpis: [{ key: "a", label: "الإيرادات", value: 1000 }, { key: "b", label: "المصروفات", value: 400 }] },
        })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole("button", { name: /الإيرادات:.*المصروفات:/ })).toBeInTheDocument();
  });

  it("uses the explicit headline when one is given, instead of composing one", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], { summary: { headline: "صافي الربح جيد هذا الشهر", kpis: [{ key: "a", label: "الإيرادات", value: 1000 }] } })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("صافي الربح جيد هذا الشهر")).toBeInTheDocument();
  });

  it("collapses and re-expands the KPI grid on toggle click", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], { summary: { headline: "ملخص", kpis: [{ key: "a", label: "الإيرادات", value: 1000, hint: "شامل الضريبة" }] } })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("شامل الضريبة")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ملخص/ }));
    expect(screen.queryByText("شامل الضريبة")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ملخص/ }));
    expect(screen.getByText("شامل الضريبة")).toBeInTheDocument();
  });

  it("colors a KPI value for the success and danger tones", () => {
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([], {
          summary: {
            headline: "ملخص",
            kpis: [
              { key: "a", label: "أرباح", value: 500, tone: "success", format: "qty" },
              { key: "b", label: "خسائر", value: 200, tone: "danger", format: "qty" },
            ],
          },
        })}
        columns={columns}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("500").parentElement).toHaveClass("text-success-ink");
    expect(screen.getByText("200").parentElement).toHaveClass("text-danger-ink");
  });

  it("renders no summary strip when the result carries none", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByText("عرض التفاصيل")).not.toBeInTheDocument();
  });
});

describe("ReportRunner — chart", () => {
  it("renders the chart and its caption only when both are given", () => {
    const { rerender } = render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();

    rerender(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([])}
        columns={columns}
        rowKey={(r) => r.id}
        chart={<div data-testid="chart">رسم بياني</div>}
        chartCaption="اقرأ العمود الأزرق كإجمالي المبيعات"
      />,
    );
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText("اقرأ العمود الأزرق كإجمالي المبيعات")).toBeInTheDocument();
  });
});

describe("ReportRunner — cell formats", () => {
  function renderCell(format: ReportRunnerColumn<Row>["format"], value: number | string | null) {
    const cellColumns: ReportRunnerColumn<Row>[] = [{ key: "v", header: "قيمة", format, value: () => value }];
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={cellColumns} rowKey={(r) => r.id} />,
    );
  }

  it("renders an em dash for a null cell value regardless of format", () => {
    renderCell("money", null);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a qty cell with the localized number", () => {
    renderCell("qty", 12.5);
    expect(screen.getByText("12.5")).toBeInTheDocument();
  });

  it("renders a percent cell with a trailing % sign", () => {
    renderCell("percent", 42);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("renders a share cell as a clamped bar plus a % figure", () => {
    renderCell("share", 130);
    expect(screen.getByText("130%")).toBeInTheDocument();
  });

  it("renders a positive variance with a leading plus sign", () => {
    renderCell("variance", 250);
    expect(screen.getByText("+250.00")).toBeInTheDocument();
  });

  it("renders a negative variance without a leading plus sign", () => {
    renderCell("variance", -250);
    expect(screen.getByText("-250.00")).toBeInTheDocument();
  });

  it("renders a date cell using the localized date formatter", () => {
    renderCell("date", "2026-08-22");
    expect(screen.queryByText("2026-08-22")).not.toBeInTheDocument();
  });

  it("renders a plain text cell as-is when it isn't a recognised numeric format", () => {
    renderCell("text", "ملاحظة حرة");
    expect(screen.getByText("ملاحظة حرة")).toBeInTheDocument();
  });

  it("stringifies a numeric value with no format given", () => {
    renderCell(undefined, 7);
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});

describe("ReportRunner — entity drill-down cells", () => {
  const entityColumns: ReportRunnerColumn<Row>[] = [
    { key: "label", header: "البند", value: (r) => r.label, entity: { kind: "account", id: (r) => (r.id === "1" ? "acc-1" : null) } },
  ];

  it("renders an entity cell as a clickable button that calls onEntityClick with its id", () => {
    const onEntityClick = vi.fn();
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={entityColumns} rowKey={(r) => r.id} onEntityClick={onEntityClick} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "نقدية" }));
    expect(onEntityClick).toHaveBeenCalledWith({ kind: "account", id: "acc-1", label: "نقدية" });
  });

  it("renders an entity cell as plain text when onEntityClick is not given", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={entityColumns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByRole("button", { name: "نقدية" })).not.toBeInTheDocument();
    expect(screen.getByText("نقدية")).toBeInTheDocument();
  });

  it("renders an entity cell as plain text when the row's entity id resolves to null", () => {
    const onEntityClick = vi.fn();
    render(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([{ id: "2", label: "مبيعات", amount: 500 }])}
        columns={entityColumns}
        rowKey={(r) => r.id}
        onEntityClick={onEntityClick}
      />,
    );
    expect(screen.queryByRole("button", { name: "مبيعات" })).not.toBeInTheDocument();
  });
});

describe("ReportRunner — groups, totals and empty rows", () => {
  it("shows no group header for a single unlabeled group", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByText("إجمالي ")).not.toBeInTheDocument();
  });

  it("shows a header (and a subtotal row) for each of several groups", () => {
    const result: ReportRunnerResult<Row> = {
      rows: [row1, { id: "2", label: "مبيعات", amount: 500 }],
      groups: [
        { key: "g1", label: "النقدية", rows: [row1], totals: { amount: 1000 } },
        { key: "g2", label: "المبيعات", rows: [{ id: "2", label: "مبيعات", amount: 500 }], totals: { amount: 500 } },
      ],
      grandTotals: { amount: 1500 },
      reconciliation: null,
    };
    render(<ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={result} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText("النقدية")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("إجمالي النقدية")).toBeInTheDocument();
    expect(screen.getByText("إجمالي المبيعات")).toBeInTheDocument();
  });

  it("shows a header even for a single group when it carries a non-empty label", () => {
    const result: ReportRunnerResult<Row> = {
      rows: [row1],
      groups: [{ key: "g1", label: "الأصول", rows: [row1], totals: { amount: 1000 } }],
      grandTotals: { amount: 1000 },
      reconciliation: null,
    };
    render(<ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={result} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText("الأصول")).toBeInTheDocument();
  });

  it("hides the grand-total row when showGrandTotal is false", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} showGrandTotal={false} />,
    );
    expect(screen.queryByText("الإجمالي")).not.toBeInTheDocument();
  });

  it("hides the grand-total row when no column defines a total", () => {
    const noTotalColumns: ReportRunnerColumn<Row>[] = [{ key: "label", header: "البند", value: (r) => r.label }];
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={noTotalColumns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByText("الإجمالي")).not.toBeInTheDocument();
  });

  it("shows the no-rows message when the result has an empty row set", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument();
  });

  it("shows no no-rows message once there are rows", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByText("لا توجد بيانات لعرضها.")).not.toBeInTheDocument();
  });
});

describe("ReportRunner — methodology and footer", () => {
  it("shows the methodology note only when provided", () => {
    const { rerender } = render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.queryByText("أساس الاحتساب")).not.toBeInTheDocument();

    rerender(
      <ReportRunner
        title="تقرير"
        paramFields={[]}
        params={{}}
        onParamsChange={() => {}}
        result={makeResult([row1])}
        columns={columns}
        rowKey={(r) => r.id}
        methodology="يشمل القيود المرحّلة فقط"
      />,
    );
    expect(screen.getByText("يشمل القيود المرحّلة فقط")).toBeInTheDocument();
  });

  it("renders the footer slot after the table when given", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} footer={<div>لوحة تفصيلية</div>} />,
    );
    expect(screen.getByText("لوحة تفصيلية")).toBeInTheDocument();
  });
});

describe("ReportRunner — export button states", () => {
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

  it("disables export when the result has zero rows", () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([])} columns={columns} rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole("button", { name: "تصدير CSV" })).toBeDisabled();
  });

  it("exports as CSV when the CSV button is clicked", async () => {
    render(
      <ReportRunner title="تقرير" paramFields={[]} params={{}} onParamsChange={() => {}} result={makeResult([row1])} columns={columns} rowKey={(r) => r.id} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "تصدير CSV" }));
    await screen.findByRole("button", { name: "تصدير CSV" });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
