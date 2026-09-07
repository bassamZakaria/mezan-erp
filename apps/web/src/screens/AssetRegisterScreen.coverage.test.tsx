// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AccountDTO, AssetCategoryDTO, AssetDTO, BranchDTO } from "@mezan/contracts";
import { AssetRegisterScreen } from "./AssetRegisterScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** MoneyInput only commits its draft to React state on blur. */
function typeMoney(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const categories: AssetCategoryDTO[] = [
  {
    id: "cat-1",
    code: "FA-01",
    nameAr: "مركبات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 10,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: true,
  },
  {
    id: "cat-2",
    code: "FA-02",
    nameAr: "معدات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 36,
    defaultSalvagePercent: 5,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: true,
  },
];

const branches: BranchDTO[] = [
  { id: "br-1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "br-2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
];

function asset(overrides: Partial<AssetDTO> & { id: string; code: string }): AssetDTO {
  return {
    id: overrides.id,
    code: overrides.code,
    nameAr: overrides.nameAr ?? "أصل",
    nameEn: overrides.nameEn ?? null,
    categoryId: overrides.categoryId ?? "cat-1",
    scope: overrides.scope ?? "general",
    branchId: overrides.branchId ?? null,
    warehouseId: overrides.warehouseId ?? null,
    acquisitionDate: overrides.acquisitionDate ?? "2025-01-01",
    acquisitionCost: overrides.acquisitionCost ?? "100000.000000",
    depreciationStartDate: overrides.depreciationStartDate ?? "2025-01-01",
    depreciationMethod: overrides.depreciationMethod ?? "straight_line",
    usefulLifeMonths: overrides.usefulLifeMonths ?? 60,
    salvageValue: overrides.salvageValue ?? "0.000000",
    accumulatedDepreciation: overrides.accumulatedDepreciation ?? "0.000000",
    status: overrides.status ?? "active",
    assetAccountId: overrides.assetAccountId ?? null,
    depreciationExpenseAccountId: overrides.depreciationExpenseAccountId ?? null,
    accumulatedDepreciationAccountId: overrides.accumulatedDepreciationAccountId ?? null,
    notes: overrides.notes ?? null,
  };
}

function assetsHandler(current: () => AssetDTO[]) {
  return (_init: RequestInit | undefined, path: string) => {
    const qs = new URLSearchParams(path.split("?")[1] ?? "");
    const categoryId = qs.get("categoryId");
    const branchId = qs.get("branchId");
    const search = qs.get("search");
    let rows = current();
    if (categoryId) rows = rows.filter((a) => a.categoryId === categoryId);
    if (branchId) rows = rows.filter((a) => a.branchId === branchId);
    if (search) rows = rows.filter((a) => a.nameAr.includes(search));
    return { body: rows };
  };
}

describe("AssetRegisterScreen — required-field validation", () => {
  it("walks through every required-field message on the way to registering a branch-scoped asset", async () => {
    let created: AssetDTO[] = [asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل" })];
    let lastCreateBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /assets": assetsHandler(() => created),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets": (init) => {
        lastCreateBody = JSON.parse(String(init?.body));
        const row = asset({ ...(lastCreateBody as Partial<AssetDTO> & { id: string; code: string }) });
        created = [...created, row];
        return { status: 201, body: row };
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("سيارة النقل");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل أصل" }));
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });
    const save = () => fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("كود الأصل مطلوب.");

    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "EQ-100" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("الاسم بالعربية مطلوب.");

    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "رافعة شوكية" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("التصنيف مطلوب.");

    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));

    fireEvent.click(within(dialog).getByRole("combobox", { name: "نطاق الأصل *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "فرع" }));
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("الفرع مطلوب عند اختيار نطاق «فرع».");

    fireEvent.click(within(dialog).getByRole("combobox", { name: "الفرع *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "فرع الإسكندرية" }));
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("تاريخ الاقتناء مطلوب.");

    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-02-01" } });
    typeMoney(within(dialog).getByLabelText("تكلفة الاقتناء *"), "");
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("تكلفة الاقتناء مطلوبة ويجب ألا تكون سالبة.");

    typeMoney(within(dialog).getByLabelText("تكلفة الاقتناء *"), "60000");
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("العمر الإنتاجي (شهور) يجب أن يكون رقماً أكبر من صفر.");

    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "36" } });
    save();

    expect(await screen.findByText("رافعة شوكية")).toBeInTheDocument();
    expect(lastCreateBody).toMatchObject({
      code: "EQ-100",
      categoryId: "cat-1",
      scope: "branch",
      branchId: "br-2",
      warehouseId: null,
      acquisitionCost: "60000.000000",
      usefulLifeMonths: 36,
    });
  });
});

describe("AssetRegisterScreen — creation details", () => {
  it("sends the optional English name, warehouse id, start date and residual value the accountant fills in", async () => {
    let created: AssetDTO[] = [];
    let lastCreateBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /assets": () => ({ body: created }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets": (init) => {
        lastCreateBody = JSON.parse(String(init?.body));
        const row = asset({ ...(lastCreateBody as Partial<AssetDTO> & { id: string; code: string }) });
        created = [...created, row];
        return { status: 201, body: row };
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد أصول/);
    fireEvent.click(screen.getAllByRole("button", { name: "تسجيل أصل" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });

    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "رافعة شوكية" } });
    fireEvent.change(within(dialog).getByLabelText("اسم الأصل"), { target: { value: "Forklift" } });
    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "EQ-200" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-02 — معدات" }));

    fireEvent.click(within(dialog).getByRole("combobox", { name: "نطاق الأصل *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "مستودع" }));
    fireEvent.change(within(dialog).getByLabelText("المستودع"), { target: { value: "WH-02" } });

    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-01-10" } });
    typeMoney(within(dialog).getByLabelText("تكلفة الاقتناء *"), "50000");
    fireEvent.change(within(dialog).getByLabelText("تاريخ بدء الإهلاك"), { target: { value: "2026-02-01" } });
    typeMoney(within(dialog).getByLabelText("القيمة المتبقية"), "2000");

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText("رافعة شوكية")).toBeInTheDocument();

    expect(lastCreateBody).toMatchObject({
      nameEn: "Forklift",
      scope: "warehouse",
      branchId: null,
      warehouseId: "WH-02",
      depreciationStartDate: "2026-02-01",
      salvageValue: "2000.000000",
    });
  });

  it("leaves the warehouse id null when a warehouse-scoped asset is registered without one", async () => {
    let created: AssetDTO[] = [];
    let lastCreateBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /assets": () => ({ body: created }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets": (init) => {
        lastCreateBody = JSON.parse(String(init?.body));
        const row = asset({ ...(lastCreateBody as Partial<AssetDTO> & { id: string; code: string }) });
        created = [...created, row];
        return { status: 201, body: row };
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد أصول/);
    fireEvent.click(screen.getAllByRole("button", { name: "تسجيل أصل" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });

    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "طاولات عرض" } });
    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "EQ-210" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "نطاق الأصل *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "مستودع" }));
    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-01-10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("طاولات عرض")).toBeInTheDocument();
    expect(lastCreateBody).toMatchObject({ scope: "warehouse", branchId: null, warehouseId: null });
  });
});

