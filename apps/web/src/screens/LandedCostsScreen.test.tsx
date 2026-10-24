// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO, LandedCostDocumentDTO, PurchaseInvoiceDTO, WarehouseDTO } from "@mezan/contracts";
import { LandedCostsScreen } from "./LandedCostsScreen";
import { useState, type ReactNode } from "react";
import { TestNavigation, renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider, type ScreenIntent } from "../navigation";

function NavigationWithIntent({ children, intent }: { children: ReactNode; intent: ScreenIntent }) {
  const [pending, setPending] = useState<ScreenIntent | null>(intent);
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{ navigate: () => {}, segments, openSubPage: setSegments, openScreenAt: () => {}, intent: pending, clearIntent: () => setPending(null) }}
    >
      {children}
    </NavigationProvider>
  );
}

const warehouses: WarehouseDTO[] = [{ id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null }];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pi-1",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-20",
    dueDate: "2026-09-04",
    supplierInvoiceNumber: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    receiptId: null,
    projectId: null,
    lines: [{ itemId: "item-cement", description: null, kind: "inventory", qty: "20.000000", unitCost: "85.000000", taxRatePercent: 14, taxRateId: null, batchNo: null, expiryDate: null }],
    status: "confirmed",
    subtotal: "1700.000000",
    tax: "238.000000",
    total: "1938.000000",
    amountPaid: "0.000000",
    remainingBalance: "1938.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

function landedCost(overrides: Partial<LandedCostDocumentDTO> = {}): LandedCostDocumentDTO {
  return {
    id: "lc-1",
    docType: "LANDED_COST",
    docNo: "LC-000001",
    date: "2026-08-21",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", sourceInvoiceId: "pi-1", sourceInvoiceNumber: "PI-000001",
        qty: "20.000000", unitCost: "85.000000", weight: "0.000000", allocatedAmount: "200.000000", newUnitCost: "95.000000",
        distributionMethod: "BY_VALUE", costItems: [{ costType: "SHIPPING", description: "شحن", amount: "200.000000" }],
      },
    ],
    createdAt: "2026-08-21T09:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function baseHandlers(docs: LandedCostDocumentDTO[]) {
  return {
    "GET /purchases/invoices": () => ({ body: [purchaseInvoice()] }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /landed-costs": () => ({ body: docs }),
    "GET /projects": () => ({ body: [] }),
  };
}

