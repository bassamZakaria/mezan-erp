// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { WorkOrdersScreen } from "./WorkOrdersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";
import type { BomRecord, WorkOrderActivity, WorkOrderRecord } from "../data/hooks";

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
async function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = await within(container).findByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/** The Select combobox commits on mousedown, not change (packages/ui's Select) — open it, then commit the matching option. */
function chooseSelectOption(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

/**
 * WorkOrdersScreen's «قوائم المواد» button routes through the shell's
 * `useNavigation` (navigation.tsx), which no-ops outside a real
 * `NavigationProvider`. This stands in for the shell with an in-memory
 * `navigate` spy so a test can prove the click actually asks to go to BOMs.
 */
function TestNavigation({ children, onNavigate }: { children: ReactNode; onNavigate: (screen: string) => void }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: (screen) => onNavigate(screen),
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

const items: ItemDTO[] = [
  {
    id: "item-table",
    code: "ITM-2",
    nameAr: "طاولة خشبية",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 0,
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
  },
];

const warehouses: WarehouseDTO[] = [
  { id: "wh-raw", code: "RAW-WH", name: "مستودع الخامات", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: false, active: true, projectId: null, custodianUserId: null },
  { id: "wh-fg", code: "FG-WH", name: "مستودع المنتجات التامة", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: false, active: true, projectId: null, custodianUserId: null },
];

const boms: BomRecord[] = [
  {
    id: "bom-1",
    number: "BOM-0001",
    productItemId: "item-table",
    version: 1,
    standardQty: "1",
    unit: "PCS",
    laborCost: "50",
    overheadCost: "30",
    versionNotes: null,
    lines: [{ itemId: "item-table", qty: "1", wastePercent: 0, optional: false, notes: null }],
    status: "active",
    custom: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-01T08:00:00.000Z",
  },
];

function workOrder(overrides: Partial<WorkOrderRecord> = {}): WorkOrderRecord {
  return {
    id: "wo-1",
    number: "WO-0001",
    bomId: "bom-1",
    bomVersion: 1,
    productItemId: "item-table",
    plannedQty: "10",
    producedQty: "0",
    sourceWarehouseId: "wh-raw",
    wipWarehouseId: "wh-wip",
    destinationWarehouseId: "wh-fg",
    priority: "normal",
    scheduledStartDate: "2026-08-10",
    scheduledEndDate: "2026-08-28",
    notes: null,
    status: "planned",
    stage: "not_started",
    materials: [
      { itemId: "item-table", requiredQty: "40", wastePercent: 5, optional: false, issuedQty: "0", returnedQty: "0", netQty: "0", availableQty: null, shortageQty: null, wipOnHandQty: null, issuedUnitCost: "0" },
    ],
    materialCost: "0",
    laborCost: "50",
    overheadCost: "30",
    extraCost: "0",
    wipTotal: "0",
    unitCost: "0",
    progress: 0,
    costLog: [],
    wasteLog: [],
    configInstanceId: null,
    glPosted: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-10T08:00:00.000Z",
    startedAt: null,
    issuedAt: null,
    receivedAt: null,
    completedAt: null,
    projectId: null,
    ...overrides,
  };
}

function renderScreen(orders: WorkOrderRecord[] = [workOrder()]) {
  let current = [...orders];
  const transport = stubTransport({
    "GET /manufacturing/work-orders": () => ({ body: current }),
    "GET /manufacturing/boms": () => ({ body: boms }),
    "GET /items": () => ({ body: items }),
    "GET /warehouses": () => ({ body: warehouses }),
    "POST /manufacturing/work-orders/wo-1/start": () => {
      const updated: WorkOrderRecord = { ...current[0]!, status: "in_progress", stage: "started", startedAt: "2026-08-21T09:00:00.000Z" };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<WorkOrdersScreen />, { transport, initialSession: testAdminSession });
}

/**
 * A richer harness for tests that drive the build/shop-floor/create flows:
 * exposes the mutable order list and lets each test wire only the endpoints
 * it needs, on top of the always-required list/BOM/item/warehouse routes.
 */
function renderScreenWithHandlers(
  orders: WorkOrderRecord[],
  extraHandlers: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }>,
  options: { navigation?: { onNavigate: (screen: string) => void } } = {},
) {
  let current = [...orders];
  const transport = stubTransport({
    "GET /manufacturing/work-orders": () => ({ body: current }),
    "GET /manufacturing/boms": () => ({ body: boms }),
    "GET /items": () => ({ body: items }),
    "GET /warehouses": () => ({ body: warehouses }),
    ...extraHandlers,
  });
  const setCurrent = (next: WorkOrderRecord[]) => {
    current = next;
  };
  const ui = options.navigation ? (
    <TestNavigation onNavigate={options.navigation.onNavigate}>
      <WorkOrdersScreen />
    </TestNavigation>
  ) : (
    <WorkOrdersScreen />
  );
  const result = renderWithProviders(ui, { transport, initialSession: testAdminSession });
  return { ...result, setCurrent, getCurrent: () => current };
}

describe("WorkOrdersScreen", () => {
  it("shows an empty state when there are no work orders yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "أوامر التصنيع" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد أوامر تصنيع مطابقة — أنشئ أمراً جديداً")).toBeInTheDocument();
  });

  it("lists work orders from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("WO-0001")).toBeInTheDocument();
    expect(screen.getByText("طاولة خشبية")).toBeInTheDocument();
    expect(screen.getAllByText("مخطط").length).toBeGreaterThan(0);
  });

  it("starts a manufacturing order and then offers ONE build, not three more steps", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "بدء التصنيع" }));

    // QuickBooks' shape: once a started order is In progress, the whole
    // remainder — issue, receive, close — is offered as «تجميع المنتج».
    expect(await screen.findByRole("button", { name: "تجميع المنتج" })).toBeInTheDocument();
    expect(screen.getByText("جارٍ التنفيذ")).toBeInTheDocument();
  });

  it("warns and blocks the build when there isn't enough of a component on hand", async () => {
    renderScreen([
      workOrder({
        status: "in_progress",
        stage: "started",
        startedAt: "2026-08-21T09:00:00.000Z",
        materials: [
          {
            itemId: "item-table",
            requiredQty: "40",
            wastePercent: 5,
            optional: false,
            issuedQty: "0",
            returnedQty: "0",
            netQty: "0",
            availableQty: "10",
            shortageQty: "30",
            wipOnHandQty: null,
            issuedUnitCost: "0",
          },
        ],
      }),
    ]);
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "تجميع المنتج" }));

    expect(await screen.findByText("المكونات غير كافية لتجميع هذه الكمية.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "احفظ التجميع" })).toBeDisabled();
  });
});