describe("AssetRegisterScreen — refused creation", () => {
  it("shows a generic message when the create request fails without a structured API error", async () => {
    const transport = stubTransport({
      "GET /assets": () => ({ body: [] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets": () => {
        throw "network dropped";
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد أصول/);
    fireEvent.click(screen.getAllByRole("button", { name: "تسجيل أصل" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });

    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "خزنة" } });
    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "EQ-300" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));
    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تسجيل الأصل.");
  });

  it("shows the server's own message when the API refuses for a reason the client cannot check", async () => {
    const transport = stubTransport({
      "GET /assets": () => ({ body: [] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets": () => ({ status: 500, body: { error: "PERIOD_CLOSED", message: "الفترة المحاسبية الحالية مقفلة." } }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد أصول/);
    fireEvent.click(screen.getAllByRole("button", { name: "تسجيل أصل" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });

    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "خزنة" } });
    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "EQ-301" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));
    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المحاسبية الحالية مقفلة.");
  });
});

describe("AssetRegisterScreen — filters and pagination", () => {
  it("narrows the register by category and branch together, counting both as active filters", async () => {
    let current: AssetDTO[] = [
      asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل", categoryId: "cat-1", scope: "general" }),
      asset({ id: "asset-2", code: "EQ-050", nameAr: "معدة تصنيع", categoryId: "cat-2", scope: "branch", branchId: "br-1" }),
    ];
    const transport = stubTransport({
      "GET /assets": assetsHandler(() => current),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("سيارة النقل");
    expect(screen.getByText("معدة تصنيع")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "التصنيف" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-02 — معدات" }));
    await waitFor(() => expect(screen.queryByText("سيارة النقل")).not.toBeInTheDocument());
    expect(screen.getByText("معدة تصنيع")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "الفرع" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "الفرع الرئيسي" }));

    /*
     * BOTH waits are needed, and neither implies the other — which is why this
     * test passed on its own and failed under a loaded full suite, blocking the
     * pre-push gate for everyone.
     *
     * Waiting for the row alone proved nothing: «معدة تصنيع» was already on
     * screen before this second filter was applied, so that wait resolved on the
     * first tick and left the badge assertion racing a state update. But waiting
     * for the badge alone is not enough either: the row is briefly removed while
     * the refiltered list is in flight, so it has to be waited back IN rather
     * than asserted synchronously. br-1 is «الفرع الرئيسي», which is asset-2's
     * own branch, so it does come back.
     *
     * And the badge is read through its OWN button rather than `getByText("2")`.
     * The count is a bare `<span>2</span>` inside the filter toggle
     * (DocumentList.tsx), so a loose text query matches any other "2" the screen
     * happens to be rendering — a row count, a page number — and then fails as
     * "found multiple elements" rather than as anything to do with filters.
     */
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /تصفية النتائج/ })).toHaveTextContent("2"),
    );
    // A generous timeout, not the 1s default: the row leaves and comes back
    // while the refiltered list is in flight, and under a fully parallel suite
    // that round trip does not always finish inside a second. The behaviour is
    // right; only the deadline was.
    expect(await screen.findByText("معدة تصنيع", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("resets to the first page once the current page it was on no longer exists", async () => {
    const transport = stubTransport({
      "GET /assets": () => ({ body: [asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل" })] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession, route: "/?page=5" });
    expect(await screen.findByText("سيارة النقل")).toBeInTheDocument();
  });
});

describe("AssetRegisterScreen — detail panel fallbacks", () => {
  it("falls back to the raw category id and a dash for a missing name, and shows the notes card", async () => {
    const orphan = asset({
      id: "asset-orphan",
      code: "EQ-999",
      nameAr: "أصل بلا تصنيف",
      categoryId: "cat-deleted",
      nameEn: null,
      notes: "تم فحصه في آخر جرد سنوي",
    });
    const transport = stubTransport({
      "GET /assets": () => ({ body: [orphan] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("أصل بلا تصنيف"));
    const detail = screen.getByRole("dialog", { name: /أصل —/ });

    expect(within(detail).getByText("cat-deleted")).toBeInTheDocument();
    expect(within(detail).getByText("—")).toBeInTheDocument();
    expect(within(detail).getByText("تم فحصه في آخر جرد سنوي")).toBeInTheDocument();
  });
});

describe("AssetRegisterScreen — stale selection", () => {
  it("closes the detail panel when the selected asset drops out of a narrowed filter", async () => {
    const current: AssetDTO[] = [
      asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل", categoryId: "cat-1" }),
      asset({ id: "asset-2", code: "EQ-050", nameAr: "معدة تصنيع", categoryId: "cat-2" }),
    ];
    const transport = stubTransport({
      "GET /assets": assetsHandler(() => current),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("معدة تصنيع"));
    expect(screen.getByRole("dialog", { name: /أصل —/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "التصنيف" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /أصل —/ })).not.toBeInTheDocument());
  });
});

describe("AssetRegisterScreen — list load failures", () => {
  it("offers a retry when the register fails to load, and recovers once the retry succeeds", async () => {
    let fail = true;
    const transport = stubTransport({
      "GET /assets": () => (fail ? { status: 500, body: {} } : { body: [asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل" })] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل سجل الأصول. (رمز 500)")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => expect(screen.queryByText("تعذّر تحميل سجل الأصول. (رمز 500)")).not.toBeInTheDocument());
    expect(await screen.findByText("سيارة النقل")).toBeInTheDocument();
  });
});

describe("AssetRegisterScreen — disposal", () => {
  const account: AccountDTO = {
    id: "acct-cash",
    code: "1301",
    nameAr: "نقدية بالخزينة",
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
  };
  const receivableAccount: AccountDTO = {
    id: "acct-recv",
    code: "1105",
    nameAr: "عملاء",
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
  };

  it("records a sale with proceeds banked to a chosen account, sending both fields to the server", async () => {
    let disposedBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /assets": () => ({ body: [asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل" })] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "GET /accounts": () => ({ body: [account, receivableAccount] }),
      "POST /assets/asset-1/dispose": (init) => {
        disposedBody = JSON.parse(String(init?.body));
        return { body: asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل", status: "disposed" }) };
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("سيارة النقل"));
    const detail = screen.getByRole("dialog", { name: /أصل —/ });
    fireEvent.click(within(detail).getByRole("button", { name: "التخلص من الأصل" }));

    const [, proceedsInput] = within(detail).getAllByRole("textbox");
    typeMoney(proceedsInput!, "5000");
    fireEvent.click(within(detail).getByRole("combobox", { name: "حساب التحصيل" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "1301 — نقدية بالخزينة" }));

    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التخلص" }));

    await waitFor(() => expect(disposedBody).not.toBeNull());
    expect(disposedBody).toMatchObject({ proceeds: "5000", proceedsAccountId: "acct-cash" });
  });

  it("keeps the disposal panel open and shows the server's refusal message", async () => {
    const transport = stubTransport({
      "GET /assets": () => ({ body: [asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل" })] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets/asset-1/dispose": () => ({ status: 400, body: { error: "PERIOD_CLOSED", message: "الفترة المحاسبية مقفلة." } }),
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("سيارة النقل"));
    const detail = screen.getByRole("dialog", { name: /أصل —/ });
    fireEvent.click(within(detail).getByRole("button", { name: "التخلص من الأصل" }));
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التخلص" }));

    expect(await within(detail).findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "تأكيد التخلص" })).toBeInTheDocument();
  });

  it("falls back to a generic message when the disposal request fails outright", async () => {
    const transport = stubTransport({
      "GET /assets": () => ({ body: [asset({ id: "asset-1", code: "VEH-001", nameAr: "سيارة النقل" })] }),
      "GET /assets/categories": () => ({ body: categories }),
      "GET /branches": () => ({ body: branches }),
      "POST /assets/asset-1/dispose": () => {
        throw "connection reset";
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("سيارة النقل"));
    const detail = screen.getByRole("dialog", { name: /أصل —/ });
    fireEvent.click(within(detail).getByRole("button", { name: "التخلص من الأصل" }));
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التخلص" }));

    expect(await within(detail).findByText("تعذّر التخلص من الأصل")).toBeInTheDocument();
  });
});
