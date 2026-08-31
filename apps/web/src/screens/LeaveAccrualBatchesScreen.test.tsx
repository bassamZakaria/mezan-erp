// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor} from "@testing-library/react";
import type { LeaveAccrualBatchDTO } from "@mezan/contracts";
import { LeaveAccrualBatchesScreen } from "./LeaveAccrualBatchesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function fieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

function batch(overrides: Partial<LeaveAccrualBatchDTO> = {}): LeaveAccrualBatchDTO {
  return {
    id: "b1",
    number: "LAB-000001",
    periodKey: "2026-07",
    frequency: "monthly",
    runType: "scheduled",
    runDate: "2026-08-01",
    notes: null,
    employeeCount: 9,
    totalDays: "12.000000",
    lines: [],
    runBy: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const batches: LeaveAccrualBatchDTO[] = [
  batch(),
  batch({
    id: "b2",
    number: "LAB-000002",
    frequency: "annual",
    runType: "manual",
    runDate: "2026-08-05",
    notes: "دورة تجريبية",
    employeeCount: 3,
    totalDays: "3.500000",
    runBy: "محمد الشهابي",
    createdAt: "2026-08-05T00:00:00.000Z",
  }),
];

function renderScreen(options: { batches?: LeaveAccrualBatchDTO[]; extra?: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> } = {}) {
  const rows = options.batches ?? batches;
  const calls: string[] = [];
  const transport = stubTransport({
    "GET /hr/leave-accrual-batches": (_init, path) => {
      calls.push(path);
      return { body: rows };
    },
    ...options.extra,
  });
  const view = renderWithProviders(<LeaveAccrualBatchesScreen />, { transport, initialSession: testAdminSession });
  return { ...view, calls };
}

describe("LeaveAccrualBatchesScreen", () => {
  it("lists batches from GET /hr/leave-accrual-batches with day counts trimmed, not the raw six-decimal wire form", async () => {
    const { calls } = renderScreen();
    expect(screen.getByRole("heading", { name: "استحقاقات الإجازات" })).toBeInTheDocument();
    expect(await screen.findByText("LAB-000001")).toBeInTheDocument();
    expect(screen.getByText("LAB-000002")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3.5")).toBeInTheDocument();
    expect(screen.queryByText("12.000000")).not.toBeInTheDocument();
    expect(screen.queryByText("3.500000")).not.toBeInTheDocument();
    expect(calls).toEqual(["/hr/leave-accrual-batches"]);
  });

  it("re-fetches with runType in the query string for each run-type tab", async () => {
    const { calls } = renderScreen();
    await screen.findByText("LAB-000001");
    expect(calls).toEqual(["/hr/leave-accrual-batches"]);

    fireEvent.click(screen.getByRole("radio", { name: "مجدول" }));
    expect(calls.at(-1)).toBe("/hr/leave-accrual-batches?runType=scheduled");

    fireEvent.click(screen.getByRole("radio", { name: "يدوي" }));
    expect(calls.at(-1)).toBe("/hr/leave-accrual-batches?runType=manual");
    expect(calls).toHaveLength(3);

    // "الكل" reuses the query key from the very first (still-fresh) fetch —
    // no new request, but the full list is back.
    fireEvent.click(screen.getByRole("radio", { name: "الكل" }));
    expect(await screen.findByText("LAB-000002")).toBeInTheDocument();
    expect(calls).toHaveLength(3);
  });

  it("renders an honest empty state when there are no batches", async () => {
    renderScreen({ batches: [] });
    expect(await screen.findByText("لا توجد دورات استحقاق بعد — ستظهر هنا كل دورات الاستحقاق المجدولة واليدوية")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("LAB-000001")).not.toBeInTheDocument());
  });

  it("renders an Arabic failure message on a load error, never a raw enum, and retry re-fetches", async () => {
    let attempt = 0;
    renderScreen({
      extra: {
        "GET /hr/leave-accrual-batches": () => {
          attempt += 1;
          return attempt === 1 ? { status: 500, body: { error: "INTERNAL" } } : { body: batches };
        },
      },
    });
    expect(await screen.findByText("تعذّر تحميل دورات الاستحقاق.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("LAB-000001")).toBeInTheDocument();
  });

  it("validates locally that a run date is required, without calling the server", async () => {
    let called = false;
    renderScreen({ extra: { "POST /hr/leave-accrual-batches/run": () => { called = true; return { body: {} }; } } });
    await screen.findByText("LAB-000001");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل استحقاق الآن" }));
    fireEvent.change(fieldInput(document.body, "تاريخ التشغيل *"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل" }));
    expect(await screen.findByText("تاريخ التشغيل مطلوب.")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("runs a new accrual with the exact request body and shows the Arabic 'batch ran' banner", async () => {
    let posted: unknown = null;
    renderScreen({
      extra: {
        "POST /hr/leave-accrual-batches/run": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { body: { batch: batch({ id: "b3", number: "LAB-000003", periodKey: "2026-08" }), created: true } };
        },
      },
    });
    await screen.findByText("LAB-000001");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل استحقاق الآن" }));
    fireEvent.change(fieldInput(document.body, "تاريخ التشغيل *"), { target: { value: "2026-08-15" } });
    fireEvent.change(fieldInput(document.body, "ملاحظات"), { target: { value: "تشغيل يدوي شهري" } });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل" }));

    expect(await screen.findByText("تم تشغيل دورة الاستحقاق LAB-000003 لفترة 2026-08.")).toBeInTheDocument();
    expect(posted).toEqual({
      runDate: "2026-08-15",
      frequency: "monthly",
      runType: "manual",
      notes: "تشغيل يدوي شهري",
    });
  });

  it("shows the 'already ran' Arabic banner and adds no days when the period was already accrued", async () => {
    renderScreen({
      extra: {
        "POST /hr/leave-accrual-batches/run": () => ({
          body: { batch: batch({ id: "b1", number: "LAB-000001", periodKey: "2026-07" }), created: false },
        }),
      },
    });
    await screen.findByText("LAB-000001");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل استحقاق الآن" }));
    fireEvent.change(fieldInput(document.body, "تاريخ التشغيل *"), { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل" }));

    expect(await screen.findByText("فترة 2026-07 سبق تشغيلها في الدورة LAB-000001 — لم تُضف أي أيام.")).toBeInTheDocument();
  });

  it("renders the Arabic refusal message when the server rejects the run, not a raw enum", async () => {
    renderScreen({
      extra: {
        "POST /hr/leave-accrual-batches/run": () => ({
          status: 422,
          body: { error: "NO_ELIGIBLE_POLICIES", message: "لا توجد سياسات إجازات بنفس وتيرة الاستحقاق." },
        }),
      },
    });
    await screen.findByText("LAB-000001");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل استحقاق الآن" }));
    fireEvent.change(fieldInput(document.body, "تاريخ التشغيل *"), { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل" }));

    expect(await screen.findByText("لا توجد سياسات إجازات بنفس وتيرة الاستحقاق.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("NO_ELIGIBLE_POLICIES")).not.toBeInTheDocument());
  });
});