describe("WorkOrdersScreen — stage machine offers only the current stage's action", () => {
  it("offers completion directly from product_received — never the build button a second time", async () => {
    let completeCalls = 0;
    const { getCurrent } = renderScreenWithHandlers(
      [
        workOrder({
          status: "in_progress",
          stage: "product_received",
          producedQty: "10",
          startedAt: "2026-08-21T09:00:00.000Z",
          issuedAt: "2026-08-21T09:30:00.000Z",
          receivedAt: "2026-08-22T09:00:00.000Z",
        }),
      ],
      {
        "POST /manufacturing/work-orders/wo-1/complete": (_init, path) => {
          completeCalls += 1;
          const updated: WorkOrderRecord = { ...getCurrent()[0]!, status: "completed", stage: "completed", completedAt: "2026-08-23T09:00:00.000Z" };
          void path;
          return { body: updated };
        },
      },
    );

    fireEvent.click(await screen.findByText("WO-0001"));
    // The stage machine's ONE action for product_received is completion — the
    // build button that owned started/materials_issued must not reappear.
    expect(screen.queryByRole("button", { name: "تجميع المنتج" })).not.toBeInTheDocument();
    const completeButton = screen.getByRole("button", { name: "إقفال الأمر" });
    fireEvent.click(completeButton);

    await waitFor(() => expect(completeCalls).toBe(1));
    // Completion is a direct action here, not a form: the build panel's own
    // quantity field never becomes accessible (SidePanel stays aria-hidden,
    // not unmounted — an accessible-role query proves it never opened).
    expect(screen.queryByRole("spinbutton", { name: "الكمية المطلوب تجميعها" })).not.toBeInTheDocument();
  });

  it("offers no advance action at all once a work order is completed", async () => {
    renderScreen([
      workOrder({
        status: "completed",
        stage: "completed",
        producedQty: "10",
        startedAt: "2026-08-21T09:00:00.000Z",
        issuedAt: "2026-08-21T09:30:00.000Z",
        receivedAt: "2026-08-22T09:00:00.000Z",
        completedAt: "2026-08-23T09:00:00.000Z",
      }),
    ]);
    fireEvent.click(await screen.findByText("WO-0001"));
    expect(screen.queryByRole("button", { name: "تجميع المنتج" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إقفال الأمر" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "بدء التصنيع" })).not.toBeInTheDocument();
    // Only the navigation button remains.
    expect(screen.getByRole("button", { name: "رجوع إلى أوامر التصنيع" })).toBeInTheDocument();
  });

  it("does not offer a materials-movement action from the row menu when the stage forbids it, but lets the legitimate started-stage advance through", async () => {
    // Two orders: one already completed (no advance offered), one started
    // (build offered). Clicking one row's action must not touch the other.
    const completedOrder = workOrder({
      id: "wo-2",
      number: "WO-0002",
      status: "completed",
      stage: "completed",
      producedQty: "10",
    });
    let startCalls = 0;
    renderScreenWithHandlers([workOrder(), completedOrder], {
      "POST /manufacturing/work-orders/wo-1/start": () => {
        startCalls += 1;
        return { body: { ...workOrder(), status: "in_progress", stage: "started", startedAt: "2026-08-21T09:00:00.000Z" } };
      },
    });

    await screen.findByText("WO-0001");
    // The completed row's overflow menu offers no advance item at all.
    fireEvent.click(screen.getByRole("button", { name: "إجراءات أمر التصنيع WO-0002" }));
    expect(within(screen.getByRole("menu", { name: "إجراءات أمر التصنيع WO-0002" })).queryByRole("menuitem", { name: "إقفال الأمر" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("menu", { name: "إجراءات أمر التصنيع WO-0002" })).getByRole("menuitem", { name: "عرض" })).toBeInTheDocument();

    // The started row's menu DOES offer the advance action, and firing it
    // hits only wo-1's own route.
    fireEvent.click(screen.getByRole("button", { name: "إجراءات أمر التصنيع WO-0001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "بدء التصنيع" }));
    await waitFor(() => expect(startCalls).toBe(1));
    // wo-2 stays completed, on the list, untouched by wo-1's action.
    expect(screen.getByText("WO-0002")).toBeInTheDocument();
  });
});

describe("WorkOrdersScreen — shop floor material movements", () => {
  const startedMaterial: WorkOrderRecord["materials"][number] = {
    itemId: "item-table",
    requiredQty: "40",
    wastePercent: 5,
    optional: false,
    issuedQty: "40",
    returnedQty: "0",
    netQty: "40",
    availableQty: "100",
    shortageQty: null,
    wipOnHandQty: "40",
    issuedUnitCost: "12",
  };

  it("refuses every materials-movement action before a stage that puts material on the floor, but still allows logging a cost", async () => {
    let anyMovementCalled = false;
    renderScreenWithHandlers(
      [workOrder({ status: "planned", stage: "not_started", materials: [startedMaterial] })],
      {
        "POST /manufacturing/work-orders/wo-1/extra-issue": () => {
          anyMovementCalled = true;
          return { body: {} };
        },
        "POST /manufacturing/work-orders/wo-1/return": () => {
          anyMovementCalled = true;
          return { body: {} };
        },
        "POST /manufacturing/work-orders/wo-1/log-waste": () => {
          anyMovementCalled = true;
          return { body: {} };
        },
        "POST /manufacturing/work-orders/wo-1/log-cost": (init) => {
          const body = JSON.parse((init?.body as string) ?? "{}");
          return { body: { ...workOrder(), laborCost: body.amount } };
        },
      },
    );
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("tab", { name: "إجراءات التشغيل" }));

    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: "صرف إضافي" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "إرجاع مكونات" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "تسجيل هالك" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "صرف إضافي" }));
    fireEvent.click(screen.getByRole("button", { name: "إرجاع مكونات" }));
    fireEvent.click(screen.getByRole("button", { name: "تسجيل هالك" }));
    expect(anyMovementCalled).toBe(false);

    // Logging a cost is not gated by stage — a started run's labour still
    // needs to be recordable before any materials have moved.
    fireEvent.change(screen.getByLabelText("المبلغ"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل تكلفة" }));
    await waitFor(() => expect(screen.getByLabelText("المبلغ")).toHaveValue(0));
  });

  it("sends the exact quantities and attribution for extra-issue, return, waste and cost on their own routes", async () => {
    const calls: { route: string; body: unknown }[] = [];
    renderScreenWithHandlers(
      [workOrder({ status: "in_progress", stage: "started", startedAt: "2026-08-21T09:00:00.000Z", materials: [startedMaterial] })],
      {
        "POST /manufacturing/work-orders/wo-1/extra-issue": (init) => {
          calls.push({ route: "extra-issue", body: JSON.parse((init?.body as string) ?? "{}") });
          return { body: workOrder({ status: "in_progress", stage: "started", materials: [startedMaterial] }) };
        },
        "POST /manufacturing/work-orders/wo-1/return": (init) => {
          calls.push({ route: "return", body: JSON.parse((init?.body as string) ?? "{}") });
          return { body: workOrder({ status: "in_progress", stage: "started", materials: [startedMaterial] }) };
        },
        "POST /manufacturing/work-orders/wo-1/log-waste": (init) => {
          calls.push({ route: "log-waste", body: JSON.parse((init?.body as string) ?? "{}") });
          return { body: workOrder({ status: "in_progress", stage: "started", materials: [startedMaterial] }) };
        },
        "POST /manufacturing/work-orders/wo-1/log-cost": (init) => {
          calls.push({ route: "log-cost", body: JSON.parse((init?.body as string) ?? "{}") });
          return { body: workOrder({ status: "in_progress", stage: "started", materials: [startedMaterial] }) };
        },
      },
    );
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("tab", { name: "إجراءات التشغيل" }));

    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "صرف إضافي" }));
    await waitFor(() => expect(calls).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "إرجاع مكونات" }));
    await waitFor(() => expect(calls).toHaveLength(2));

    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل هالك" }));
    await waitFor(() => expect(calls).toHaveLength(3));

    chooseSelectOption("نوع التكلفة", "مصاريف غير مباشرة");
    fireEvent.change(screen.getByLabelText("المبلغ"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل تكلفة" }));
    await waitFor(() => expect(calls).toHaveLength(4));

    expect(calls[0]).toEqual({ route: "extra-issue", body: { stationId: null, operatorId: null, lines: [{ itemId: "item-table", qty: "5" }] } });
    expect(calls[1]).toEqual({ route: "return", body: { stationId: null, operatorId: null, lines: [{ itemId: "item-table", qty: "8" }] } });
    expect(calls[2]).toEqual({ route: "log-waste", body: { stationId: null, operatorId: null, lines: [{ itemId: "item-table", qty: "3" }] } });
    expect(calls[3]).toEqual({ route: "log-cost", body: { kind: "overhead", amount: "250" } });
  });
});

describe("WorkOrdersScreen — build assembly (issue → receive → complete)", () => {
  it("issues, receives and completes in that exact order, with the exact quantity built, and the order reads completed afterward", async () => {
    const calls: { route: string; body: unknown }[] = [];
    const seed = workOrder({ status: "in_progress", stage: "started", plannedQty: "10", startedAt: "2026-08-21T09:00:00.000Z" });
    const { getCurrent, setCurrent } = renderScreenWithHandlers([seed], {
      "POST /manufacturing/work-orders/wo-1/issue": (init) => {
        calls.push({ route: "issue", body: JSON.parse((init?.body as string) ?? "{}") });
        const updated: WorkOrderRecord = { ...getCurrent()[0]!, stage: "materials_issued" };
        setCurrent([updated]);
        return { body: updated };
      },
      "POST /manufacturing/work-orders/wo-1/receive": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        calls.push({ route: "receive", body });
        const updated: WorkOrderRecord = { ...getCurrent()[0]!, stage: "product_received", producedQty: body.producedQty };
        setCurrent([updated]);
        return { body: updated };
      },
      "POST /manufacturing/work-orders/wo-1/complete": () => {
        calls.push({ route: "complete", body: null });
        const updated: WorkOrderRecord = { ...getCurrent()[0]!, stage: "completed", status: "completed" };
        setCurrent([updated]);
        return { body: updated };
      },
    });

    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "تجميع المنتج" }));
    expect(screen.getByLabelText("الكمية المطلوب تجميعها")).toHaveValue(10);
    fireEvent.click(screen.getByRole("button", { name: "احفظ التجميع" }));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((c) => c.route)).toEqual(["issue", "receive", "complete"]);
    expect(calls[0]).toEqual({ route: "issue", body: { stationId: null, operatorId: null } });
    expect(calls[1]).toEqual({ route: "receive", body: { producedQty: "10", stationId: null, operatorId: null } });

    await waitFor(() => expect(screen.queryByRole("button", { name: "تجميع المنتج" })).not.toBeInTheDocument());
    expect(screen.getByText("مكتمل")).toBeInTheDocument();
  });

  it("does not re-issue materials when the build is confirmed from materials_issued — only receive and complete fire", async () => {
    const calls: { route: string; body: unknown }[] = [];
    const seed = workOrder({ status: "in_progress", stage: "materials_issued", plannedQty: "10", startedAt: "2026-08-21T09:00:00.000Z", issuedAt: "2026-08-21T09:30:00.000Z" });
    const { getCurrent, setCurrent } = renderScreenWithHandlers([seed], {
      "POST /manufacturing/work-orders/wo-1/issue": (init) => {
        calls.push({ route: "issue", body: JSON.parse((init?.body as string) ?? "{}") });
        return { body: getCurrent()[0]! };
      },
      "POST /manufacturing/work-orders/wo-1/receive": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        calls.push({ route: "receive", body });
        const updated: WorkOrderRecord = { ...getCurrent()[0]!, stage: "product_received", producedQty: body.producedQty };
        setCurrent([updated]);
        return { body: updated };
      },
      "POST /manufacturing/work-orders/wo-1/complete": () => {
        calls.push({ route: "complete", body: null });
        const updated: WorkOrderRecord = { ...getCurrent()[0]!, stage: "completed", status: "completed" };
        setCurrent([updated]);
        return { body: updated };
      },
    });

    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "تجميع المنتج" }));
    fireEvent.click(screen.getByRole("button", { name: "احفظ التجميع" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.route)).toEqual(["receive", "complete"]);
  });
});

