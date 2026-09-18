// @vitest-environment jsdom
/**
 * AppLayout.tsx is the router's layout route: the shell chrome plus the
 * users/roles state machine that isn't a lazy screen module. `App.test.tsx`
 * already exercises navigation, workspace switching and the approvals badge
 * through the real route table; this file targets what that leaves
 * uncovered — the user/role save-edit-delete handlers, the scope-selection
 * conversion between the two array shapes the UI and the wire use, and the
 * command palette's quick actions, which a stale-typed sales-invoice/voucher
 * comment in the source warns used to collapse three different actions into
 * one untyped create.
 *
 * `Outlet` is stubbed with a probe that reads `useNavigation()` rather than
 * loading a real (lazy, screens/**-owned) screen module — AppLayout's own
 * navigate/intent wiring is what's under test here, not any particular screen.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import type { EntitlementsDTO, RoleDTO, UserDTO } from "@mezan/contracts";
import { AppLayout } from "./AppLayout";
import { AppProviders } from "./data/AppProviders";
import { persistSession, type Session } from "./data/session";
import { stubTransport, testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";
import { useNavigation } from "./navigation";
import { pathForRoute } from "./routing";

function IntentProbe() {
  const nav = useNavigation();
  const location = useLocation();
  return (
    <>
      <div data-testid="intent-probe">{JSON.stringify(nav.intent)}</div>
      <div data-testid="location-probe">{location.pathname}</div>
    </>
  );
}

function renderLayout(transport: Transport, initialEntries: string[] = ["/dashboard"], session: Session | null = testAdminSession) {
  const router = createMemoryRouter(
    [{ path: "/", Component: AppLayout, children: [{ path: "*", element: <IntentProbe /> }] }],
    { initialEntries },
  );
  return render(
    <AppProviders transport={transport} initialSession={session}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

const branches = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "BR2", code: "BR2", name: "فرع الإسكندرية", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
];
const warehouses = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الرئيسي", nameEn: null, branchId: "MAIN", type: "main", isDefault: true, active: true },
  { id: "WH2", code: "WH2", name: "مستودع الإسكندرية", nameEn: null, branchId: "BR2", type: "main", isDefault: false, active: true },
];
const role: RoleDTO = {
  id: "role-1",
  code: "VAN_SALES",
  name: "مندوب مبيعات",
  description: "وصف الدور",
  permissions: ["sales.invoices.view", "sales.invoices.create"],
  isSystem: false,
  createdAt: "2026-08-08T00:00:00.000Z",
};
const systemRole: RoleDTO = { ...role, id: "role-admin", code: "ADMIN", name: "مدير", isSystem: true, permissions: [] };
const entitlements: EntitlementsDTO = {
  plan: "pro",
  /**
   * The licence an ENTERPRISE plan actually issues (`DEFAULT_ACTIVE_MODULES`
   * in packages/api/src/app.ts). It used to be a partial hand-written list
   * that misspelled `purchases` as `purchasing` and omitted notifications,
   * installments, financial_papers, field and projects — harmless while the
   * rail ignored the licence, and wrong the moment it stopped (P-3).
   */
  activeModules: [
    "dashboard",
    "sales",
    "purchases",
    "inventory",
    "accounting",
    "treasury",
    "installments",
    "financial_papers",
    "crm",
    "hr",
    "manufacturing",
    "assets",
    "field",
    "workflow",
    "audit",
    "transactions",
    "admin",
    "notifications",
    "projects",
  ],
  features: {},
  seats: 10,
  expiresAt: null,
};

