// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ReorderProblemDTO, ReorderRuleSourceDTO, ReorderTriggerDTO, type CreateReorderOrdersResultDTO, type ReorderRowDTO } from "@mezan/contracts";
import { ReorderScreen } from "./ReorderScreen";
import { TestNavigation, renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

afterEach(cleanup);

function row(over: Partial<ReorderRowDTO> = {}): ReorderRowDTO {
  return {
    key: "i1:w1",
    itemId: "i1",
    itemCode: "ITM-1",
    itemNameAr: "زيت عباد الشمس",
    itemNameEn: null,
    warehouseId: "w1",
    warehouseName: "المخزن الرئيسي",
    source: ReorderRuleSourceDTO.ItemDefault,
    trigger: ReorderTriggerDTO.BelowMinimum,
    minQty: "10.000000",
    maxQty: "50.000000",
    leadDays: 0,
    packQty: "1.000000",
    onHand: "4.000000",
    reserved: "0.000000",
    onOrder: "0.000000",
    onOrderDraft: "0.000000",
    position: "4.000000",
    soldInWindow: "60.000000",
    dailyVelocity: "2.000000",
    daysOfCover: 2,
    suggestedQty: "46.000000",
    supplierId: "s1",
    supplierName: "مورد الزيوت",
    unitPrice: "10.000000",
    problems: [],
    ...over,
  };
}

const CREATED: CreateReorderOrdersResultDTO = {
  created: [{ orderId: "po-1", number: "PO-000001", supplierId: "s1", supplierName: "مورد الزيوت", warehouseId: "w1", warehouseName: "المخزن الرئيسي", lineCount: 1, total: "460.000000", expectedDeliveryDate: null }],
  needsSupplier: [],
  skipped: [],
};

function renderScreen(options: { rows?: ReorderRowDTO[]; permissions?: string[] } = {}) {
  const posted: Record<string, unknown>[] = [];
  const transport = stubTransport({
    "GET /reorder/worklist": () => ({ body: { asOfDate: "2026-10-17", windowDays: 30, rows: options.rows ?? [row()], needsSupplierCount: 0 } }),
    "GET /reorder/policies": () => ({ body: [] }),
    "GET /warehouses": () => ({ body: [{ id: "w1", name: "المخزن الرئيسي" }] }),
    "GET /suppliers": () => ({ body: [{ id: "s1", nameAr: "مورد الزيوت" }] }),
    "POST /reorder/orders": (init) => {
      posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { status: 201, body: CREATED };
    },
  });
  const session = options.permissions ? { ...testAdminSession, isCompanyAdmin: false, permissions: options.permissions } : testAdminSession;
  renderWithProviders(
    <TestNavigation initialSegments={[]}>
      <ReorderScreen />
    </TestNavigation>,
    { transport, initialSession: session },
  );
  return posted;
}

describe("ReorderScreen", () => {
  it("refuses a caller who cannot view reorder", async () => {
    renderScreen({ permissions: ["inventory.stock.view"] });
    expect(await screen.findByText("لا تملك صلاحية عرض إعادة الطلب")).toBeInTheDocument();
  });

  it("shows the ranked item with its cover, reason and suggested quantity", async () => {
    renderScreen();
    expect(await screen.findByText("زيت عباد الشمس")).toBeInTheDocument();
    expect(screen.getByText("تحت الحد الأدنى")).toBeInTheDocument();
    expect(screen.getByLabelText("كمية الطلب لـ زيت عباد الشمس")).toHaveValue("46");
  });

  it("keeps the create button off until a line is selected, then posts the chosen quantity", async () => {
    const posted = renderScreen();
    const create = await screen.findByRole("button", { name: "إنشاء أوامر شراء مسودة" });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByLabelText("تحديد زيت عباد الشمس في المخزن الرئيسي"));
    const qty = screen.getByLabelText("كمية الطلب لـ زيت عباد الشمس");
    fireEvent.focus(qty);
    fireEvent.change(qty, { target: { value: "48" } });
    fireEvent.blur(qty);
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ windowDays: 30, lines: [{ itemId: "i1", warehouseId: "w1", qty: "48", supplierId: "s1" }] });
    expect(await screen.findByText("أُنشئ 1 أمر شراء مسودة")).toBeInTheDocument();
  });

  it("flags a line with no supplier and still lets one be chosen", async () => {
    renderScreen({ rows: [row({ supplierId: null, supplierName: null, problems: [ReorderProblemDTO.NoSupplier] })] });
    expect(await screen.findByText("لا يوجد مورد")).toBeInTheDocument();
  });

  it("explains why creating orders is unavailable without the purchasing permission", async () => {
    renderScreen({ permissions: ["inventory.reorder.view", "inventory.reorder.create", "inventory.stock.view"] });
    expect(await screen.findByText(/إنشاء أوامر الشراء يحتاج صلاحيتي/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إنشاء أوامر شراء مسودة" })).toBeDisabled();
  });
});