describe("WorkOrdersScreen — activity tabs render the exact figures from the ledger", () => {
  it("shows movements, receipts, journal totals and audit events exactly as the backend reports them", async () => {
    const activity: WorkOrderActivity = {
      movements: [
        {
          id: "mov-1",
          itemId: "item-table",
          warehouseId: "wh-raw",
          direction: "OUT",
          qty: "5.000000",
          unitCost: "12.50",
          occurredAt: "2026-08-21T09:00:00.000Z",
          stationId: null,
          stationName: null,
          operatorId: null,
          operatorName: null,
        },
      ],
      receipts: [
        {
          id: "rcpt-1",
          itemId: "item-table",
          warehouseId: "wh-fg",
          direction: "IN",
          qty: "10.000000",
          unitCost: "80.00",
          occurredAt: "2026-08-22T09:00:00.000Z",
          stationId: null,
          stationName: null,
          operatorId: null,
          operatorName: null,
        },
      ],
      shopFloorLog: [],
      journalEntries: [
        { id: "je-1", entryNo: "JE-0001", date: "2026-08-22", memo: null, status: "posted", totalDebit: "800.00", totalCredit: "800.00" },
      ],
      auditEvents: [{ action: "WORK_ORDER_STARTED", actor: "محمد الشهابي", timestamp: "2026-08-21T09:00:00.000Z", severity: "info" }],
    };
    renderScreenWithHandlers(
      [workOrder({ status: "in_progress", stage: "product_received", producedQty: "10", startedAt: "2026-08-21T09:00:00.000Z" })],
      { "GET /manufacturing/work-orders/wo-1/activity": () => ({ body: activity }) },
    );

    fireEvent.click(await screen.findByText("WO-0001"));

    fireEvent.click(screen.getByRole("tab", { name: "حركات المخزون" }));
    expect(await screen.findByText("صادر")).toBeInTheDocument();
    expect(screen.getByText("12.50")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "استلام الإنتاج" }));
    expect(await screen.findByText("80.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "القيود المحاسبية" }));
    expect(await screen.findByText("JE-0001")).toBeInTheDocument();
    expect(screen.getAllByText("800.00").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("tab", { name: "سجل التدقيق" }));
    expect(await screen.findByText("WORK_ORDER_STARTED")).toBeInTheDocument();
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
  });
});

