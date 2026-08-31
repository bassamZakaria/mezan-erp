// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CustomerDTO, ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { ConfigInstancesScreen } from "./ConfigInstancesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { ConfigInstanceRecord, ConfigurableProductRecord } from "../data/hooks";

const items: ItemDTO[] = [
  {
    id: "item-glass", code: "ITM-1", nameAr: "زجاج (م²)", nameEn: null, type: "stock", baseUnitCode: "M2",
    alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null,
    defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: null, costPrice: "85.00",
    taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null,
    imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null,
    contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP",
    openingBalance: "0", active: true, priceListId: null, creditLimit: "0", taxExempt: false, etaBuyerType: "auto",
    commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
  },
];

const warehouses: WarehouseDTO[] = [
  { id: "wh-raw", code: "RAW-WH", name: "مستودع الخامات", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
  { id: "wh-fg", code: "FG-WH", name: "مستودع المنتجات التامة", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
  { id: "wh-wip", code: "WIP-WH", name: "مستودع التشغيل", nameEn: null, branchId: "MAIN", type: "PRODUCTION", isDefault: false, active: true },
];

function product(overrides: Partial<ConfigurableProductRecord> = {}): ConfigurableProductRecord {
  return {
    id: "cp-1", code: "WINDOW", nameAr: "نافذة قابلة للتهيئة", nameEn: null, outputItemId: "item-glass",
    unit: "PCS", description: null,
    inputs: [{ id: "width", labelAr: "العرض", labelEn: null, type: "number", min: null, max: null }],
    materials: [{ itemId: "item-glass", qtyFormula: "width/100", wastePercent: 5 }],
    pricingMethod: "manual", priceFormula: null, laborFormula: null, overheadFormula: null,
    itemPolicy: "per_spec", status: "active", createdBy: "محمد الشهابي", createdAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

function instance(overrides: Partial<ConfigInstanceRecord> = {}): ConfigInstanceRecord {
  return {
    id: "ci-1", number: "CM-000001", configurableProductId: "cp-1", productNameAr: "نافذة قابلة للتهيئة",
    outputItemId: "item-glass", spec: { width: "120" }, qty: "2", customerId: "cust-1",
    sellUnitPrice: "630.00", sellTotal: "1260.00", notes: null, status: "configured",
    bomId: "ci-1:bom", workOrderId: "ci-1:wo",
    materials: [{ itemId: "item-glass", qtyPerUnit: "1.2", wastePercent: 5, lineCost: "102.00" }],
    materialCostPerUnit: "102.00", laborCostPerUnit: "0", overheadCostPerUnit: "0",
    estimatedUnitCost: "102.00", actualCost: null,
    createdBy: "محمد الشهابي", createdAt: "2026-08-12T08:00:00.000Z",
    ...overrides,
  };
}

function mount(instances: ConfigInstanceRecord[], products: ConfigurableProductRecord[] = [product()]) {
  const transport = stubTransport({
    "GET /manufacturing/config-instances": () => ({ body: instances }),
    "GET /manufacturing/configurable-products": () => ({ body: products }),
    "GET /items": () => ({ body: items }),
    "GET /customers": () => ({ body: customers }),
    "GET /warehouses": () => ({ body: warehouses }),
  });
  renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
}

/** The detail view replaces the register in place — it is a page, not an overlay. */
async function openDetail(number = "CM-000001") {
  fireEvent.click(await screen.findByText(number));
  return (await screen.findByRole("heading", { name: `أمر تصنيع مخصص ${number}` })).closest("div")!
    .ownerDocument.body;
}

describe("ConfigInstancesScreen — the margin the order is judged on", () => {
  it("estimates the cost from the per-unit figure while the order has no actual cost yet", async () => {
    mount([instance()]);
    const detail = await openDetail();

    // 1,260 sold against 2 × 102 estimated = 1,056 margin, tagged as a gain.
    expect(within(detail).getByText("1,056.00")).toBeInTheDocument();
  });

  it("uses the ACTUAL cost once production has reported one", async () => {
    mount([instance({ status: "produced", actualCost: "400.00" })]);
    const detail = await openDetail();

    expect(within(detail).getByText("860.00")).toBeInTheDocument();
    expect(within(detail).queryByText("1,056.00")).not.toBeInTheDocument();
  });

  it("marks an order sold below its cost as a loss", async () => {
    mount([instance({ sellTotal: "100.00", actualCost: "400.00" })]);
    const detail = await openDetail();

    expect(within(detail).getByText("-300.00")).toBeInTheDocument();
  });

  it("shows a dash for an actual cost production has not reported", async () => {
    mount([instance()]);
    const detail = await openDetail();

    fireEvent.click(within(detail).getByRole("tab", { name: /التكلفة/ }));
    const term = (await within(detail).findAllByText("التكلفة الفعلية")).at(-1)!;
    expect(within(term.parentElement!).getByText("—")).toBeInTheDocument();
  });
});

describe("ConfigInstancesScreen — orders whose references are gone or absent", () => {
  it("says «بدون عميل» for a stock order raised against no customer at all", async () => {
    mount([instance({ customerId: null })]);
    expect(await screen.findByText(/بدون عميل/)).toBeInTheDocument();
  });

  it("falls back to the raw id when the customer is no longer in the register", async () => {
    mount([instance({ customerId: "cust-gone" })]);
    expect(await screen.findByText(/cust-gone/)).toBeInTheDocument();
  });

  it("falls back to the raw id when the configurable product has been retired", async () => {
    mount([instance({ configurableProductId: "cp-gone" })]);
    expect(await screen.findByText(/cp-gone/)).toBeInTheDocument();
  });

  it("falls back to the raw id for a material whose item is gone from the catalogue", async () => {
    mount([instance({ materials: [{ itemId: "item-gone", qtyPerUnit: "1.2", wastePercent: 5, lineCost: "102.00" }] })]);
    const detail = await openDetail();

    fireEvent.click(within(detail).getByRole("tab", { name: /الخامات/ }));
    expect(await within(detail).findByText("item-gone")).toBeInTheDocument();
  });
});

describe("ConfigInstancesScreen — what a settled order still offers", () => {
  it("offers no close or cancel on an order that is already closed", async () => {
    mount([instance({ status: "closed", actualCost: "204.00" })]);
    const detail = await openDetail();

    expect(within(detail).queryByRole("button", { name: "إغلاق الأمر" })).not.toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "رجوع للتصنيع المخصص" })).toBeInTheDocument();
  });

  it("offers no close or cancel on a cancelled order either", async () => {
    mount([instance({ status: "cancelled" })]);
    const detail = await openDetail();

    expect(within(detail).queryByRole("button", { name: "إغلاق الأمر" })).not.toBeInTheDocument();
  });

  it("still offers both while the order is only configured", async () => {
    mount([instance()]);
    const detail = await openDetail();

    expect(within(detail).getByRole("button", { name: "إغلاق الأمر" })).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "إلغاء" })).toBeInTheDocument();
  });

  it("returns to the register from the detail view", async () => {
    mount([instance()]);
    const detail = await openDetail();

    fireEvent.click(within(detail).getByRole("button", { name: "رجوع للتصنيع المخصص" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("ConfigInstancesScreen — the new-order form's spec fields", () => {
  it("shows a bounded input's own range beside its label, and no range for an unbounded one", async () => {
    mount(
      [instance()],
      [
        product({
          inputs: [
            { id: "width", labelAr: "العرض", labelEn: null, type: "number", min: 60, max: 240 },
            { id: "height", labelAr: "الارتفاع", labelEn: null, type: "number", min: null, max: null },
          ],
        }),
      ],
    );

    await screen.findByText("CM-000001");
    fireEvent.click(screen.getAllByRole("button", { name: "أمر تصنيع مخصص جديد" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });

    const picker = within(dialog).getByLabelText("المنتج *");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "نافذة" } });
    fireEvent.mouseDown(within(dialog).getByRole("button", { name: (n) => n.startsWith("نافذة") }));

    expect(await within(dialog).findByText("العرض (60 – 240)")).toBeInTheDocument();
    expect(within(dialog).getByText("الارتفاع")).toBeInTheDocument();
  });

  it("shows a dash for the end of a range that is open at one side", async () => {
    mount(
      [instance()],
      [product({ inputs: [{ id: "width", labelAr: "العرض", labelEn: null, type: "number", min: 60, max: null }] })],
    );

    await screen.findByText("CM-000001");
    fireEvent.click(screen.getAllByRole("button", { name: "أمر تصنيع مخصص جديد" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });

    const picker = within(dialog).getByLabelText("المنتج *");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "نافذة" } });
    fireEvent.mouseDown(within(dialog).getByRole("button", { name: (n) => n.startsWith("نافذة") }));

    expect(await within(dialog).findByText("العرض (60 – —)")).toBeInTheDocument();
  });
});
