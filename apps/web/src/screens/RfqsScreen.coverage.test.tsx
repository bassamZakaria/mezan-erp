// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import type { ItemDTO, PurchaseRfqDTO, RfqQuoteDTO, SupplierDTO } from "@mezan/contracts";
import { RfqsScreen } from "./RfqsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider } from "../navigation";

function TestNavigation({ children }: { children: ReactElement }) {
  const [segments, setSegments] = useState<string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: (next) => setSegments([...next]),
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
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock",
    baseUnitCode: "شيكارة", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null,
    description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: null,
    costPrice: null, taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false,
    reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null,
    inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
    ...overrides,
  };
}

function supplier(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "sup-1", code: "S-001", nameAr: "مورد الأسمنت", nameEn: null, phone: null, email: null,
    contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP",
    openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null,
    ...overrides,
  };
}

function rfq(overrides: Partial<PurchaseRfqDTO> = {}): PurchaseRfqDTO {
  return {
    id: "rfq-1", number: "RFQ-000001", date: "2026-08-01", requiredByDate: "2026-08-10",
    branchId: "MAIN", warehouseId: "MAIN-WH", notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "200", notes: null }],
    status: "draft", purchaseOrderId: null, createdBy: "محمد الشهابي", createdAt: "2026-08-01T07:00:00.000Z",
    ...overrides,
  };
}

function quote(overrides: Partial<RfqQuoteDTO> = {}): RfqQuoteDTO {
  return {
    id: "rfq-quote-1", rfqId: "rfq-1", supplierId: "sup-1",
    lines: [{ itemId: "item-cement", unitPrice: "84.50", notes: null }],
    notes: null, submittedAt: "2026-08-11T10:00:00.000Z",
    ...overrides,
  };
}

type Handlers = Record<string, (init: RequestInit | undefined, path: string) => StubResult>;

function mount(overrides: Handlers) {
  renderWithProviders(
    <TestNavigation>
      <RfqsScreen />
    </TestNavigation>,
    {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /suppliers": () => ({ body: [supplier()] }),
        "GET /items": () => ({ body: [item()] }),
        "GET /users": () => ({ body: [] }),
        ...overrides,
      }),
    },
  );
}

describe("RfqsScreen — the register's own fallbacks", () => {
  it("shows a dash for an RFQ with no required-by date and no purchase order yet", async () => {
    mount({ "GET /rfqs": () => ({ body: [rfq({ date: "2026-08-01", requiredByDate: null })] }) });

    const row = (await screen.findByText("RFQ-000001")).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("01/08/2026")).toBeInTheDocument();
  });

  it("names the purchase order an RFQ was converted into", async () => {
    mount({ "GET /rfqs": () => ({ body: [rfq({ status: "closed", purchaseOrderId: "po-from-rfq-1" })] }) });
    expect(await screen.findByText("po-from-rfq-1")).toBeInTheDocument();
  });

  it("falls back to the raw creator id when the user is no longer registered", async () => {
    mount({ "GET /rfqs": () => ({ body: [rfq({ createdBy: "user-gone" })] }) });
    expect(await screen.findByText("user-gone")).toBeInTheDocument();
  });
});