function baseHandlers() {
  return {
    "GET /branches": () => ({ body: branches }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /entitlements": () => ({ body: entitlements }),
  };
}

describe("AppLayout — users", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("scopeIdsToSelection: saving with every branch checked sends ALL_SCOPE ('*'), not the id array — and a partial selection sends the real ids", async () => {
    let seenBody: { branchScope?: unknown; warehouseScope?: unknown } | null = null;
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [role] }),
      "GET /users": () => ({ body: [] }),
      "POST /users": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "U2" } };
      },
    });
    renderLayout(transport, [pathForRoute("users")]);

    fireEvent.click(await screen.findByRole("button", { name: "إضافة مستخدم" }));
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم جديد" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني *", { exact: false }), { target: { value: "new@cyag.test" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "الفرع الرئيسي" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "فرع الإسكندرية" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    await screen.findByRole("button", { name: "إضافة مستخدم" });
    expect(seenBody).not.toBeNull();
    expect(seenBody!.branchScope).toBe("*");

    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم آخر" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني *", { exact: false }), { target: { value: "another@cyag.test" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "الفرع الرئيسي" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    await screen.findByRole("button", { name: "إضافة مستخدم" });
    expect(seenBody!.branchScope).toEqual(["MAIN"]);
  });

  it("handleToggleUserStatus posts to the clicked row's own id and the new (inverted) status, not a stale one", async () => {
    const activeUser: UserDTO = {
      id: "U1",
      nameAr: "محمد",
      nameEn: null,
      email: "m@cyag.test",
      phone: null,
      hasPin: false,
      roleId: null,
      isCompanyAdmin: true,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-08-08T00:00:00.000Z",
    };
    let seenPath = "";
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [activeUser] }),
      "POST /users/U1/deactivate": (_init, path) => {
        seenPath = path;
        return { body: { ...activeUser, status: "inactive" } };
      },
    });
    renderLayout(transport, [pathForRoute("users")]);

    fireEvent.click(await screen.findByRole("button", { name: "تعطيل" }));
    await screen.findByText(seenPath, { exact: false }).catch(() => undefined);
    expect(seenPath).toBe("/users/U1/deactivate");
  });
});

describe("AppLayout — roles", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("onDuplicate opens the editor as a NEW role (template, not role) — the code/name stay blank while the template's permissions carry over, so the duplicate cannot silently overwrite the original", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [role, systemRole] }),
      "GET /users": () => ({ body: [] }),
    });
    renderLayout(transport, [pathForRoute("roles")]);

    const row = (await screen.findByText("مندوب مبيعات")).closest("tr") ?? document.body;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "نسخ" }));

    expect(await screen.findByLabelText("اسم الدور *")).toHaveValue("");
    expect(screen.getByLabelText("رمز الدور *")).toHaveValue("");
    expect(screen.getByText("2", { exact: true })).toBeInTheDocument();
  });

  it("onEdit opens the editor pre-filled with the clicked role, and saving PUTs to that role's id", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [role] }),
      "GET /users": () => ({ body: [] }),
      "PUT /roles/role-1": (init, path) => {
        seenPath = path;
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...role, name: "مندوب مبيعات معدّل" } };
      },
    });
    renderLayout(transport, [pathForRoute("roles")]);

    fireEvent.click(await screen.findByRole("button", { name: "تعديل" }));
    expect(await screen.findByLabelText("اسم الدور *")).toHaveValue("مندوب مبيعات");
    fireEvent.change(screen.getByLabelText("اسم الدور *"), { target: { value: "مندوب مبيعات معدّل" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الدور" }));

    await screen.findByRole("button", { name: "تعديل" });
    expect(seenPath).toBe("/roles/role-1");
    expect((seenBody as { name: string; permissions: string[] }).name).toBe("مندوب مبيعات معدّل");
    expect((seenBody as { permissions: string[] }).permissions).toEqual(role.permissions);
  });

  it("handleSaveRole returns to the roles list on success — the editor does not stay open on a stale role", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [role] }),
      "GET /users": () => ({ body: [] }),
      "PUT /roles/role-1": () => ({ body: role }),
    });
    renderLayout(transport, [pathForRoute("roles")]);

    fireEvent.click(await screen.findByRole("button", { name: "تعديل" }));
    await screen.findByLabelText("اسم الدور *");
    fireEvent.click(await screen.findByRole("button", { name: "حفظ الدور" }));

    await waitFor(() => expect(screen.queryByLabelText("اسم الدور *")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "دور جديد" })).toBeInTheDocument();
  });

  it("handleRemoveRole DELETEs the clicked role's own id", async () => {
    let seenPath = "";
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [role] }),
      "GET /users": () => ({ body: [] }),
      "DELETE /roles/role-1": (_init, path) => {
        seenPath = path;
        return { status: 204, body: null };
      },
    });
    renderLayout(transport, [pathForRoute("roles")]);

    fireEvent.click(await screen.findByRole("button", { name: "حذف" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(seenPath).toBe("/roles/role-1");
  });
});

