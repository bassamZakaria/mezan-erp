// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { VanTripDTO, WarehouseDTO, TreasuryAccountDTO, BranchDTO, ItemDTO, VanDTO, EmployeeDTO } from "@mezan/contracts";
import { VanTripsScreen } from "./VanTripsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const warehouses: WarehouseDTO[] = [
  { id: "wh-van1", code: "VAN-01", name: "مخزن ڤان القاهرة", nameEn: null, branchId: "b1", type: "VAN", isDefault: false, active: true, projectId: null, custodianUserId: null },
  { id: "wh-main1", code: "MAIN-01", name: "المخزن الرئيسي", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
];

const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "ta-van1", code: "CASH-VAN1", name: "خزينة الڤان", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
  { id: "ta-main1", code: "CASH-001", name: "الصندوق الرئيسي", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: null, openingBalance: "0.000000", openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
];

const branches: BranchDTO[] = [
  { id: "b1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const vans: VanDTO[] = [
  { id: "van-1", code: "VAN-1", nameAr: "ڤان القاهرة", nameEn: null, plateNumber: "س ب ل 123", branchId: "b1", warehouseId: "wh-van1", treasuryAccountId: "ta-van1", active: true },
];

const employees: EmployeeDTO[] = [
  {
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
    requireBiometricAtClockIn: false, hasPensionEntitlement: null, taxDisabilityExemption: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const items: ItemDTO[] = [
  {
    id: "item-1",
    code: "ITM-001",
    nameAr: "عصير برتقال",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
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
  },
];

const ongoingTrip: VanTripDTO = {
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
  crew: [{ employeeId: "emp-1", role: "driver" }],
  loadedStock: [{ itemId: "item-1", qty: "20.000000" }],
  cashMovements: [{ id: "cm-1", kind: "sale", amount: "150.000000", occurredAt: "2026-08-20T10:00:00.000Z", notes: null }],
  status: "ongoing",
  openedAt: "2026-08-20T08:00:00.000Z",
  settledAt: null,
  settlement: null,
  notes: null,
};

function renderScreen(trips: VanTripDTO[] = [ongoingTrip]) {
  let current = [...trips];
  const transport = stubTransport({
    "GET /field/van-trips": () => ({ body: current }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /branches": () => ({ body: branches }),
    "GET /items": () => ({ body: items }),
    "GET /field/vans": () => ({ body: vans }),
    "GET /hr/employees": () => ({ body: employees }),
    "POST /field/van-trips": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      // Only `vanId` leaves the browser now — the van's warehouse, till and
      // branch are resolved server-side from the van registry, the same way
      // the real backend does (VanTripsScreen.tsx's handleSubmit comment).
      const van = vans.find((v) => v.id === body.vanId)!;
      const created: VanTripDTO = {
        id: body.id,
        tripNo: "VT-000002",
        date: body.date,
        branchId: van.branchId,
        vanId: body.vanId ?? null,
        vanWarehouseId: van.warehouseId,
        vanTreasuryAccountId: van.treasuryAccountId,
        sourceWarehouseId: body.sourceWarehouseId,
        sourceTreasuryAccountId: body.sourceTreasuryAccountId,
        openingCashFloat: body.openingCashFloat ?? "0.000000",
        crew: body.crew,
        loadedStock: body.loadedStock ?? [],
        cashMovements: [],
        status: "ongoing",
        openedAt: new Date().toISOString(),
        settledAt: null,
        settlement: null,
        notes: body.notes ?? null,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /field/van-trips/vt-1/cash-movements": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: VanTripDTO = {
        ...current[0]!,
        cashMovements: [...current[0]!.cashMovements, { id: body.id, kind: body.kind, amount: body.amount, occurredAt: body.occurredAt, notes: body.notes ?? null }],
      };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
    "POST /field/van-trips/vt-1/settle": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: VanTripDTO = {
        ...current[0]!,
        status: "settled",
        settledAt: new Date().toISOString(),
        settlement: {
          expectedCash: "618.400000",
          countedCash: body.countedCash,
          cashVariance: "31.600000",
          stockCounts: body.stockCounts.map((c: { itemId: string; countedQty: string }) => ({
            itemId: c.itemId,
            expectedQty: "20.000000",
            countedQty: c.countedQty,
            varianceQty: (Number(c.countedQty) - 20).toFixed(6),
          })),
          settledAt: new Date().toISOString(),
        },
      };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<VanTripsScreen />, { transport, initialSession: testAdminSession });
}

describe("VanTripsScreen", () => {
  it("lists van trips from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "رحلات المندوبين" })).toBeInTheDocument();
    const row = (await screen.findByText("VT-000001")).closest("tr")!;
    expect(within(row).getByText("ڤان القاهرة")).toBeInTheDocument();
    expect(within(row).getByText("الفرع الرئيسي")).toBeInTheDocument();
  });

  it("opens a new trip through the open-trip form", async () => {
    renderScreen();
    await screen.findByText("VT-000001");
    fireEvent.click(screen.getByRole("button", { name: "فتح رحلة" }));

    const dialog = screen.getByRole("dialog", { name: "فتح رحلة" });
    // Every picker here is a listbox combobox, not a native <select> — open
    // it, then commit an option (Select.tsx commits on mousedown). The option
    // list itself renders through a portal onto `document.body`, outside the
    // dialog's own DOM subtree, so it has to be queried from `screen`.
    function choose(labelText: string, optionName: RegExp) {
      fireEvent.click(within(dialog).getByRole("combobox", { name: labelText }));
      fireEvent.mouseDown(screen.getByRole("option", { name: optionName }));
    }

    // Choosing the van cascades its warehouse, till and branch (R3.13) — those
    // three are read-only CascadedValues afterwards, not fields to fill in.
    choose("الڤان *", /^ڤان القاهرة/);
    expect(within(dialog).getByText("مستودع المركبة")).toBeInTheDocument();
    choose("مستودع التحميل *", /^المخزن الرئيسي/);
    choose("خزينة المصدر *", /^الصندوق الرئيسي/);

    const crewSection = within(dialog).getByText("الطاقم *").closest("div")!;
    choose("اختر موظفاً", /^أحمد نبيل/);
    fireEvent.click(within(crewSection).getByRole("button", { name: "إضافة" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "فتح رحلة" }));

    expect(await screen.findByText("VT-000002")).toBeInTheDocument();
  });

  it("records a cash movement on an ongoing trip", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("VT-000001"));

    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    typeMoney(within(detail).getByLabelText("المبلغ"), "75");
    fireEvent.click(within(detail).getByRole("button", { name: "تسجيل الحركة" }));

    expect(await within(detail).findAllByText("بيع")).not.toHaveLength(0);
  });

  it("settles a trip and shows the cash and stock variance", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("VT-000001"));

    const detail = screen.getByRole("dialog", { name: /رحلة/ });
    fireEvent.click(within(detail).getByRole("button", { name: "تسوية الرحلة" }));
    typeMoney(within(detail).getByLabelText("النقدية المعدودة *"), "650");
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التسوية" }));

    expect(await within(detail).findByText("31.6")).toBeInTheDocument();
    expect(within(detail).getByText("650.00")).toBeInTheDocument();
  });
});
