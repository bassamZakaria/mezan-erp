// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { WarehouseDTO, WritedownRunDTO } from "@mezan/contracts";
import { WritedownRunsScreen } from "./WritedownRunsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleWarehouses: WarehouseDTO[] = [
  { id: "wh-1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "br-1", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
];

const sampleRuns: WritedownRunDTO[] = [
  {
    id: "run-1",
    period: "2026-06",
    warehouseId: "wh-1",
    status: "draft",
    lines: [{ itemId: "item-1", warehouseId: "wh-1", onHandQty: "20.000000", unitCost: "100.000000", agingDays: 211, writedownRateBps: 2500, amount: "500.000000" }],
    totalAmount: "500.000000",
    journalEntryId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    postedAt: null,
  },
  {
    id: "run-2",
    period: "2026-05",
    warehouseId: null,
    status: "posted",
    lines: [{ itemId: "item-2", warehouseId: "wh-1", onHandQty: "5.000000", unitCost: "40.000000", agingDays: 400, writedownRateBps: 5000, amount: "100.000000" }],
    totalAmount: "100.000000",
    journalEntryId: "je-900",
    createdAt: "2026-05-01T00:00:00.000Z",
    postedAt: "2026-05-02T00:00:00.000Z",
  },
];

function renderScreen(runs: WritedownRunDTO[] = sampleRuns) {
  let current = [...runs];
  const transport = stubTransport({
    "GET /inventory/writedown-runs": () => ({ body: current }),
    "GET /warehouses": () => ({ body: sampleWarehouses }),
    "POST /inventory/writedown-runs": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((r) => r.period === body.period && r.warehouseId === (body.warehouseId ?? null))) {
        return { status: 409, body: { error: "DUPLICATE_WRITEDOWN_PERIOD", message: "تم تشغيل عملية لهذه الفترة من قبل." } };
      }
      const created: WritedownRunDTO = {
        id: `run-${current.length + 1}`,
        period: body.period,
        warehouseId: body.warehouseId ?? null,
        status: "draft",
        lines: [{ itemId: "item-3", warehouseId: "wh-1", onHandQty: "10.000000", unitCost: "50.000000", agingDays: 200, writedownRateBps: 2500, amount: "125.000000" }],
        totalAmount: "125.000000",
        journalEntryId: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        postedAt: null,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /inventory/writedown-runs/run-1/post": () => {
      const posted: WritedownRunDTO = { ...current[0]!, status: "posted", journalEntryId: "je-901", postedAt: "2026-06-02T00:00:00.000Z" };
      current = [posted, ...current.slice(1)];
      return { body: posted };
    },
  });
  return renderWithProviders(<WritedownRunsScreen />, { transport, initialSession: testAdminSession });
}

describe("WritedownRunsScreen", () => {
  it("lists write-down runs from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "هبوط قيمة المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("2026-05")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs yet", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد عمليات هبوط قيمة/)).toBeInTheDocument();
  });

  it("filters the list by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    fireEvent.click(screen.getByRole("tab", { name: /^مرحل/ }));
    // `useUrlParam`'s write is buffered onto a microtask (url-state.ts), so
    // the filtered rows only settle after that flushes.
    await waitFor(() => expect(screen.queryByText("2026-06")).not.toBeInTheDocument());
    expect(screen.getByText("2026-05")).toBeInTheDocument();
  });

  it("creates a new write-down run through the side panel", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل عملية جديدة" }));

    const dialog = screen.getByRole("dialog", { name: "تشغيل عملية هبوط قيمة جديدة" });
    // NumberField's label isn't wired to its input via htmlFor/id
    // (settings/form-controls.tsx's Field passes none), so the year and
    // month fields are reached by their spinbutton order instead.
    const [yearField, monthField] = within(dialog).getAllByRole("spinbutton");
    fireEvent.change(yearField!, { target: { value: "2026" } });
    fireEvent.change(monthField!, { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تشغيل" }));

    expect(await screen.findByText("2026-07")).toBeInTheDocument();
  });

  it("posts a draft run from its row action", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    // The post action lives in the row's overflow menu now, not a bare button.
    fireEvent.click(screen.getByRole("button", { name: "إجراءات 2026-06" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "ترحيل" }));

    // The list itself has no journal-entry column — the post's own journal
    // entry only shows in the run's detail panel, so open it to confirm the
    // post actually landed rather than just watching the row menu close.
    fireEvent.click(await screen.findByText("2026-06"));
    const detail = screen.getByRole("dialog", { name: /عملية هبوط قيمة —/ });
    expect(await within(detail).findByText(/je-901/)).toBeInTheDocument();
  });

  it("opens the run detail panel listing its lines and aging on row click", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("2026-05"));

    const detail = screen.getByRole("dialog", { name: /عملية هبوط قيمة —/ });
    expect(within(detail).getByText("item-2")).toBeInTheDocument();
    expect(within(detail).getByText("400")).toBeInTheDocument();
  });
});