describe("AppLayout — command palette", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("'تحصيل من عميل' navigates to سندات القبض/الصرف with a customer_collection prefill, not the plain receipt/payment create the neighbouring commands use", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);

    fireEvent.click(await screen.findByRole("button", { name: /بحث وأوامر/ }));
    fireEvent.click(await screen.findByText("تحصيل من عميل"));

    const probe = await screen.findByTestId("intent-probe");
    const intent = JSON.parse(probe.textContent ?? "null") as { kind: string; prefill?: { voucherType: string } } | null;
    expect(intent?.kind).toBe("create");
    expect(intent?.prefill?.voucherType).toBe("customer_collection");
  });

  it("'دفع لمورد' prefills supplier_payment — the sibling command must not resolve to the same type", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);

    fireEvent.click(await screen.findByRole("button", { name: /بحث وأوامر/ }));
    fireEvent.click(await screen.findByText("دفع لمورد"));

    const probe = await screen.findByTestId("intent-probe");
    const intent = JSON.parse(probe.textContent ?? "null") as { prefill?: { voucherType: string } } | null;
    expect(intent?.prefill?.voucherType).toBe("supplier_payment");
  });

  it("every remaining quick action navigates to its OWN screen with a create intent — the route actually changes, not just a handler firing", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);

    const cases: [label: string, screen: Parameters<typeof pathForRoute>[0]][] = [
      ["فاتورة مبيعات جديدة", "sales-invoices"],
      ["سند نقدي جديد", "treasury-vouchers"],
      ["استلام بضاعة", "goods-receipts"],
      ["فاتورة مشتريات جديدة", "purchase-invoices"],
      ["عرض سعر جديد", "quotes"],
      ["صنف جديد", "items"],
      ["تسوية مخزون جديدة", "stock-adjustments"],
    ];
    for (const [label, target] of cases) {
      fireEvent.click(await screen.findByRole("button", { name: /بحث وأوامر/ }));
      fireEvent.click(await screen.findByText(label));
      await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute(target)));
      const probe = screen.getByTestId("intent-probe");
      const intent = JSON.parse(probe.textContent ?? "null") as { kind: string } | null;
      expect(intent?.kind).toBe("create");
    }
  });

  it("'اختصارات لوحة المفاتيح' from the command palette opens the shortcuts overlay, and its own close button dismisses it", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);

    fireEvent.click(await screen.findByRole("button", { name: /بحث وأوامر/ }));
    fireEvent.click(await screen.findByText("اختصارات لوحة المفاتيح"));

    expect(await screen.findByRole("dialog", { name: "اختصارات لوحة المفاتيح" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إغلاق قائمة الاختصارات" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "اختصارات لوحة المفاتيح" })).not.toBeInTheDocument());
  });

  it("the rail's own help button (not the command palette) also opens the shortcuts overlay", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);

    fireEvent.click(await screen.findByRole("button", { name: "اختصارات لوحة المفاتيح" }));
    expect(await screen.findByRole("dialog", { name: "اختصارات لوحة المفاتيح" })).toBeInTheDocument();
  });

  it("the '?' keyboard shortcut ALSO opens the shortcuts overlay — a third, independent trigger from the global keymap", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);
    await screen.findByTestId("location-probe");

    fireEvent.keyDown(document, { key: "?" });
    expect(await screen.findByRole("dialog", { name: "اختصارات لوحة المفاتيح" })).toBeInTheDocument();
  });

  it("the 'g' then 'd' module-jump chord routes to the dashboard through the top-nav item's own click handler", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, [pathForRoute("notifications")]);
    await screen.findByTestId("location-probe");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("notifications"));

    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "d" });

    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("dashboard")));
  });

  it("⌘N opens the DEFAULT create screen (sales invoices) with a create intent when the screen on display registered no create target of its own", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);
    await screen.findByTestId("location-probe");

    fireEvent.keyDown(document, { key: "n", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("sales-invoices")));
    const intent = JSON.parse(screen.getByTestId("intent-probe").textContent ?? "null") as { kind: string } | null;
    expect(intent?.kind).toBe("create");
  });

  it("clicking the pinned «صندوق الوارد» rail icon navigates the URL to the notifications screen", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);
    await screen.findByTestId("location-probe");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("dashboard"));

    fireEvent.click(screen.getByRole("button", { name: "صندوق الوارد" }));
    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("notifications")));
  });

  it("clicking the dashboard icon in the direct-nav row (distinct from the wordmark) routes home", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, [pathForRoute("notifications")]);
    await screen.findByTestId("location-probe");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("notifications"));

    fireEvent.click(screen.getByRole("button", { name: "لوحة التحكم" }));
    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("dashboard")));
  });

  it("the wordmark's onNavigateHome routes to the dashboard from any screen", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, [pathForRoute("notifications")]);
    await screen.findByTestId("location-probe");

    fireEvent.click(screen.getByRole("button", { name: "ميزان — الذهاب إلى لوحة التحكم" }));
    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("dashboard")));
  });

  it("a 'go to' command-palette entry (built from the nav tree, not a quick action) navigates to that exact screen with no create intent", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"]);

    fireEvent.click(await screen.findByRole("button", { name: /بحث وأوامر/ }));
    fireEvent.click(await screen.findByText("صندوق الوارد"));

    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(pathForRoute("notifications")));
    expect(screen.getByTestId("intent-probe")).toHaveTextContent("null");
  });
});

