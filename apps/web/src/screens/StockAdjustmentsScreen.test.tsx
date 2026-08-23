// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountDTO, StockAdjustmentDocumentDTO } from "@mezan/contracts";
import { StockAdjustmentsScreen } from "./StockAdjustmentsScreen";
import { TEST_ITEMS, TEST_WAREHOUSES } from "./inventory-ops-test-fixtures";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

function account(id: string, nameAr: string): AccountDTO {
  return {
    id,
    code: id,
    nameAr,
    nameEn: nameAr,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
  };
}

const ACCOUNTS = [account("1200", "المخزون"), account("3100", "رأس المال")];

function adjustment(id: string, docNo: string | null, journalEntryId: string | null): StockAdjustmentDocumentDTO {
  return {
    id,
    docType: "STOCK_ADJUSTMENT",
    docNo,
    date: "2026-08-01",
    memo: "رصيد افتتاحي",
    status: "confirmed",
    lines: [
      { itemId: "itm-1", warehouseId: "wh-main", reason: "INITIAL_STOCK", direction: "IN", qty: "100.000000", unitCost: "32.000000" },
    ],
    createdAt: "2026-08-01T08:00:00.000Z",
    confirmedAt: "2026-08-01T08:05:00.000Z",
    journalEntryId,
  };
}

const JOURNAL_ENTRY = {
  id: "a1",
  entryNo: "JE-000201",
  date: "2026-08-01",
  memo: "رصيد افتتاحي",
  source: "system",
  status: "posted",
  lines: [
    { accountId: "1200", debit: "3200.000000", credit: "0.000000" },
    { accountId: "3100", debit: "0.000000", credit: "3200.000000" },
  ],
  createdAt: "2026-08-01T08:05:00.000Z",
  reversalOfId: null,
  reversedById: null,
};

function renderScreen() {
  let documents = [adjustment("a1", "ADJ-000001", "a1"), adjustment("a5", "ADJ-000005", null)];
  const transport = stubTransport({
    "GET /inventory/stock-adjustments": () => ({ body: documents }),
    "GET /warehouses": () => ({ body: TEST_WAREHOUSES }),
    "GET /items": () => ({ body: TEST_ITEMS }),
    "GET /accounts": () => ({ body: ACCOUNTS }),
    "GET /gl/journal-entries/a1": () => ({ body: JOURNAL_ENTRY }),
    "POST /inventory/stock-adjustments/draft": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { id: string };
      const created = { ...adjustment(body.id, null, null), status: "draft" as const };
      documents = [...documents, created];
      return { status: 201, body: created };
    },
    "POST /inventory/stock-adjustments/*/confirm": (_init, path) => {
      const id = path.split("/")[3]!;
      const confirmed = adjustment(id, "ADJ-000006", null);
      documents = documents.map((d) => (d.id === id ? confirmed : d));
      return { body: confirmed };
    },
  });
  return renderWithProviders(<StockAdjustmentsScreen />, { transport, initialSession: testAdminSession });
}

describe("StockAdjustmentsScreen — list", () => {
  it("renders the confirmed adjustments the API returns", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("ADJ-000001")).toBeInTheDocument();
    expect(screen.getByText("ADJ-000005")).toBeInTheDocument();
  });

  it("filters to confirmed via the status chips", async () => {
    renderScreen();
    await screen.findByText("ADJ-000001");
    fireEvent.click(screen.getByRole("tab", { name: /مؤكد/ }));
    expect(screen.getByText("ADJ-000001")).toBeInTheDocument();
  });

  it("opens the detail view with the INITIAL_STOCK opening balance and its GL entry", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("ADJ-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("رصيد افتتاحي")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "المحاسبة" }));
    expect(await screen.findByText("المخزون")).toBeInTheDocument();
    expect(screen.getByText("رأس المال")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — create: reason picker + INITIAL_STOCK flow", () => {
  it("drafts then confirms an opening-balance adjustment and shows it in the list", async () => {
    renderScreen();
    await screen.findByText("ADJ-000001");
    fireEvent.click(screen.getByRole("button", { name: "تسوية جديدة" }));
    expect(screen.getByRole("heading", { name: "اختر سبب التسوية" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /رصيد افتتاحي/ }));
    expect(screen.getByRole("heading", { name: "الرصيد الافتتاحي" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الصنف للسطر 1"), { target: { value: "itm-2" } });
    fireEvent.change(screen.getByLabelText("الكمية للسطر 1"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("سعر التكلفة للسطر 1"), { target: { value: "60" } });

    fireEvent.click(screen.getByRole("button", { name: "اعتماد التسوية" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("ADJ-000006")).toBeInTheDocument();
  });
});

describe("StockAdjustmentsScreen — themes", () => {
  it.each(["light", "dark"] as const)("renders the list in the %s theme", (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    renderScreen();
    expect(screen.getByRole("heading", { name: "تسويات المخزون" })).toBeInTheDocument();
  });
});