describe("LandedCostsScreen", () => {
  it("shows the empty state when there are no landed cost documents", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "التكاليف الإضافية" })).toBeInTheDocument();
    expect(await screen.findByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات")).toBeInTheDocument();
  });

  it("lists landed cost documents from the real API", async () => {
    const transport = stubTransport(baseHandlers([landedCost()]));
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("LC-000001")).toBeInTheDocument();
    // "حسب القيمة" also labels an option in the (always-mounted, closed) create panel's select, so assert presence via getAllByText rather than a single unique match.
    expect((await screen.findAllByText("حسب القيمة")).length).toBeGreaterThan(0);
  });

  it("creates a draft landed-cost document against a confirmed purchase invoice, with a live allocation preview", async () => {
    let current: LandedCostDocumentDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /landed-costs": () => ({ body: current }),
      "POST /landed-costs": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = landedCost({ id: body.id, docNo: null, status: "draft" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات");
    fireEvent.click(screen.getAllByRole("button", { name: "مستند تكلفة جديد" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });
    expect(within(dialog).getByText("المبلغ")).toBeInTheDocument();
    // The cost-line "المبلغ" number field is the first spinbutton in the panel (its <label> isn't
    // programmatically linked to the input, so getByLabelText can't find it — see final report).
    const amountInput = within(dialog).getAllByRole("spinbutton")[0];
    fireEvent.change(amountInput!, { target: { value: "200" } });
    expect(await within(dialog).findByText("معاينة التوزيع")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(screen.queryByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات")).not.toBeInTheDocument());
  });

  it("searches confirmed invoices on the server and names stock lines by id, never downloading every invoice or item", async () => {
    const invoicePaths: string[] = [];
    const itemPaths: string[] = [];
    const transport = stubTransport({
      ...baseHandlers([landedCost()]),
      "GET /purchases/invoices": (_init, path) => {
        invoicePaths.push(path);
        return { body: [purchaseInvoice()] };
      },
      "GET /items": (_init, path) => {
        itemPaths.push(path);
        return { body: items };
      },
    });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("LC-000001");
    fireEvent.click(screen.getAllByRole("button", { name: "مستند تكلفة جديد" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });
    await waitFor(() => expect(within(dialog).getByLabelText("الفاتورة المرتبطة *")).toHaveValue("PI-000001"));
    const picker = within(dialog).getByLabelText("الفاتورة المرتبطة *");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "PI-0000" } });
    await waitFor(() => expect(invoicePaths.some((path) => path.includes("search=PI-0000") && path.includes("status=confirmed"))).toBe(true));
    expect(invoicePaths.filter((path) => path.includes("pageSize=200"))).toEqual([]);
    expect(itemPaths.length).toBeGreaterThan(0);
    expect(itemPaths.filter((path) => !path.includes("ids="))).toEqual([]);
  });

  it("arriving from an invoice's row menu selects THAT invoice and its first stock line even when it is not among the first matches", async () => {
    const other = purchaseInvoice({ id: "pi-9", number: "PI-000900" });
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /purchases/invoices/*": () => ({ body: other }),
    });
    renderWithProviders(
      <NavigationWithIntent intent={{ kind: "create", prefill: { invoiceId: "pi-9" } }}>
        <LandedCostsScreen />
      </NavigationWithIntent>,
      { transport, initialSession: testAdminSession },
    );
    const dialog = await screen.findByRole("dialog", { name: "مستند تكلفة إضافية جديد" });
    await waitFor(() => expect(within(dialog).getByLabelText("الفاتورة المرتبطة *")).toHaveValue("PI-000900"));
  });

  it("opens the document already saved, with a notice, when its id was used with other contents", async () => {
    let current: LandedCostDocumentDTO[] = [];
    const sentIds: string[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /landed-costs": () => ({ body: current }),
      "POST /landed-costs": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        sentIds.push(body.id);
        current = [landedCost({ id: body.id, docNo: null, status: "draft" })];
        return { status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة" } };
      },
    });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات");
    fireEvent.click(screen.getAllByRole("button", { name: "مستند تكلفة جديد" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });
    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "200" } });
    await within(dialog).findByText("معاينة التوزيع");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("status")).toHaveTextContent("سبق حفظ هذا المستند، ففُتح المستند المحفوظ بدل إنشاء آخر");
    expect(screen.queryByRole("dialog", { name: "مستند تكلفة إضافية جديد" })).not.toBeInTheDocument();
    expect(sentIds).toHaveLength(1);
  });

  it("confirms a draft, then takes the confirmed document back by reversing it — a confirmed landed cost is never cancelled", async () => {
    let current: LandedCostDocumentDTO[] = [landedCost()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /landed-costs": () => ({ body: current }),
      "POST /landed-costs/lc-1/confirm": () => {
        current = current.map((d) => (d.id === "lc-1" ? { ...d, status: "confirmed" as const, confirmedAt: "2026-08-21T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /landed-costs/lc-1/reverse": () => {
        current = current.map((d) => (d.id === "lc-1" ? { ...d, status: "reversed" as const, reversedByDocId: "lc-1-rev" } : d));
        return { status: 201, body: { original: current[0], reversal: { ...current[0], id: "lc-1-rev", reversesDocId: "lc-1" } } };
      },
    });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("LC-000001"));
    const dialog = screen.getByRole("dialog", { name: "LC-000001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد التوزيع" }));
    expect(await within(dialog).findByRole("button", { name: "إلغاء المستند" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء المستند" }));
    const confirmation = await screen.findByText(/سيُعكس مستند التكلفة الإضافية LC-000001/);
    expect(confirmation).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "إلغاء المستند" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await within(dialog).findByText("معكوس");
  });
});

const VOID_LABEL = "إلغاء المستند";
const rowMenuOf = (docNo: string) => new RegExp(`^(?!.*(عُكس|يعكس)).*${docNo}`);

describe("LandedCostsScreen — a reversed landed cost and its reversal point at each other", () => {
  it("names the other document by its number on both rows and opens it from the link", async () => {
    const original = landedCost({ id: "lc-1", docNo: "LC-000001", status: "reversed", reversedByDocId: "lc-1-rev" });
    const mirror = landedCost({ id: "lc-1-rev", docNo: "LC-000002", status: "confirmed", reversesDocId: "lc-1" });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport: stubTransport(baseHandlers([original, mirror])), initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "عُكس بالمستند LC-000002" }));
    const panel = await screen.findByRole("dialog", { name: "LC-000002" });
    fireEvent.click(within(panel).getByRole("button", { name: "يعكس المستند LC-000001" }));
    const back = await screen.findByRole("dialog", { name: "LC-000001" });
    expect(within(back).getByRole("button", { name: "عُكس بالمستند LC-000002" })).toBeInTheDocument();
  });

  it("offers no reversal on the document that is itself a reversal — neither in its row menu nor on its panel", async () => {
    const original = landedCost({ id: "lc-1", docNo: "LC-000001", status: "reversed", reversedByDocId: "lc-1-rev" });
    const mirror = landedCost({ id: "lc-1-rev", docNo: "LC-000002", status: "confirmed", reversesDocId: "lc-1" });
    const live = landedCost({ id: "lc-2", docNo: "LC-000003", status: "confirmed" });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport: stubTransport(baseHandlers([original, mirror, live])), initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: rowMenuOf("LC-000003") }));
    expect(await screen.findByRole("menuitem", { name: VOID_LABEL })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: rowMenuOf("LC-000002") }));
    await screen.findByRole("menuitem", { name: "عرض" });
    expect(screen.queryByRole("menuitem", { name: VOID_LABEL })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "عُكس بالمستند LC-000002" }));
    const panel = await screen.findByRole("dialog", { name: "LC-000002" });
    expect(within(panel).queryByRole("button", { name: VOID_LABEL })).not.toBeInTheDocument();
  });
});

describe("LandedCostsScreen — a held document whose approval no longer stands", () => {
  it("says why in Arabic and asks for approval again through the document's own confirm", async () => {
    let standing = "reapproval_required";
    let confirms = 0;
    const held = landedCost({ id: "held-1", docNo: "HELD-0001", status: "pending", workflowRequestId: "held-1:confirm" });
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /landed-costs": () => ({ body: [held] }),
      "GET /workflow/requests/*/standing": () => ({ body: { id: "held-1:confirm", status: standing, reason: standing === "reapproval_required" ? "الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد." : null, reasonEn: null } }),
      "POST /landed-costs/held-1/confirm": () => {
        confirms += 1;
        standing = "pending";
        return { body: held };
      },
    });
    renderWithProviders(<TestNavigation><LandedCostsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("HELD-0001"));
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent("الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد.");
    fireEvent.click(within(notice).getByRole("button", { name: "طلب الموافقة من جديد" }));
    await waitFor(() => expect(confirms).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
  });
});