describe("AppLayout — nav entitlements", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("hides a workspace whose module the plan does not license — a sales+accounting plan shows no الأشخاص or التصنيع in the rail", async () => {
    const businessEntitlements: EntitlementsDTO = { ...entitlements, activeModules: ["sales", "accounting"] };
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /entitlements": () => ({ body: businessEntitlements }),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
    });
    renderLayout(transport, ["/dashboard"]);

    const rail = await screen.findByRole("navigation", { name: "التنقل بين مساحات العمل" });
    // Licensed workspaces stay put once the query resolves.
    await waitFor(() => expect(within(rail).getByRole("button", { name: "المالية والإقفال" })).toBeInTheDocument());
    expect(within(rail).getByRole("button", { name: "البيع والتحصيل" })).toBeInTheDocument();
    // Unlicensed ones (hr, manufacturing) never reach the rail.
    expect(within(rail).queryByRole("button", { name: "الأشخاص" })).not.toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: "التصنيع" })).not.toBeInTheDocument();
  });
});

describe("AppLayout — sign out", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("clears every cached query — a stale answer from the session that just signed out must not render under the next one", async () => {
    const clearSpy = vi.spyOn(QueryClient.prototype, "clear");
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "POST /auth/logout": () => ({ body: {} }),
    });
    renderLayout(transport, ["/dashboard"]);

    fireEvent.click(await screen.findByRole("button", { name: "تسجيل الخروج" }));
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("AppLayout — role editor cancel", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("cancelling the role editor returns to the roles list without saving anything", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [role] }),
      "GET /users": () => ({ body: [] }),
    });
    renderLayout(transport, [pathForRoute("roles")]);

    fireEvent.click(await screen.findByRole("button", { name: "دور جديد" }));
    expect(await screen.findByLabelText("اسم الدور *")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));

    expect(await screen.findByRole("button", { name: "دور جديد" })).toBeInTheDocument();
  });
});

