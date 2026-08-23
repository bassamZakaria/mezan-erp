// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { StockTransferDocumentDTO } from "@mezan/contracts";
import { StockTransfersScreen } from "./StockTransfersScreen";
import { TEST_ITEMS, TEST_WAREHOUSES } from "./inventory-ops-test-fixtures";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

function transfer(id: string, docNo: string): StockTransferDocumentDTO {
  return {
    id,
    docType: "STOCK_TRANSFER",
    docNo,
    date: "2026-08-20",
    memo: "تحويل مخزون",
    status: "confirmed",
    lines: [{ itemId: "itm-1", fromWarehouseId: "wh-main", toWarehouseId: "wh-alex", qty: "10.000000" }],
    createdAt: "2026-08-20T09:00:00.000Z",
    confirmedAt: "2026-08-20T09:05:00.000Z",
  };
}

function renderScreen() {
  let documents = [transfer("t1", "TRF-000001"), transfer("t2", "TRF-000002")];
  const transport = stubTransport({
    "GET /inventory/stock-transfers": () => ({ body: documents }),
    "GET /warehouses": () => ({ body: TEST_WAREHOUSES }),
    "GET /items": () => ({ body: TEST_ITEMS }),
    "POST /inventory/stock-transfers/draft": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { id: string };
      const created: StockTransferDocumentDTO = { ...transfer(body.id, "TRF-000003"), status: "draft", docNo: null };
      documents = [...documents, created];
      return { status: 201, body: created };
    },
    "POST /inventory/stock-transfers/*/confirm": (_init, path) => {
      const id = path.split("/")[3]!;
      const confirmed = transfer(id, "TRF-000003");
      documents = documents.map((d) => (d.id === id ? confirmed : d));
      return { body: confirmed };
    },
  });
  return renderWithProviders(<StockTransfersScreen />, { transport, initialSession: testAdminSession });
}

describe("StockTransfersScreen — list", () => {
  it("renders the confirmed transfers the API returns", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument();
    expect(await screen.findByText("TRF-000001")).toBeInTheDocument();
    expect(screen.getByText("TRF-000002")).toBeInTheDocument();
  });

  it("opens the detail view showing the route and valuation-neutral effect", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("TRF-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getByText("لا يتغير إجمالي قيمة المخزون")).toBeInTheDocument();
    expect(screen.getByText(/لا يمكن إلغاء تحويل مؤكد/)).toBeInTheDocument();
  });
});

describe("StockTransfersScreen — create", () => {
  it("drafts then confirms the transfer through the API and shows it in the list", async () => {
    renderScreen();
    await screen.findByText("TRF-000001");
    fireEvent.click(screen.getByRole("button", { name: "تحويل جديد" }));
    expect(screen.getByRole("heading", { name: "تحويل مخزون جديد" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الصنف للسطر 1"), { target: { value: "itm-1" } });
    fireEvent.change(screen.getByLabelText("كمية التحويل للسطر 1"), { target: { value: "5" } });

    const save = screen.getByRole("button", { name: "حفظ" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByRole("heading", { name: "تحويلات المخزون" })).toBeInTheDocument());
    expect(await screen.findByText("TRF-000003")).toBeInTheDocument();
  });

  it("blocks posting when source and destination warehouses are the same", async () => {
    renderScreen();
    await screen.findByText("TRF-000001");
    fireEvent.click(screen.getByRole("button", { name: "تحويل جديد" }));
    fireEvent.change(screen.getByLabelText("المستودع الوجهة *"), {
      target: { value: (screen.getByLabelText("المستودع المصدر *") as HTMLSelectElement).value },
    });
    expect(screen.getByText("يجب أن يختلف المستودع المصدر عن مستودع الوجهة.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
});
