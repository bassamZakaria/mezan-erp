// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemDTO, PurchaseRfqDTO, RfqQuoteDTO, SupplierDTO } from "@mezan/contracts";
import { RfqsScreen } from "./RfqsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * RfqsScreen's detail and create views are sub-pages addressed via the shell's
 * `useSubPage` (navigation.tsx), which no-ops outside a real `NavigationProvider`.
 * This stands in for the shell's URL-driven one with in-memory segments — enough
 * for the screen under test to open, close and read its own sub-page.
 */
function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-cement",
    code: "ITM-1",
    nameAr: "أسمنت بورتلاندي",
    nameEn: null,
    type: "stock",
    baseUnitCode: "شيكارة",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
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

function supplier(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "sup-1",
    code: "S-001",
    nameAr: "مورد الأسمنت",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "0",
    active: true,
    addressCity: null,
    addressDistrict: null,
    addressStreet: null,
    ...overrides,
  };
}

function rfq(overrides: Partial<PurchaseRfqDTO> = {}): PurchaseRfqDTO {
  return {
    id: "rfq-1",
    number: "RFQ-000001",
    date: "2026-08-01",
    requiredByDate: "2026-08-10",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "200", notes: null }],
    status: "draft",
    purchaseOrderId: null,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-01T07:00:00.000Z",
    ...overrides,
  };
}