describe("RfqsScreen — the actions each status offers", () => {
  async function menuFor(user: ReturnType<typeof userEvent.setup>, number = "RFQ-000001") {
    await screen.findByText(number);
    await user.click(screen.getByRole("button", { name: `إجراءات ${number}` }));
    return screen.findByRole("menu");
  }

  it("offers send and cancel on a draft, but never close or convert", async () => {
    const user = userEvent.setup();
    mount({ "GET /rfqs": () => ({ body: [rfq({ status: "draft" })] }) });
    const menu = await menuFor(user);

    expect(within(menu).getByRole("menuitem", { name: "إرسال" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "إلغاء الطلب" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "تحويل إلى أمر شراء" })).not.toBeInTheDocument();
  });

  it("offers convert, close and cancel once the request has been sent", async () => {
    const user = userEvent.setup();
    mount({
      "GET /rfqs": () => ({ body: [rfq({ status: "sent" })] }),
      "GET /rfqs/RFQ-000001/quotes": () => ({ body: [] }),
      "GET /rfqs/RFQ-000001/comparison": () => ({ body: { rfq: rfq(), supplierIds: [], rows: [], totalsBySupplier: {} } }),
    });
    const menu = await menuFor(user);

    expect(within(menu).getByRole("menuitem", { name: "تحويل إلى أمر شراء" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "إغلاق بدون تحويل" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "إرسال" })).not.toBeInTheDocument();
  });

  it("offers nothing but a view on a closed request", async () => {
    const user = userEvent.setup();
    mount({ "GET /rfqs": () => ({ body: [rfq({ status: "closed", purchaseOrderId: "po-1" })] }) });
    const menu = await menuFor(user);

    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    expect(within(menu).getByRole("menuitem", { name: "عرض" })).toBeInTheDocument();
  });

  it("surfaces the server's refusal when sending fails, rather than reporting it sent", async () => {
    const user = userEvent.setup();
    mount({
      "GET /rfqs": () => ({ body: [rfq({ status: "draft" })] }),
      "POST /rfqs/rfq-1/send": () => ({ status: 409, body: { error: "NO_LINES", message: "لا يمكن إرسال طلب بلا بنود." } }),
    });
    const menu = await menuFor(user);

    await user.click(within(menu).getByRole("menuitem", { name: "إرسال" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن إرسال طلب بلا بنود.");
  });
});

describe("RfqsScreen — comparing the quotes that came back", () => {
  function comparisonHandlers(quotes: RfqQuoteDTO[], comparison: unknown): Handlers {
    return {
      "GET /rfqs": () => ({ body: [rfq({ status: "sent" })] }),
      "GET /suppliers": () => ({ body: [supplier({ id: "sup-1" }), supplier({ id: "sup-2", nameAr: "مورد آخر" })] }),
      "GET /rfqs/RFQ-000001/quotes": () => ({ body: quotes }),
      "GET /rfqs/RFQ-000001/comparison": () => ({ body: comparison }),
    };
  }

  it("says plainly that there is nothing to compare while no supplier has quoted", async () => {
    const user = userEvent.setup();
    mount(comparisonHandlers([], { rfq: rfq(), supplierIds: [], rows: [], totalsBySupplier: {} }));

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: "مقارنة العروض" }));

    expect(screen.getByText("سجّل عرضاً واحداً على الأقل لعرض المقارنة")).toBeInTheDocument();
  });

  it("shows a dash where a supplier quoted nothing for a line, and marks the cheapest", async () => {
    const user = userEvent.setup();
    mount(
      comparisonHandlers([quote({ id: "q1", supplierId: "sup-1" }), quote({ id: "q2", supplierId: "sup-2" })], {
        rfq: rfq(),
        supplierIds: ["sup-1", "sup-2"],
        rows: [
          { itemId: "item-cement", qty: "200", quotesBySupplier: { "sup-1": "84.50" }, cheapestSupplierId: "sup-1" },
        ],
        totalsBySupplier: { "sup-1": "16900.00" },
      }),
    );

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: "مقارنة العروض" }));

    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("أسمنت بورتلاندي"))!;
    expect(within(row).getByText("84.50")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("falls back to the raw ids when the supplier and the item are both gone", async () => {
    const user = userEvent.setup();
    mount({
      "GET /rfqs": () => ({ body: [rfq({ status: "sent", lines: [{ itemId: "item-gone", description: null, qty: "5", notes: null }] })] }),
      "GET /suppliers": () => ({ body: [] }),
      "GET /rfqs/RFQ-000001/quotes": () => ({ body: [quote({ supplierId: "sup-gone", lines: [{ itemId: "item-gone", unitPrice: "10.00", notes: null }] })] }),
      "GET /rfqs/RFQ-000001/comparison": () => ({
        body: {
          rfq: rfq(),
          supplierIds: ["sup-gone"],
          rows: [{ itemId: "item-gone", qty: "5", quotesBySupplier: { "sup-gone": "10.00" }, cheapestSupplierId: "sup-gone" }],
          totalsBySupplier: { "sup-gone": "50.00" },
        },
      }),
    });

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: "مقارنة العروض" }));

    expect(await screen.findAllByText("sup-gone")).not.toHaveLength(0);
    expect(screen.getAllByText("item-gone").length).toBeGreaterThan(0);
  });

  it("surfaces the server's refusal when a conversion is rejected", async () => {
    const user = userEvent.setup();
    mount({
      ...comparisonHandlers([quote()], {
        rfq: rfq(),
        supplierIds: ["sup-1"],
        rows: [{ itemId: "item-cement", qty: "200", quotesBySupplier: { "sup-1": "84.50" }, cheapestSupplierId: "sup-1" }],
        totalsBySupplier: { "sup-1": "16900.00" },
      }),
      "POST /rfqs/rfq-1/convert": () => ({ status: 422, body: { error: "SUPPLIER_INACTIVE", message: "المورد غير نشط." } }),
    });

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: "مقارنة العروض" }));
    await user.click(await screen.findByRole("button", { name: "تحويل إلى أمر شراء" }));

    expect(await screen.findByText("المورد غير نشط.")).toBeInTheDocument();
  });
});

