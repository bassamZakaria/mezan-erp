// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { VanTripDTO, WarehouseDTO, TreasuryAccountDTO, BranchDTO, ItemDTO, VanDTO, EmployeeDTO } from "@mezan/contracts";
import { VanTripsScreen } from "./VanTripsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** QtyInput mirrors MoneyInput's commit-on-blur behaviour. */
function typeQty(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const warehouses: WarehouseDTO[] = [
  { id: "wh-van1", code: "VAN-01", name: "مخزن ڤان القاهرة", nameEn: null, branchId: "b1", type: "VAN", isDefault: false, active: true },
  { id: "wh-main1", code: "MAIN-01", name: "المخزن الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true },
];

const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "ta-van1", code: "CASH-VAN1", name: "خزينة الڤان", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, status: "active" },
  { id: "ta-main1", code: "CASH-001", name: "الصندوق الرئيسي", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, status: "active" },
];

const branches: BranchDTO[] = [
  { id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const vans: VanDTO[] = [
  { id: "van-1", code: "VAN-1", nameAr: "ڤان القاهرة", nameEn: null, plateNumber: "س ب ل 123", branchId: "b1", warehouseId: "wh-van1", treasuryAccountId: "ta-van1", active: true },
  { id: "van-2", code: "VAN-2", nameAr: "ڤان الجيزة", nameEn: null, plateNumber: null, branchId: "b1", warehouseId: "wh-main1", treasuryAccountId: "ta-main1", active: true },
];

function employeeFixture(overrides: Partial<EmployeeDTO> = {}): EmployeeDTO {
  return {
    id: "emp-9",
    code: "EMP-0009",
    firstName: "Ahmed",
    lastName: "Nabil",
    firstNameAr: "أحمد",
    lastNameAr: "نبيل",
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    departmentId: null,
    jobTitleId: null,
    managerId: null,
    branchId: "b1",
    hireDate: "2026-01-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const employees: EmployeeDTO[] = [
  employeeFixture(),
  employeeFixture({ id: "emp-10", code: "EMP-0010", firstName: "Sara", lastName: "Fouad", firstNameAr: "سارة", lastNameAr: "فؤاد" }),
];

function itemFixture(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "ITM-001",
    nameAr: "عصير برتقال",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    seasonId: null,
    description: null,
    defaultSupplierId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: "10.000000",
    costPrice: "6.000000",
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
    ...overrides,
  };
}

const items: ItemDTO[] = [
  itemFixture(),
  itemFixture({ id: "item-2", code: "ITM-002", nameAr: "لبن كامل الدسم" }),
];

function tripFixture(overrides: Partial<VanTripDTO> = {}): VanTripDTO {
  return {
    id: "vt-1",
    tripNo: "VT-000001",
    date: "2026-08-20",
    branchId: "b1",
    vanId: "van-1",
    vanWarehouseId: "wh-van1",
    vanTreasuryAccountId: "ta-van1",
    sourceWarehouseId: "wh-main1",
    sourceTreasuryAccountId: "ta-main1",
    openingCashFloat: "500.000000",
    crew: [{ employeeId: "emp-9", role: "driver" }],
    loadedStock: [{ itemId: "item-1", qty: "20.000000" }],
    cashMovements: [{ id: "cm-1", kind: "sale", amount: "150.000000", occurredAt: "2026-08-20T10:00:00.000Z", notes: null }],
    status: "ongoing",
    openedAt: "2026-08-20T08:00:00.000Z",
    settledAt: null,
    settlement: null,
    notes: null,
    ...overrides,
  };
}

function baseHandlers(trips: VanTripDTO[] | (() => VanTripDTO[])) {
  return {
    "GET /field/van-trips": () => ({ body: typeof trips === "function" ? trips() : trips }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /branches": () => ({ body: branches }),
    "GET /items": () => ({ body: items }),
    "GET /field/vans": () => ({ body: vans }),
    "GET /hr/employees": () => ({ body: employees }),
  };
}

function openDialog(): HTMLElement {
  const dialog = screen.getByRole("dialog", { name: "فتح رحلة" });
  return dialog;
}

function chooseIn(dialog: HTMLElement, labelText: string, optionName: RegExp) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: labelText }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionName }));
}