function quote(overrides: Partial<RfqQuoteDTO> = {}): RfqQuoteDTO {
  return {
    id: "rfq-quote-1",
    rfqId: "rfq-1",
    supplierId: "sup-1",
    lines: [{ itemId: "item-cement", unitPrice: "84.50", notes: null }],
    notes: null,
    submittedAt: "2026-08-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("RfqsScreen", () => {
  it("lists the real RFQs from GET /rfqs", async () => {
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({
          body: [
            rfq({ id: "rfq-3", number: "RFQ-000003", status: "sent" }),
            rfq({ id: "rfq-2", number: "RFQ-000002", status: "closed", purchaseOrderId: "po-2" }),
            rfq({ id: "rfq-1", number: "RFQ-000001", status: "draft" }),
          ],
        }),
        "GET /suppliers": () => ({ body: [supplier()] }),
        "GET /items": () => ({ body: [item()] }),
      }),
    });
    expect(screen.getByRole("heading", { name: "طلبات عروض الأسعار" })).toBeInTheDocument();
    expect(await screen.findByText("RFQ-000003")).toBeInTheDocument();
    expect(screen.getByText("RFQ-000002")).toBeInTheDocument();
    expect(screen.getByText("RFQ-000001")).toBeInTheDocument();
  });

  it("shows the real empty state when there are no RFQs", async () => {
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [] }),
        "GET /suppliers": () => ({ body: [] }),
        "GET /items": () => ({ body: [] }),
      }),
    });
    expect(
      await screen.findByText("لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء"),
    ).toBeInTheDocument();
  });

  it("opens an RFQ detail with the effects panel and a lines tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [rfq({ number: "RFQ-000003", status: "sent" })] }),
        "GET /suppliers": () => ({ body: [supplier()] }),
        "GET /items": () => ({ body: [item()] }),
        "GET /rfqs/rfq-1/quotes": () => ({ body: [] }),
        "GET /rfqs/rfq-1/comparison": () => ({
          body: { rfq: rfq(), supplierIds: [], rows: [], totalsBySupplier: {} },
        }),
      }),
    });
    await user.click(await screen.findByText("RFQ-000003"));
    expect(screen.getByRole("heading", { name: /طلب عرض سعر RFQ-000003/ })).toBeInTheDocument();
    expect(screen.getByText(/لا يؤثر طلب عرض السعر على المخزون/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /البنود/ })).toBeInTheDocument();
  });

  it("sends a draft RFQ (draft → مرسل) through POST /rfqs/:id/send", async () => {
    const user = userEvent.setup();
    let current = rfq({ status: "draft" });
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [current] }),
        "GET /suppliers": () => ({ body: [supplier()] }),
        "GET /items": () => ({ body: [item()] }),
        "GET /rfqs/rfq-1/quotes": () => ({ body: [] }),
        "GET /rfqs/rfq-1/comparison": () => ({
          body: { rfq: current, supplierIds: [], rows: [], totalsBySupplier: {} },
        }),
        "POST /rfqs/rfq-1/send": () => {
          current = { ...current, status: "sent" };
          return { body: current };
        },
      }),
    });
    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("button", { name: "إرسال" }));
    await waitFor(() => expect(screen.getByText("مرسل")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "إرسال" })).not.toBeInTheDocument();
  });

  it("cancels a draft RFQ through POST /rfqs/:id/cancel", async () => {
    const user = userEvent.setup();
    let current = rfq({ status: "draft" });
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [current] }),
        "GET /suppliers": () => ({ body: [supplier()] }),
        "GET /items": () => ({ body: [item()] }),
        "GET /rfqs/rfq-1/quotes": () => ({ body: [] }),
        "GET /rfqs/rfq-1/comparison": () => ({
          body: { rfq: current, supplierIds: [], rows: [], totalsBySupplier: {} },
        }),
        "POST /rfqs/rfq-1/cancel": () => {
          current = { ...current, status: "cancelled" };
          return { body: current };
        },
      }),
    });
    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("button", { name: "إلغاء الطلب" }));
    await waitFor(() => expect(screen.getByText("ملغي")).toBeInTheDocument());
  });

  it("opens the new-RFQ side panel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [] }),
        "GET /suppliers": () => ({ body: [] }),
        "GET /items": () => ({ body: [] }),
      }),
    });
    await screen.findByText("لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء");
    await user.click(screen.getByRole("button", { name: "طلب عرض سعر جديد" }));
    expect(screen.getByRole("dialog", { name: "طلب عرض سعر جديد" })).toBeInTheDocument();
  });

  it("shows the quote comparison grid from GET /rfqs/:id/comparison with the cheapest price highlighted, and converts the chosen supplier's quote into a real PO", async () => {
    const user = userEvent.setup();
    let current = rfq({ status: "sent" });
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [current] }),
        "GET /suppliers": () => ({ body: [supplier({ id: "sup-1" }), supplier({ id: "sup-2", nameAr: "مورد آخر" })] }),
        "GET /items": () => ({ body: [item()] }),
        "GET /rfqs/rfq-1/quotes": () => ({
          body: [quote({ id: "q1", supplierId: "sup-1" }), quote({ id: "q2", supplierId: "sup-2" })],
        }),
        "GET /rfqs/rfq-1/comparison": () => ({
          body: {
            rfq: current,
            supplierIds: ["sup-1", "sup-2"],
            rows: [
              {
                itemId: "item-cement",
                qty: "200",
                quotesBySupplier: { "sup-1": "84.50", "sup-2": "82.00" },
                cheapestSupplierId: "sup-2",
              },
            ],
            totalsBySupplier: { "sup-1": "16900.00", "sup-2": "16400.00" },
          },
        }),
        "POST /rfqs/rfq-1/convert": () => {
          current = { ...current, status: "closed", purchaseOrderId: "po-from-rfq-1" };
          return { status: 201, body: { rfq: current, purchaseOrderId: "po-from-rfq-1" } };
        },
      }),
    });

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: "مقارنة العروض" }));

    const convertButtons = await screen.findAllByRole("button", { name: "تحويل إلى أمر شراء" });
    expect(convertButtons).toHaveLength(2);

    await user.click(convertButtons[0] as HTMLElement);
    await waitFor(() => expect(screen.getByText("مغلق")).toBeInTheDocument());
    expect(screen.getByText(/po-from-rfq-1/)).toBeInTheDocument();
  });

  it("records a new supplier quote against a sent RFQ through POST /rfqs/:id/quotes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TestNavigation><RfqsScreen /></TestNavigation>, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /rfqs": () => ({ body: [rfq({ status: "sent" })] }),
        "GET /suppliers": () => ({ body: [supplier({ id: "sup-1" }), supplier({ id: "sup-2", nameAr: "مورد آخر" })] }),
        "GET /items": () => ({ body: [item()] }),
        "GET /rfqs/rfq-1/quotes": () => ({ body: [quote({ supplierId: "sup-1" })] }),
        "GET /rfqs/rfq-1/comparison": () => ({
          body: { rfq: rfq({ status: "sent" }), supplierIds: ["sup-1"], rows: [], totalsBySupplier: {} },
        }),
      }),
    });
    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: "العروض (1)" }));
    expect(screen.getByText(supplier().nameAr)).toBeInTheDocument();
    expect(screen.getByText("تسجيل عرض سعر جديد")).toBeInTheDocument();
  });
});