describe("RfqsScreen — recording a quote", () => {
  it("offers no quote form to a supplier who has already quoted", async () => {
    const user = userEvent.setup();
    mount({
      "GET /rfqs": () => ({ body: [rfq({ status: "sent" })] }),
      "GET /suppliers": () => ({ body: [supplier({ id: "sup-1" })] }),
      "GET /rfqs/RFQ-000001/quotes": () => ({ body: [quote({ supplierId: "sup-1" })] }),
      "GET /rfqs/RFQ-000001/comparison": () => ({
        body: {
          rfq: rfq(),
          supplierIds: ["sup-1"],
          rows: [{ itemId: "item-cement", qty: "200", quotesBySupplier: { "sup-1": "84.50" }, cheapestSupplierId: "sup-1" }],
          totalsBySupplier: { "sup-1": "16900.00" },
        },
      }),
    });

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: /^العروض/ }));
    expect(screen.queryByText("تسجيل عرض سعر جديد")).not.toBeInTheDocument();
  });

  it("shows the note a supplier attached to their quote", async () => {
    const user = userEvent.setup();
    mount({
      "GET /rfqs": () => ({ body: [rfq({ status: "sent" })] }),
      "GET /rfqs/RFQ-000001/quotes": () => ({ body: [quote({ notes: "التسليم خلال أسبوعين" })] }),
      "GET /rfqs/RFQ-000001/comparison": () => ({ body: { rfq: rfq(), supplierIds: ["sup-1"], rows: [], totalsBySupplier: {} } }),
    });

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: /^العروض/ }));
    expect(await screen.findByText("التسليم خلال أسبوعين")).toBeInTheDocument();
  });

  it("surfaces the server's refusal when a quote is rejected", async () => {
    const user = userEvent.setup();
    mount({
      "GET /rfqs": () => ({ body: [rfq({ status: "sent" })] }),
      "GET /suppliers": () => ({ body: [supplier({ id: "sup-2", nameAr: "مورد آخر" })] }),
      "GET /rfqs/RFQ-000001/quotes": () => ({ body: [] }),
      "GET /rfqs/RFQ-000001/comparison": () => ({ body: { rfq: rfq(), supplierIds: [], rows: [], totalsBySupplier: {} } }),
      "POST /rfqs/rfq-1/quotes": () => ({ status: 409, body: { error: "RFQ_CLOSED", message: "الطلب مغلق ولا يقبل عروضاً." } }),
    });

    await user.click(await screen.findByText("RFQ-000001"));
    await user.click(screen.getByRole("tab", { name: /^العروض/ }));

    const picker = await screen.findByLabelText("المورد");
    await user.type(picker, "مورد");
    await user.click(await screen.findByText("مورد آخر"));

    const price = screen.getByLabelText(/سعر أسمنت بورتلاندي/);
    await user.type(price, "80");
    await user.click(screen.getByRole("button", { name: "حفظ العرض" }));

    expect(await screen.findByText("الطلب مغلق ولا يقبل عروضاً.")).toBeInTheDocument();
  });
});