describe("VanTripsScreen — the open-trip form's validation", () => {
  it("walks through every validateDraft refusal, in order, before a trip can really be opened", async () => {
    let created: VanTripDTO | null = null;
    const transport = stubTransport({
      ...baseHandlers(() => (created ? [created] : [])),
      "POST /field/van-trips": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const van = vans.find((v) => v.id === body.vanId)!;
        created = {
          id: body.id,
          tripNo: "VT-000010",
          date: body.date,
          branchId: van.branchId,
          vanId: body.vanId,
          vanWarehouseId: van.warehouseId,
          vanTreasuryAccountId: van.treasuryAccountId,
          sourceWarehouseId: body.sourceWarehouseId,
          sourceTreasuryAccountId: body.sourceTreasuryAccountId,
          openingCashFloat: body.openingCashFloat,
          crew: body.crew,
          loadedStock: body.loadedStock ?? [],
          cashMovements: [],
          status: "ongoing",
          openedAt: new Date().toISOString(),
          settledAt: null,
          settlement: null,
          notes: body.notes ?? null,
        };
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "فتح رحلة" }));
    const dialog = openDialog();
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: "فتح رحلة" }));
    const dateInput = within(dialog).getByLabelText("التاريخ *");

    fireEvent.change(dateInput, { target: { value: "" } });
    submit();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("التاريخ مطلوب.");

    fireEvent.change(dateInput, { target: { value: "2026-08-25" } });
    submit();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الڤان مطلوب.");

    chooseIn(dialog, "الڤان *", /^ڤان القاهرة/);
    submit();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("مستودع التحميل مطلوب.");

    // wh-main1 is not van-1's own warehouse, so it is a legal loading warehouse for van-1.
    chooseIn(dialog, "مستودع التحميل *", /^المخزن الرئيسي/);
    // van-2's OWN warehouse is wh-main1 — switching to it turns the already-chosen
    // loading warehouse into the van's own warehouse without touching that field.
    chooseIn(dialog, "الڤان *", /^ڤان الجيزة/);
    submit();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("لا يمكن أن يكون مستودع التحميل هو نفس الڤان.");

    chooseIn(dialog, "الڤان *", /^ڤان القاهرة/);
    submit();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("خزينة المصدر مطلوبة.");

    chooseIn(dialog, "خزينة المصدر *", /^الصندوق الرئيسي/);
    submit();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("لا بد من إضافة عضو واحد على الأقل للطاقم.");

    const crewSection = within(dialog).getByText("الطاقم *").closest("div")!;
    chooseIn(dialog, "اختر موظفاً", /^أحمد نبيل/);
    fireEvent.click(within(crewSection).getByRole("button", { name: "إضافة" }));
    submit();

    expect(await screen.findByText("VT-000010")).toBeInTheDocument();
  });

  it("shows the server's own refusal and keeps the open-trip dialog open when the API rejects it", async () => {
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /field/van-trips": () => ({ status: 500, body: { message: "الفرع مغلق مؤقتاً." } }),
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "فتح رحلة" }));
    const dialog = openDialog();
    chooseIn(dialog, "الڤان *", /^ڤان القاهرة/);
    chooseIn(dialog, "مستودع التحميل *", /^المخزن الرئيسي/);
    chooseIn(dialog, "خزينة المصدر *", /^الصندوق الرئيسي/);
    const crewSection = within(dialog).getByText("الطاقم *").closest("div")!;
    chooseIn(dialog, "اختر موظفاً", /^أحمد نبيل/);
    fireEvent.click(within(crewSection).getByRole("button", { name: "إضافة" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "فتح رحلة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الفرع مغلق مؤقتاً.");
    expect(screen.getByRole("dialog", { name: "فتح رحلة" })).toBeInTheDocument();
  });
});