describe("WorkOrdersScreen — create a new work order", () => {
  it("keeps save disabled until the BOM and every warehouse are chosen, then posts the exact payload", async () => {
    let createdBody: unknown = null;
    const { getCurrent, setCurrent } = renderScreenWithHandlers([], {
      "POST /manufacturing/work-orders": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = workOrder({ id: "wo-new", number: "WO-0002" });
        setCurrent([...getCurrent(), created]);
        return { status: 201, body: created };
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "أمر تصنيع جديد" }));
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع جديد" });
    const save = within(dialog).getByRole("button", { name: "حفظ أمر التصنيع" });
    expect(save).toBeDisabled();

    await pickFromCombobox(dialog, "قائمة المواد *", "BOM-0001 — طاولة خشبية");
    expect(save).toBeDisabled();
    await pickFromCombobox(dialog, "مستودع المكونات (مدخلات) *", "مستودع الخامات");
    expect(save).toBeDisabled();
    await pickFromCombobox(dialog, "مستودع التشغيل *", "مستودع المنتجات التامة");
    expect(save).toBeDisabled();
    await pickFromCombobox(dialog, "مستودع المنتج التام (مخرجات) *", "مستودع المنتجات التامة");
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({
      bomId: "bom-1",
      plannedQty: "1",
      sourceWarehouseId: "wh-raw",
      wipWarehouseId: "wh-fg",
      destinationWarehouseId: "wh-fg",
      priority: "normal",
      scheduledEndDate: null,
      notes: null,
    });
    expect(await screen.findByText("WO-0002")).toBeInTheDocument();
  });
});

