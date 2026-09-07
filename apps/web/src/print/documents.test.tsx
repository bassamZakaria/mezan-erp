// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DEFAULT_PRINT_TEMPLATE_CONFIG } from "@mezan/ui";
import type { PurchaseOrderDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { PurchaseOrderPrintPage } from "./documents";

/**
 * guards P-6 — a purchase order had no print template at all, so the copy a
 * supplier receives carried no tax registration, no VAT breakdown and no
 * total in words.
 */

const order: PurchaseOrderDTO = {
  id: "PO-1",
  number: "PO-0001",
  supplierId: "S1",
  date: "2026-03-01",
  expectedDeliveryDate: "2026-03-15",
  branchId: "B1",
  warehouseId: "W1",
  currency: "EGP",
  notes: "التسليم بالموقع",
  lines: [
    { itemId: "I1", description: null, qty: "2", unitPrice: "150.00", receivedQty: "0" },
  ],
  status: "sent",
  subtotal: "300.00",
  total: "300.00",
  createdBy: "system",
  createdAt: "2026-03-01T00:00:00.000Z",
};

function transportWith(settings: Record<string, unknown> = {}) {
  return stubTransport({
    "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
    "GET /settings": () => ({
      body: {
        companyName: "شركة سايج",
        address: "القاهرة الجديدة",
        taxRegistrationNumber: "123-456-789",
        ...settings,
      },
    }),
    "GET /suppliers": () => ({
      body: [
        {
          id: "S1",
          code: "SUP-1",
          nameAr: "مورد البن",
          nameEn: null,
          taxNumber: "555-666-777",
          phone: "0111111111",
          addressCity: "الجيزة",
          addressDistrict: null,
          addressStreet: null,
        },
      ],
    }),
    "GET /branches": () => ({ body: [{ id: "B1", name: "الفرع الرئيسي" }] }),
    "GET /warehouses": () => ({ body: [{ id: "W1", name: "المخزن الرئيسي" }] }),
    "GET /items": () => ({ body: [{ id: "I1", code: "ITM-1", nameAr: "بن برازيلي", baseUnitCode: "كجم" }] }),
  });
}

describe("PurchaseOrderPrintPage", () => {
  it("prints the company's own tax registration and the supplier's, not just a name", async () => {
    renderWithProviders(<PurchaseOrderPrintPage order={order} />, {
      transport: transportWith(),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText("شركة سايج")).toBeInTheDocument();
    expect(await screen.findByText("123-456-789")).toBeInTheDocument();
    expect(await screen.findByText("مورد البن")).toBeInTheDocument();
    expect(await screen.findByText("555-666-777")).toBeInTheDocument();
  });

  it("names the document and its number, and states the expected delivery date", async () => {
    renderWithProviders(<PurchaseOrderPrintPage order={order} />, {
      transport: transportWith(),
      initialSession: testAdminSession,
    });
    expect(await screen.findByRole("heading", { name: "أمر شراء" })).toBeInTheDocument();
    expect(await screen.findByText("PO-0001")).toBeInTheDocument();
  });

  it("resolves the item to its real catalogue name and unit rather than printing an id", async () => {
    renderWithProviders(<PurchaseOrderPrintPage order={order} />, {
      transport: transportWith(),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText("بن برازيلي")).toBeInTheDocument();
    expect(await screen.findByText("كجم")).toBeInTheDocument();
  });

  it("offers the print toolbar, and warns in Arabic when the company record is missing legal fields", async () => {
    renderWithProviders(<PurchaseOrderPrintPage order={order} />, {
      transport: transportWith({ taxRegistrationNumber: "" }),
      initialSession: testAdminSession,
    });
    expect(await screen.findByRole("button", { name: "طباعة" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("الرقم الضريبي");
  });

  it("prints no ETA block on a document the authority has not accepted", async () => {
    renderWithProviders(<PurchaseOrderPrintPage order={order} />, {
      transport: transportWith(),
      initialSession: testAdminSession,
    });
    await screen.findByText("شركة سايج");
    expect(screen.queryByText("رمز QR للفاتورة الإلكترونية")).toBeNull();
  });
});