describe("VanTripsScreen — crew and loaded stock in the open-trip form", () => {
  it("adds and removes crew members and loaded stock, fills notes and clears the opening float to zero", async () => {
    let createdBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /field/van-trips": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        createdBody = body;
        const van = vans.find((v) => v.id === body.vanId)!;
        const dto: VanTripDTO = {
          id: body.id as string,
          tripNo: "VT-000020",
          date: body.date as string,
          branchId: van.branchId,
          vanId: body.vanId as string,
          vanWarehouseId: van.warehouseId,
          vanTreasuryAccountId: van.treasuryAccountId,
          sourceWarehouseId: body.sourceWarehouseId as string,
          sourceTreasuryAccountId: body.sourceTreasuryAccountId as string,
          openingCashFloat: body.openingCashFloat as string,
          crew: body.crew as VanTripDTO["crew"],
          loadedStock: (body.loadedStock as VanTripDTO["loadedStock"]) ?? [],
          cashMovements: [],
          status: "ongoing",
          openedAt: new Date().toISOString(),
          settledAt: null,
          settlement: null,
          notes: (body.notes as string | null) ?? null,
        };
        return { status: 201, body: dto };
      },
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "فتح رحلة" }));
    const dialog = openDialog();
    chooseIn(dialog, "الڤان *", /^ڤان القاهرة/);
    chooseIn(dialog, "مستودع التحميل *", /^المخزن الرئيسي/);
    chooseIn(dialog, "خزينة المصدر *", /^الصندوق الرئيسي/);

    const crewSection = within(dialog).getByText("الطاقم *").closest("div")!;
    chooseIn(dialog, "اختر موظفاً", /^أحمد نبيل/);
    fireEvent.click(within(crewSection).getByRole("button", { name: "إضافة" }));
    chooseIn(dialog, "اختر موظفاً", /^سارة فؤاد/);
    fireEvent.click(within(crewSection).getByRole("button", { name: "إضافة" }));
    expect(within(crewSection).getByText(/أحمد نبيل/)).toBeInTheDocument();
    expect(within(crewSection).getByText(/سارة فؤاد/)).toBeInTheDocument();
    fireEvent.click(within(crewSection).getAllByRole("button", { name: "إزالة" })[0]!);
    expect(within(crewSection).queryByText(/أحمد نبيل/)).not.toBeInTheDocument();
    expect(within(crewSection).getByText(/سارة فؤاد/)).toBeInTheDocument();

    const stockSection = within(dialog).getByText("تحميل مخزون (اختياري)").closest("div")!;
    chooseIn(dialog, "اختر صنفاً", /^عصير برتقال/);
    typeQty(within(stockSection).getByLabelText("الكمية"), "5");
    fireEvent.click(within(stockSection).getByRole("button", { name: "إضافة" }));
    chooseIn(dialog, "اختر صنفاً", /^لبن كامل الدسم/);
    typeQty(within(stockSection).getByLabelText("الكمية"), "2");
    fireEvent.click(within(stockSection).getByRole("button", { name: "إضافة" }));
    fireEvent.click(within(stockSection).getAllByRole("button", { name: "إزالة" })[0]!);
    expect(within(stockSection).queryByText(/عصير برتقال/)).not.toBeInTheDocument();
    expect(within(stockSection).getByText(/لبن كامل الدسم/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("ملاحظات"), { target: { value: "ملاحظة تجريبية" } });

    const openingCashInput = within(dialog).getByLabelText("النقدية الافتتاحية");
    fireEvent.change(openingCashInput, { target: { value: "" } });
    fireEvent.blur(openingCashInput);

    fireEvent.click(within(dialog).getByRole("button", { name: "فتح رحلة" }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody!.crew).toEqual([{ employeeId: "emp-10", role: "driver" }]);
    expect(createdBody!.loadedStock).toEqual([{ itemId: "item-2", qty: "2.000000" }]);
    expect(createdBody!.notes).toBe("ملاحظة تجريبية");
    expect(createdBody!.openingCashFloat).toBe("0.000000");
  });
});