describe("WorkOrdersScreen — list error and navigation", () => {
  it("shows a retry banner when the list fails to load, and retry re-fetches the same route", async () => {
    let getCalls = 0;
    let fail = true;
    const transport = stubTransport({
      "GET /manufacturing/work-orders": () => {
        getCalls += 1;
        if (fail) return { status: 500, body: { error: "INTERNAL" } };
        return { body: [workOrder()] };
      },
      "GET /manufacturing/boms": () => ({ body: boms }),
      "GET /items": () => ({ body: items }),
      "GET /warehouses": () => ({ body: warehouses }),
    });
    renderWithProviders(<WorkOrdersScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل أوامر التصنيع. (رمز 500)")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => expect(getCalls).toBe(2));
    expect(await screen.findByText("WO-0001")).toBeInTheDocument();
  });

  it("routes to the BOMs screen through its own button without leaving orders untouched", async () => {
    const navigated: string[] = [];
    renderScreenWithHandlers([workOrder()], {}, { navigation: { onNavigate: (screen) => navigated.push(screen) } });
    fireEvent.click(await screen.findByText("WO-0001"));
    // Back to the list before checking the button lives there too.
    fireEvent.click(screen.getByRole("button", { name: "رجوع إلى أوامر التصنيع" }));
    fireEvent.click(await screen.findByRole("button", { name: "قوائم المواد" }));
    expect(navigated).toEqual(["boms"]);
  });
});

describe("WorkOrdersScreen — a failed stage advance is surfaced, never reported as done", () => {
  it("shows the server's error when بدء التصنيع fails from the detail view, instead of failing silently", async () => {
    renderScreenWithHandlers([workOrder()], {
      "POST /manufacturing/work-orders/wo-1/start": () => ({ status: 409, body: { error: "PERIOD_LOCKED", message: "الفترة مقفلة" } }),
    });
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "بدء التصنيع" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة مقفلة");
    // And the order must still read as not started — no build button appeared.
    expect(screen.queryByRole("button", { name: "تجميع المنتج" })).not.toBeInTheDocument();
  });

  it("reports failure — not a false success — when بدء التصنيع is fired from the row menu and the server refuses it", async () => {
    renderScreenWithHandlers([workOrder()], {
      "POST /manufacturing/work-orders/wo-1/start": () => ({ status: 409, body: { error: "PERIOD_LOCKED", message: "الفترة مقفلة" } }),
    });
    await screen.findByText("WO-0001");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات أمر التصنيع WO-0001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "بدء التصنيع" }));

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("تعذّر تنفيذ");
    expect(screen.queryByRole("status", { name: /تم تنفيذ/ })).not.toBeInTheDocument();
    // The row itself must still read planned — the failed call never landed.
    const row = screen.getByText("WO-0001").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("مخطط")).toBeInTheDocument();
  });
});

