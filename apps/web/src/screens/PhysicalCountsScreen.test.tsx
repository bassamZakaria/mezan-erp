// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { PhysicalCountDTO, StockBalanceRowDTO } from "@mezan/contracts";
import { PhysicalCountsScreen } from "./PhysicalCountsScreen";
import { TEST_ITEMS, TEST_WAREHOUSES } from "./inventory-ops-test-fixtures";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const BALANCE: StockBalanceRowDTO[] = [
  { itemId: "itm-1", onHand: "90.000000", totalValue: "2880.000000", averageCost: "32.000000", warehouseCount: 1 },
];

function count(overrides: Partial<PhysicalCountDTO> = {}): PhysicalCountDTO {
  return {
    id: "c1",
    countNo: "CNT-000001",
    warehouseId: "wh-main",
    date: "2026-08-22",
    memo: "",
    status: "IN_PROGRESS",
    lines: [{ itemId: "itm-1", systemQty: "90.000000", countedQty: null }],
    createdAt: "2026-08-22T08:00:00.000Z",
    completedAt: null,
    generatedAdjustmentId: null,
    ...overrides,
  };
}

function renderScreen(initial: PhysicalCountDTO[] = []) {
  let counts = [...initial];
  const transport = stubTransport({
    "GET /inventory/physical-counts": () => ({ body: counts }),
    "GET /inventory/stock-balance": () => ({ body: { rows: BALANCE } }),
    "GET /warehouses": () => ({ body: TEST_WAREHOUSES }),
    "GET /items": () => ({ body: TEST_ITEMS }),
    "POST /inventory/physical-counts": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { id: string };
      const started = count({ id: body.id });
      counts = [...counts, started];
      return { status: 201, body: started };
    },
    "POST /inventory/physical-counts/*/counts": (init, path) => {
      const id = path.split("/")[3]!;
      const { entries } = JSON.parse((init?.body as string) ?? "{}") as { entries: { itemId: string; countedQty: string }[] };
      const updated = count({
        id,
        lines: [{ itemId: "itm-1", systemQty: "90.000000", countedQty: entries[0]!.countedQty }],
      });
      counts = counts.map((c) => (c.id === id ? updated : c));
      return { body: updated };
    },
    "POST /inventory/physical-counts/*/complete": (_init, path) => {
      const id = path.split("/")[3]!;
      const completed = { ...counts.find((c) => c.id === id)!, status: "COMPLETED" as const };
      counts = counts.map((c) => (c.id === id ? completed : c));
      return { body: completed };
    },
    "POST /inventory/physical-counts/*/generate-adjustment": (_init, path) => {
      const id = path.split("/")[3]!;
      const generated = {
        ...counts.find((c) => c.id === id)!,
        status: "ADJUSTMENT_GENERATED" as const,
        generatedAdjustmentId: "adj-from-count",
      };
      counts = counts.map((c) => (c.id === id ? generated : c));
      return { body: { count: generated, adjustment: null } };
    },
  });
  return renderWithProviders(<PhysicalCountsScreen />, { transport, initialSession: testAdminSession });
}

describe("PhysicalCountsScreen — empty state", () => {
  it("matches the catalog's empty state when the API returns no counts", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument();
    expect(
      await screen.findByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام"),
    ).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — count → variance → adjustment flow", () => {
  it("starts a count, records a variance, completes it, and generates the reconciling adjustment", async () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "جرد جديد" }));
    expect(await screen.findByRole("heading", { name: "جرد جديد" })).toBeInTheDocument();

    // The sheet is seeded from the live stock balance, which loads asynchronously.
    await waitFor(() => expect(screen.getByRole("button", { name: "إضافة" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeInTheDocument());
    expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument();

    const countedInput = screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "85" } });
    expect(screen.getByText("-5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء الجرد" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument());
    fireEvent.click(await screen.findByText("CNT-000001"));

    expect(await screen.findByText("مكتمل")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "توليد تسوية" }));

    await screen.findByText("تم إنشاء التسوية");
    expect(screen.getByText("تم إنشاؤها")).toBeInTheDocument();
    expect(screen.getByText("-5")).toBeInTheDocument();
  });
});