describe("VanTripsScreen — falling back to a raw id", () => {
  it("shows the raw id for a van, warehouse, branch and till that are no longer in their registries, and the empty states for stock and cash", async () => {
    const ghostTrip = tripFixture({
      id: "vt-ghost1",
      tripNo: null,
      branchId: "b-ghost",
      vanId: null,
      vanWarehouseId: "wh-ghost",
      vanTreasuryAccountId: "ta-ghost",
      crew: [],
      loadedStock: [],
      cashMovements: [],
      status: "cancelled",
    });
    const transport = stubTransport(baseHandlers([ghostTrip]));
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    const row = (await screen.findByText("vt-ghost1")).closest("tr")!;
    expect(within(row).getByText("b-ghost")).toBeInTheDocument();
    expect(within(row).getAllByText("wh-ghost").length).toBeGreaterThan(0);

    fireEvent.click(within(row).getByText("vt-ghost1"));
    const detail = screen.getByRole("dialog", { name: "رحلة vt-ghost1" });
    expect(within(detail).getByText("ta-ghost")).toBeInTheDocument();
    expect(within(detail).getByText("لا يوجد مخزون محمّل.")).toBeInTheDocument();
    expect(within(detail).getByText("لا توجد حركات نقدية بعد.")).toBeInTheDocument();
  });

  it("shows the raw item id and van id when they are missing, and a neutral (break-even) settlement", async () => {
    const ghostTrip = tripFixture({
      id: "vt-ghost2",
      tripNo: "VT-000099",
      vanId: "van-ghost",
      crew: [],
      loadedStock: [{ itemId: "item-ghost", qty: "3.000000" }],
      cashMovements: [{ id: "cm-g1", kind: "collection", amount: "40.000000", occurredAt: "2026-08-21T09:00:00.000Z", notes: null }],
      status: "settled",
      settledAt: "2026-08-21T12:00:00.000Z",
      settlement: {
        expectedCash: "40.000000",
        countedCash: "40.000000",
        cashVariance: "0.000000",
        stockCounts: [{ itemId: "item-ghost", expectedQty: "3.000000", countedQty: "3.000000", varianceQty: "0.000000" }],
        settledAt: "2026-08-21T12:00:00.000Z",
      },
    });
    const transport = stubTransport(baseHandlers([ghostTrip]));
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    const row = (await screen.findByText("VT-000099")).closest("tr")!;
    expect(within(row).getByText("van-ghost")).toBeInTheDocument();

    fireEvent.click(within(row).getByText("VT-000099"));
    const detail = screen.getByRole("dialog", { name: "رحلة VT-000099" });
    expect(within(detail).getAllByText("item-ghost").length).toBeGreaterThan(0);

    const settlementSection = within(detail).getByText("التسوية").closest("div")!;
    expect(within(settlementSection).getAllByText("0").length).toBeGreaterThan(0);
  });
});