describe("AppLayout — first-run wizard", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("'الإعداد الأولي' on the login screen opens the first-run wizard, and its own cancel returns to sign-in", async () => {
    const transport = stubTransport({});
    renderLayout(transport, ["/dashboard"], null);

    fireEvent.click(await screen.findByRole("button", { name: "الإعداد الأولي" }));
    expect(await screen.findByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(await screen.findByRole("button", { name: "الإعداد الأولي" })).toBeInTheDocument();
  });

  it("walking every wizard step through to 'إنهاء والانتقال إلى النظام' calls onFinish, which lands the app on the real shell", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /tenant": () => ({ body: { name: "Cyag" } }),
      "GET /bootstrap/status": () => ({ body: { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0 } }),
      "POST /bootstrap/admin": () => ({ body: testAdminSession }),
      "POST /bootstrap/seed": () => ({ body: { accounts: 5, taxRates: 2, branches: 1, warehouses: 1, fiscalPeriods: 1, users: 1 } }),
    });
    renderLayout(transport, ["/dashboard"], null);

    fireEvent.click(await screen.findByRole("button", { name: "الإعداد الأولي" }));

    // Step 1 — the licence, which is a FILE and never blocks the step
    // (guards L-5: the old step reported its own success and gated «التالي»).
    fireEvent.click(await screen.findByRole("button", { name: "التالي" }));

    // Step 2 — admin account.
    fireEvent.change(await screen.findByLabelText("الاسم الكامل"), { target: { value: "مدير النظام" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني", { exact: false }), { target: { value: "admin@cyag.example" } });
    fireEvent.change(screen.getByLabelText("الرمز السرّي (٦ أرقام)"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("تأكيد رمز PIN"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    // Step 3 — seed core data.
    await screen.findByRole("button", { name: "تشغيل التهيئة" });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل التهيئة" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    // Step 4 — import (skipped) — finish.
    fireEvent.click(await screen.findByRole("button", { name: "إنهاء والانتقال إلى النظام" }));

    // onFinish closed the wizard; the admin session from step 2 now shows the real shell.
    expect(await screen.findByRole("button", { name: "ميزان — الذهاب إلى لوحة التحكم" })).toBeInTheDocument();
  });

  /**
   * An unclaimed tenant opens the wizard from a SERVER fact, so its cancel used
   * to set `showWizard` — a flag that branch never reads. The wizard re-rendered
   * identically and the button did nothing, on every fresh install, leaving no
   * way to reach the login screen without completing the wizard. That also put
   * the seeded administrator account — the recovery path for anyone who did not
   * want the wizard — out of reach entirely.
   */
  it("cancelling the wizard an unclaimed install opened actually reaches the login screen", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /tenant": () => ({ body: { name: "Cyag" } }),
      // Stays false for the whole test: cancelling must not depend on the
      // server changing its mind.
      "GET /bootstrap/status": () => ({
        body: { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0, claimed: false },
      }),
    });
    renderLayout(transport, ["/dashboard"], null);

    fireEvent.click(await screen.findByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));

    expect(await screen.findByRole("button", { name: "الإعداد الأولي" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" })).not.toBeInTheDocument();
  });

  /** ...and the way back in still works, rather than being suppressed by the dismissal. */
  it("reopens the wizard from the login screen after it was cancelled", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /tenant": () => ({ body: { name: "Cyag" } }),
      "GET /bootstrap/status": () => ({
        body: { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0, claimed: false },
      }),
    });
    renderLayout(transport, ["/dashboard"], null);

    fireEvent.click(await screen.findByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    fireEvent.click(await screen.findByRole("button", { name: "الإعداد الأولي" }));

    expect(await screen.findByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();
  });
});

/** guards P-3 — all 117 destinations used to render for every seat. */
describe("AppLayout — the rail against the seat's permissions (P-3)", () => {
  afterEach(() => {
    persistSession(null);
  });

  const warehouseKeeper: Session = {
    ...testAdminSession,
    userId: "USER-WH",
    nameAr: "أمين المخزن",
    isCompanyAdmin: false,
    roleCode: "WAREHOUSE_KEEPER",
    permissions: [
      "inventory.stock.view",
      "inventory.item.view",
      "inventory.transfer.view",
      "inventory.adjustment.view",
      "inventory.count.view",
    ],
  };

  function openAllScreens() {
    fireEvent.click(screen.getByRole("button", { name: /كل الشاشات/ }));
    return screen.getByRole("dialog", { name: "كل الشاشات" });
  }

  it("a warehouse keeper is not offered الرواتب or القيود المحاسبية", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"], warehouseKeeper);

    await screen.findByRole("button", { name: /كل الشاشات/ });
    const panel = openAllScreens();

    expect(within(panel).getByText("أرصدة المخزون")).toBeInTheDocument();
    expect(within(panel).queryByText("الرواتب")).toBeNull();
    expect(within(panel).queryByText("القيود المحاسبية")).toBeNull();
    expect(within(panel).queryByText("المستخدمون")).toBeNull();
  });

  it("the company admin still reaches all of them", async () => {
    const transport = stubTransport({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
    renderLayout(transport, ["/dashboard"], testAdminSession);

    await screen.findByRole("button", { name: /كل الشاشات/ });
    const panel = openAllScreens();

    expect(within(panel).getAllByText("الرواتب").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("القيود المحاسبية").length).toBeGreaterThan(0);
  });
});