describe("WorkOrdersScreen — list controls", () => {
  it("cancels the create panel without posting, sends the chosen priority when it does save, opens the detail from the row menu's «عرض», and asks the backend for only the selected status", async () => {
    let createdBody: Record<string, unknown> | null = null;
    let lastListPath = "";
    let current: WorkOrderRecord[] = [workOrder()];
    const transport = stubTransport({
      "GET /manufacturing/work-orders": (_init, path) => {
        lastListPath = path;
        return { body: current };
      },
      "GET /manufacturing/work-orders/counts": () => ({ body: { all: 3, planned: 2, in_progress: 1, completed: 0, cancelled: 0 } }),
      "GET /manufacturing/boms": () => ({ body: boms }),
      "GET /items": () => ({ body: items }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/work-orders": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = workOrder({ id: "wo-new", number: "WO-0002" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<WorkOrdersScreen />, { transport, initialSession: testAdminSession });

    await screen.findByText("WO-0001");

    // Cancelling the create panel must not reach the API.
    fireEvent.click(screen.getByRole("button", { name: "أمر تصنيع جديد" }));
    let dialog = screen.getByRole("dialog", { name: "أمر تصنيع جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(createdBody).toBeNull();

    // Reopen, fill the form and choose a non-default priority.
    fireEvent.click(screen.getByRole("button", { name: "أمر تصنيع جديد" }));
    dialog = screen.getByRole("dialog", { name: "أمر تصنيع جديد" });
    await pickFromCombobox(dialog, "قائمة المواد *", "BOM-0001 — طاولة خشبية");
    await pickFromCombobox(dialog, "مستودع المكونات (مدخلات) *", "مستودع الخامات");
    await pickFromCombobox(dialog, "مستودع التشغيل *", "مستودع المنتجات التامة");
    await pickFromCombobox(dialog, "مستودع المنتج التام (مخرجات) *", "مستودع المنتجات التامة");
    fireEvent.click(within(dialog).getByRole("combobox", { name: "الأولوية" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "منخفضة" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ أمر التصنيع" }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({ priority: "low" });
    await screen.findByText("WO-0002");

    // «عرض» from the row menu opens the same detail view a row click does.
    fireEvent.click(screen.getByRole("button", { name: "إجراءات أمر التصنيع WO-0001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "عرض" }));
    expect(await screen.findByRole("heading", { name: "أمر تصنيع WO-0001" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "رجوع إلى أوامر التصنيع" }));

    // The status chip narrows the actual request sent to the backend.
    await screen.findByText("WO-0001");
    fireEvent.click(screen.getByRole("tab", { name: /جارٍ التنفيذ/ }));
    await waitFor(() => expect(lastListPath).toContain("status=in_progress"));

    // Rows-per-page is wired straight through to the list's own control.
    fireEvent.click(screen.getByRole("combobox", { name: "صفوف لكل صفحة" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "50" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "صفوف لكل صفحة" })).toHaveTextContent("50"));
  });
});

describe("WorkOrdersScreen — shop floor and build failure paths keep the quantity in the box", () => {
  it("shows the server's error on a failed extra-issue and leaves the quantity for the operator to retry", async () => {
    const material: WorkOrderRecord["materials"][number] = {
      itemId: "item-table",
      requiredQty: "40",
      wastePercent: 5,
      optional: false,
      issuedQty: "40",
      returnedQty: "0",
      netQty: "40",
      availableQty: "100",
      shortageQty: null,
      wipOnHandQty: "40",
      issuedUnitCost: "12",
    };
    renderScreenWithHandlers([workOrder({ status: "in_progress", stage: "started", materials: [material] })], {
      "POST /manufacturing/work-orders/wo-1/extra-issue": () => ({ status: 409, body: { error: "INSUFFICIENT_STOCK", message: "لا يوجد رصيد كافٍ في مستودع الخامات" } }),
    });
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("tab", { name: "إجراءات التشغيل" }));
    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "صرف إضافي" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد رصيد كافٍ في مستودع الخامات");
    // A failed attempt must not clear what the operator typed.
    expect(screen.getByLabelText("الكمية")).toHaveValue(5);
  });

  it("renders each waste-log entry's normal/abnormal cost split, and marks pre-D64 rows as never having moved stock", async () => {
    const order = workOrder({
      status: "in_progress",
      stage: "started",
      wasteLog: [
        {
          itemId: "item-table",
          qty: "3",
          notes: null,
          at: "2026-08-21T10:00:00.000Z",
          stockMoved: true,
          normalQty: "2",
          abnormalQty: "1",
          normalCost: "24.00",
          abnormalCost: "12.00",
        },
        {
          itemId: "item-table",
          qty: "1",
          notes: null,
          at: "2026-08-20T10:00:00.000Z",
          stockMoved: false,
          normalQty: "0",
          abnormalQty: "0",
          normalCost: "0",
          abnormalCost: "0",
        },
      ],
    });
    renderScreen([order]);
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("tab", { name: "إجراءات التشغيل" }));

    expect(await screen.findByText("سُجِّل قبل أن يحرّك الفاقد المخزون — لم تُصرَف كميته")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    const movedRow = items.find((li) => li.textContent?.includes("ضمن نسبة الهالك"));
    expect(movedRow).toBeTruthy();
    expect(movedRow!.textContent).toContain("24.00");
    expect(movedRow!.textContent).toContain("فاقد غير طبيعي");
    expect(movedRow!.textContent).toContain("12.00");
  });

  it("surfaces the server's error when the build's final confirm step fails, and keeps the panel open so nothing silently vanishes", async () => {
    const seed = workOrder({ status: "in_progress", stage: "started", plannedQty: "10", startedAt: "2026-08-21T09:00:00.000Z" });
    renderScreenWithHandlers([seed], {
      "POST /manufacturing/work-orders/wo-1/issue": () => ({ body: seed }),
      "POST /manufacturing/work-orders/wo-1/receive": () => ({ body: { ...seed, stage: "product_received", producedQty: "10" } }),
      "POST /manufacturing/work-orders/wo-1/complete": () => ({ status: 409, body: { error: "PERIOD_LOCKED", message: "لا يمكن إقفال الأمر — الفترة المحاسبية مقفلة" } }),
    });
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "تجميع المنتج" }));
    fireEvent.click(screen.getByRole("button", { name: "احفظ التجميع" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن إقفال الأمر — الفترة المحاسبية مقفلة");
    // The panel must stay open — a silently closed panel reads as success.
    expect(screen.getByRole("button", { name: "احفظ التجميع" })).toBeInTheDocument();
  });

  it("closes the build panel from its own × as well as from cancel, without ever calling the API", async () => {
    let issueCalls = 0;
    renderScreenWithHandlers([workOrder({ status: "in_progress", stage: "started" })], {
      "POST /manufacturing/work-orders/wo-1/issue": () => {
        issueCalls += 1;
        return { body: workOrder({ status: "in_progress", stage: "materials_issued" }) };
      },
    });
    fireEvent.click(await screen.findByText("WO-0001"));
    fireEvent.click(screen.getByRole("button", { name: "تجميع المنتج" }));
    const dialog = screen.getByRole("dialog", { name: "تجميع المنتج" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إغلاق اللوحة" }));
    expect(screen.queryByRole("spinbutton", { name: "الكمية المطلوب تجميعها" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "تجميع المنتج" }));
    const reopened = screen.getByRole("dialog", { name: "تجميع المنتج" });
    fireEvent.click(within(reopened).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("spinbutton", { name: "الكمية المطلوب تجميعها" })).not.toBeInTheDocument();
    expect(issueCalls).toBe(0);
  });
});

describe("WorkOrdersScreen — create-form failure", () => {
  it("shows the server's rejection inline and keeps the panel open so the operator can fix it and retry", async () => {
    renderScreenWithHandlers([], {
      "POST /manufacturing/work-orders": () => ({ status: 422, body: { error: "VALIDATION", message: "الكمية المخططة يجب أن تكون أكبر من صفر" } }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "أمر تصنيع جديد" }));
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع جديد" });
    await pickFromCombobox(dialog, "قائمة المواد *", "BOM-0001 — طاولة خشبية");
    await pickFromCombobox(dialog, "مستودع المكونات (مدخلات) *", "مستودع الخامات");
    await pickFromCombobox(dialog, "مستودع التشغيل *", "مستودع المنتجات التامة");
    await pickFromCombobox(dialog, "مستودع المنتج التام (مخرجات) *", "مستودع المنتجات التامة");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ أمر التصنيع" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الكمية المخططة يجب أن تكون أكبر من صفر");
    expect(within(dialog).getByRole("button", { name: "حفظ أمر التصنيع" })).toBeInTheDocument();
  });
});