describe("VanTripsScreen — status filter and trip-number search", () => {
  it("filters the trip list by status tab and by trip number search", async () => {
    const trips = [
      tripFixture({ id: "vt-1", tripNo: "VT-000001", status: "ongoing" }),
      tripFixture({ id: "vt-2", tripNo: "VT-000002", status: "settled", settledAt: "2026-08-21T00:00:00.000Z" }),
      tripFixture({ id: "vt-3", tripNo: "VT-000003", status: "cancelled" }),
    ];
    const transport = stubTransport(baseHandlers(trips));
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    await screen.findByText("VT-000001");

    fireEvent.click(screen.getByRole("radio", { name: "مسواة" }));
    await waitFor(() => expect(screen.queryByText("VT-000001")).not.toBeInTheDocument());
    expect(screen.getByText("VT-000002")).toBeInTheDocument();
    expect(screen.queryByText("VT-000003")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "ملغاة" }));
    await waitFor(() => expect(screen.queryByText("VT-000002")).not.toBeInTheDocument());
    expect(screen.getByText("VT-000003")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "الكل" }));
    await screen.findByText("VT-000001");
    expect(screen.getByText("VT-000002")).toBeInTheDocument();
    expect(screen.getByText("VT-000003")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("ابحث برقم الرحلة..."), { target: { value: "000003" } });
    await waitFor(() => expect(screen.queryByText("VT-000001")).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.queryByText("VT-000002")).not.toBeInTheDocument();
    expect(screen.getByText("VT-000003")).toBeInTheDocument();
  });

  it("searches by the raw id when a trip has no trip number", async () => {
    const trips = [tripFixture({ id: "vt-search-9", tripNo: null, status: "ongoing" })];
    const transport = stubTransport(baseHandlers(trips));
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    await screen.findByText("vt-search-9");
    fireEvent.change(screen.getByPlaceholderText("ابحث برقم الرحلة..."), { target: { value: "search-9" } });
    await waitFor(() => expect(screen.getByText("vt-search-9")).toBeInTheDocument(), { timeout: 2000 });

    fireEvent.change(screen.getByPlaceholderText("ابحث برقم الرحلة..."), { target: { value: "no-such-trip" } });
    await waitFor(() => expect(screen.queryByText("vt-search-9")).not.toBeInTheDocument(), { timeout: 2000 });
  });
});

