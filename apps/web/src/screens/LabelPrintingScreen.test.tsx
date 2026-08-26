// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { ItemDTO } from "@mezan/contracts";
import { LabelPrintingScreen } from "./LabelPrintingScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "ITM-001",
    nameAr: "قميص قطن",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: ["1234567890"],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: "120.00",
    costPrice: "60.00",
    taxRatePercent: 14,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  };
}

function renderScreen(items: ItemDTO[]) {
  const transport = stubTransport({
    "GET /items": () => ({ body: items }),
  });
  return renderWithProviders(<LabelPrintingScreen />, { transport, initialSession: testAdminSession });
}

describe("LabelPrintingScreen", () => {
  it("shows the disclaimer and the empty state before any item is added", async () => {
    renderScreen([item()]);
    expect(await screen.findByText(/الطباعة لا تغير أي سعر/)).toBeInTheDocument();
    expect(screen.getByText(/لم تتم إضافة أي صنف بعد/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "معاينة وطباعة" })).toBeDisabled();
  });

  it("adds an item via the picker, shows its printed price, and enables print", async () => {
    renderScreen([item()]);
    const picker = await screen.findByLabelText("إضافة صنف");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "قميص" } });
    fireEvent.mouseDown(await screen.findByRole("button", { name: /قميص قطن/ }));

    expect(await screen.findByText("120.000000")).toBeInTheDocument();
    expect(screen.getByText(/الإجمالي:/).parentElement).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "معاينة وطباعة" })).not.toBeDisabled();
  });

  it("flags a barcode that doesn't fit the selected template with the exact Arabic message, and blocks print", async () => {
    renderScreen([item({ barcodes: ["12345678901234567890123456789"] })]);
    const picker = await screen.findByLabelText("إضافة صنف");
    fireEvent.focus(picker);
    fireEvent.mouseDown(await screen.findByRole("button", { name: /قميص قطن/ }));

    expect(await screen.findByText("الباركود لا يناسب هذا القالب")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "معاينة وطباعة" })).toBeDisabled();
  });

  it("removes a line and re-empties the batch", async () => {
    renderScreen([item()]);
    const picker = await screen.findByLabelText("إضافة صنف");
    fireEvent.focus(picker);
    fireEvent.mouseDown(await screen.findByRole("button", { name: /قميص قطن/ }));
    expect(await screen.findByRole("button", { name: "إزالة" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إزالة" }));
    expect(await screen.findByText(/لم تتم إضافة أي صنف بعد/)).toBeInTheDocument();
  });
});