describe("VanTripsScreen — cash movements", () => {
  it("refuses to record a cash movement with no amount entered", async () => {
    const transport = stubTransport(baseHandlers([tripFixture()]));
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("VT-000001"));
    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    fireEvent.click(within(detail).getByRole("button", { name: "تسجيل الحركة" }));

    expect(await within(detail).findByRole("alert")).toHaveTextContent("المبلغ يجب أن يكون أكبر من صفر.");
  });

  it("records a cash movement with a note attached", async () => {
    let posted: Record<string, unknown> | null = null;
    const transport = stubTransport({
      ...baseHandlers([tripFixture()]),
      "POST /field/van-trips/*/cash-movements": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        posted = body;
        const updated = tripFixture({ cashMovements: [...tripFixture().cashMovements, { id: body.id as string, kind: body.kind as "sale", amount: body.amount as string, occurredAt: body.occurredAt as string, notes: (body.notes as string | null) ?? null }] });
        return { body: updated };
      },
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("VT-000001"));
    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    typeMoney(within(detail).getByLabelText("المبلغ"), "120");
    fireEvent.change(within(detail).getByLabelText("ملاحظات"), { target: { value: "دفعة نقدية من العميل" } });
    fireEvent.click(within(detail).getByRole("button", { name: "تسجيل الحركة" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.notes).toBe("دفعة نقدية من العميل");
    expect(within(detail).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's own refusal when recording a cash movement fails", async () => {
    const transport = stubTransport({
      ...baseHandlers([tripFixture()]),
      "POST /field/van-trips/*/cash-movements": () => ({ status: 500, body: { message: "الرصيد غير كافٍ." } }),
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("VT-000001"));
    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    typeMoney(within(detail).getByLabelText("المبلغ"), "50");
    fireEvent.click(within(detail).getByRole("button", { name: "تسجيل الحركة" }));

    expect(await within(detail).findByRole("alert")).toHaveTextContent("الرصيد غير كافٍ.");
  });
});

describe("VanTripsScreen — settling a trip", () => {
  it("settles a trip from the row menu, leaves the counted cash blank, and shows a shortfall", async () => {
    let posted: Record<string, unknown> | null = null;
    let current: VanTripDTO[] = [tripFixture()];
    const transport = stubTransport({
      ...baseHandlers(() => current),
      "POST /field/van-trips/vt-1/settle": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        posted = body;
        const updated = tripFixture({
          status: "settled",
          settledAt: new Date().toISOString(),
          settlement: {
            expectedCash: "600.000000",
            countedCash: body.countedCash as string,
            cashVariance: "-600.000000",
            stockCounts: (body.stockCounts as Array<{ itemId: string; countedQty: string }>).map((c) => ({
              itemId: c.itemId,
              expectedQty: "20.000000",
              countedQty: c.countedQty,
              varianceQty: (Number(c.countedQty) - 20).toFixed(6),
            })),
            settledAt: new Date().toISOString(),
          },
        });
        current = [updated];
        return { body: updated };
      },
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    await screen.findByText("VT-000001");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات VT-000001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تسوية الرحلة" }));

    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    const countedCashInput = within(detail).getByLabelText("النقدية المعدودة *");
    fireEvent.change(countedCashInput, { target: { value: "" } });
    fireEvent.blur(countedCashInput);
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التسوية" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.countedCash).toBe("0.000000");
    expect(await within(detail).findByText("-600")).toBeInTheDocument();
  });

  it("shows the server's own refusal and keeps the settle form open when settling fails", async () => {
    const transport = stubTransport({
      ...baseHandlers([tripFixture()]),
      "POST /field/van-trips/vt-1/settle": () => ({ status: 500, body: { message: "لا يمكن تسوية رحلة بدون مخزون محمّل." } }),
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("VT-000001"));
    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    fireEvent.click(within(detail).getByRole("button", { name: "تسوية الرحلة" }));
    typeMoney(within(detail).getByLabelText("النقدية المعدودة *"), "500");
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التسوية" }));

    expect(await within(detail).findByRole("alert")).toHaveTextContent("لا يمكن تسوية رحلة بدون مخزون محمّل.");
    expect(within(detail).getByRole("button", { name: "تأكيد التسوية" })).toBeInTheDocument();
  });

  it("settles a trip that had no loaded stock, with no per-item counts to fill in and no variance table afterwards", async () => {
    let posted: Record<string, unknown> | null = null;
    let current: VanTripDTO[] = [tripFixture({ loadedStock: [], cashMovements: [] })];
    const transport = stubTransport({
      ...baseHandlers(() => current),
      "POST /field/van-trips/vt-1/settle": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        posted = body;
        const updated = tripFixture({
          loadedStock: [],
          cashMovements: [],
          status: "settled",
          settledAt: new Date().toISOString(),
          settlement: {
            expectedCash: "500.000000",
            countedCash: body.countedCash as string,
            cashVariance: "0.000000",
            stockCounts: [],
            settledAt: new Date().toISOString(),
          },
        });
        current = [updated];
        return { body: updated };
      },
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("VT-000001"));
    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    fireEvent.click(within(detail).getByRole("button", { name: "تسوية الرحلة" }));
    expect(within(detail).queryByText("جرد المخزون")).not.toBeInTheDocument();
    typeMoney(within(detail).getByLabelText("النقدية المعدودة *"), "500");
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التسوية" }));

    await waitFor(() => expect(posted).not.toBeNull());
    await within(detail).findByText("التسوية");
    expect(within(detail).queryAllByRole("table")).toHaveLength(0);
  });
});

describe("VanTripsScreen — the list failing to load", () => {
  it("shows the load-failed banner and retries the query", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /field/van-trips": () => {
        calls += 1;
        return { status: 500, body: { error: "INTERNAL" } };
      },
      "GET /warehouses": () => ({ body: warehouses }),
      "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
      "GET /branches": () => ({ body: branches }),
      "GET /items": () => ({ body: items }),
      "GET /field/vans": () => ({ body: vans }),
      "GET /hr/employees": () => ({ body: employees }),
    });
    renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل رحلات المندوبين.")).toBeInTheDocument();
    const callsBefore = calls;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(calls).toBeGreaterThan(callsBefore));
  });
});
