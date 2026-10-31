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
import { PLATFORM_LOOKUP_FIRST_RETRY_MS } from "./data/hooks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { GLANCE_PERMISSION } from "./screens/enh/glance/permission";
import { PasswordChangeRefusal, type EntitlementsDTO, type RoleDTO, type UserDTO } from "@mezan/contracts";
import { SUBSCRIPTION_BILLING_FEATURE, moduleNotLicensedMessageAr } from "@mezan/domain";
import { AppLayout } from "./AppLayout";
import { useEffect, useState } from "react";
import { useApi } from "./data/ApiContext";
import { AppProviders } from "./data/AppProviders";
import { clearTenantCode, persistSession, persistTenantCode, type Session } from "./data/session";
import { stubTransport, testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";
import { useNavigation } from "./navigation";
import { pathForRoute } from "./routing";
import { preloadScreen } from "./router/screens";

vi.mock("./router/screens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./router/screens")>()),
  preloadScreen: vi.fn(),
}));

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
      mustChangePassword: false,
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

describe("AppLayout — dashboard.view", () => {
  afterEach(() => {
    persistSession(null);
  });
  const handlers = () => ({ ...baseHandlers(), "GET /roles": () => ({ body: [] }), "GET /users": () => ({ body: [] }) });
  const seat = (permissions: string[]): Session => ({ ...testAdminSession, permissions });

  it("a seat holding dashboard.view has the dashboard icon and its screen", async () => {
    renderLayout(stubTransport(handlers()), [pathForRoute("dashboard")], seat(["dashboard.view", "sales.invoice.view"]));
    expect(await screen.findByRole("button", { name: "لوحة التحكم" })).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-not-permitted")).not.toBeInTheDocument();
  });

  it("a seat without it has no dashboard icon, and the dashboard path says why in Arabic instead of drawing the screen", async () => {
    renderLayout(stubTransport(handlers()), [pathForRoute("dashboard")], seat(["sales.invoice.view"]));
    const notice = await screen.findByTestId("dashboard-not-permitted");
    expect(notice).toHaveTextContent("لوحة التحكم غير متاحة لدورك");
    expect(screen.queryByRole("button", { name: "لوحة التحكم" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("location-probe")).not.toBeInTheDocument();
  });

  it("a glance-only seat that lands on the dashboard path, as it does after signing in, is taken to the glance", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", Component: AppLayout, children: [{ path: "*", element: <IntentProbe /> }] },
        { path: "/glance/*", element: <div data-testid="glance-probe" /> },
      ],
      { initialEntries: [pathForRoute("dashboard")] },
    );
    render(
      <AppProviders transport={stubTransport(handlers())} initialSession={seat([GLANCE_PERMISSION])}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByTestId("glance-probe")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/glance");
    expect(screen.queryByTestId("dashboard-not-permitted")).not.toBeInTheDocument();
  });

  it("the same seat still reaches every other screen its role opens", async () => {
    renderLayout(stubTransport(handlers()), [pathForRoute("notifications")], seat(["sales.invoice.view"]));
    expect(await screen.findByTestId("location-probe")).toHaveTextContent(pathForRoute("notifications"));
    expect(screen.queryByTestId("dashboard-not-permitted")).not.toBeInTheDocument();
  });
});

describe("AppLayout — nav entitlements", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("hides a workspace whose module the plan does not license — a sales+accounting plan shows no التصنيع, and keeps الأشخاص for the free staff list", async () => {
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
    // The staff list (hr.people) is free on every plan, so الأشخاص stays; manufacturing is unlicensed.
    expect(within(rail).getByRole("button", { name: "الأشخاص" })).toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: "التصنيع" })).not.toBeInTheDocument();
  });
});

describe("AppLayout — «الباقة والاستخدام» follows the edition", () => {
  afterEach(() => {
    persistSession(null);
  });

  async function billingEntryOffered(features: Record<string, boolean>) {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /entitlements": () => ({ body: { ...entitlements, features } }),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
    });
    renderLayout(transport, ["/dashboard"]);
    const rail = await screen.findByRole("navigation", { name: "التنقل بين مساحات العمل" });
    await waitFor(() => expect(within(rail).getByRole("button", { name: "المالية والإقفال" })).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: /بحث وأوامر/ }));
    await screen.findByText("صندوق الوارد");
    return screen.queryAllByText("الباقة والاستخدام").length > 0;
  }

  it("offers it to a cloud tenant", async () => {
    expect(await billingEntryOffered({ [SUBSCRIPTION_BILLING_FEATURE]: true })).toBe(true);
  });

  it("does not offer it under an on-premises licence, where there is no subscription to show", async () => {
    expect(await billingEntryOffered({})).toBe(false);
  });
});

describe("AppLayout — HR lookups follow the plan (D-SAAS-03)", () => {
  afterEach(() => {
    persistSession(null);
  });

  function recordingTransport(activeModules: EntitlementsDTO["activeModules"]): { transport: Transport; requests: string[] } {
    const requests: string[] = [];
    const answer = stubTransport({
      ...baseHandlers(),
      "GET /entitlements": () => ({ body: { ...entitlements, activeModules } }),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /hr/employees": () => ({ body: [] }),
      "GET /hr/job-titles": () => ({ body: [] }),
    });
    return {
      requests,
      transport: (path, init) => {
        requests.push(path);
        return answer(path, init);
      },
    };
  }

  it("still loads employees and job titles on a plan without HR — the staff list is free on every plan", async () => {
    const { transport, requests } = recordingTransport(["sales", "accounting"]);
    renderLayout(transport, ["/dashboard"]);

    await waitFor(() => expect(requests).toContain("/hr/employees"));
    expect(requests).toContain("/hr/job-titles");
    // Nothing from a paid HR part is asked for.
    expect(requests.filter((path) => /^\/hr\/(payroll|contracts|attendance|leave|advances)/.test(path))).toEqual([]);
  });

  it("still loads them for the user form when the plan includes HR", async () => {
    const { transport, requests } = recordingTransport(["sales", "accounting", "hr"]);
    renderLayout(transport, ["/dashboard"]);

    await waitFor(() => expect(requests).toContain("/hr/employees"));
    expect(requests).toContain("/hr/job-titles");
  });
});

describe("AppLayout — a module the plan left read-only is still read (D-SAAS-03)", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("still loads employees and job titles when HR is read-only on the plan", async () => {
    const requests: string[] = [];
    const answer = stubTransport({
      ...baseHandlers(),
      "GET /entitlements": () => ({ body: { ...entitlements, activeModules: ["sales", "accounting"], readOnlyModules: ["hr"] } }),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /hr/employees": () => ({ body: [] }),
      "GET /hr/job-titles": () => ({ body: [] }),
    });
    renderLayout((path, init) => {
      requests.push(path);
      return answer(path, init);
    }, ["/dashboard"]);

    await waitFor(() => expect(requests).toContain("/hr/employees"));
    expect(requests).toContain("/hr/job-titles");
  });
});

describe("AppLayout — a direct address to a screen the licence does not carry", () => {
  afterEach(() => {
    persistSession(null);
  });

  function open(screenKey: Parameters<typeof pathForRoute>[0], activeModules: string[]): void {
    renderLayout(stubTransport({ ...baseHandlers(), "GET /entitlements": () => ({ body: { ...entitlements, activeModules } }) }), [pathForRoute(screenKey)]);
  }

  it("shows the server's own sentence for that module and nothing else — the screen is not mounted and the block carries no button", async () => {
    open("sales-invoices", entitlements.activeModules.filter((module) => module !== "sales"));

    const refusal = await screen.findByTestId("module-not-licensed");
    expect(refusal.textContent).toBe(moduleNotLicensedMessageAr("sales", undefined));
    expect(refusal).toHaveTextContent("وحدة المبيعات");
    expect(within(refusal).getByRole("heading", { level: 1 }).textContent).toBe(moduleNotLicensedMessageAr("sales", undefined));
    expect(screen.queryByTestId("location-probe")).not.toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryAllByRole("button")).toEqual([]);
  });

  it("names the plan the way the server's refusal does when the licence states one", async () => {
    renderLayout(stubTransport({ ...baseHandlers(), "GET /entitlements": () => ({ body: { ...entitlements, planNameAr: "الأعمال", activeModules: entitlements.activeModules.filter((module) => module !== "hr") } }) }), [pathForRoute("payroll")]);

    // The staff list is free; payroll is the part this plan lacks, and the refusal names it.
    const refusal = await screen.findByTestId("module-not-licensed");
    expect(refusal.textContent).toBe("جزء الرواتب من الموارد البشرية ليس ضمن باقة «الأعمال». يمكنكم إضافته بترقية الباقة من صفحة الاشتراك.");
  });

  it("opens the screen as before when the licence carries its module", async () => {
    open("sales-invoices", [...entitlements.activeModules]);
    expect(await screen.findByTestId("location-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("module-not-licensed")).not.toBeInTheDocument();
  });

  it("a screen that belongs to no module is never refused on the licence", async () => {
    open("dashboard", ["dashboard"]);
    expect(await screen.findByTestId("location-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("module-not-licensed")).not.toBeInTheDocument();
  });
});

describe("AppLayout — the shell asks about notifications only where the licence carries them", () => {
  afterEach(() => {
    persistSession(null);
  });

  function signedIn(activeModules: string[]): string[] {
    const requests: string[] = [];
    const answer = stubTransport({
      ...baseHandlers(),
      "GET /entitlements": () => ({ body: { ...entitlements, activeModules } }),
      "GET /notifications/unread-count": () => ({ body: { count: 3 } }),
      "GET /notifications": () => ({ body: [] }),
    });
    renderLayout((path, init) => {
      requests.push(path.split("?")[0]!);
      return answer(path, init);
    });
    return requests;
  }

  it("a Core licence without the notifications module never sends the unread count it would be refused", async () => {
    const requests = signedIn(entitlements.activeModules.filter((module) => module !== "notifications"));
    await waitFor(() => expect(requests).toContain("/entitlements"));
    await waitFor(() => expect(requests).toContain("/branches"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(requests.filter((path) => path.startsWith("/notifications"))).toEqual([]);
  });

  it("a licence that carries the module still polls it", async () => {
    const requests = signedIn([...entitlements.activeModules]);
    await waitFor(() => expect(requests).toContain("/notifications/unread-count"));
  });
});

describe("AppLayout — a backend that is still starting is its own state, never the sign-in form", () => {
  afterEach(() => {
    persistSession(null);
    clearTenantCode();
    localStorage.clear();
  });

  const unclaimed = { accounts: 95, taxRates: 3, branches: 1, warehouses: 1, fiscalPeriods: 12, users: 1, claimed: false };

  function boot(status: () => { status?: number; body: unknown }, onStatusAsked: () => void = () => undefined): { asked: () => number; entitlementsAnswered: () => number } {
    let asked = 0;
    let entitlementsAnswered = 0;
    const whileOpening = <T,>(body: T): { status?: number; body: unknown } => {
      const answer = status();
      return answer.status === 503 ? answer : { body };
    };
    const answer = stubTransport({
      "GET /platform/resolve": () => ({ status: 404, body: { error: "NOT_FOUND" } }),
      "GET /bootstrap/status": () => {
        asked += 1;
        onStatusAsked();
        return status();
      },
      "GET /entitlements": () => {
        const reply = whileOpening(entitlements);
        if (reply.status !== 503) entitlementsAnswered += 1;
        return reply;
      },
      "GET /tenant": () => whileOpening({ name: "Mezan" }),
    });
    renderLayout(answer, ["/dashboard"], null);
    return { asked: () => asked, entitlementsAnswered: () => entitlementsAnswered };
  }

  it("the very first launch waits in Arabic while the database is seeded, then opens the wizard — the sign-in form is never shown", async () => {
    let ready = false;
    const seenSignIn: boolean[] = [];
    const { asked, entitlementsAnswered } = boot(
      () => (ready ? { body: unclaimed } : { status: 503, body: { error: "BACKEND_STARTING", message: "جارٍ تشغيل قاعدة البيانات. ستفتح الشاشة تلقائياً خلال ثوانٍ." } }),
      () => seenSignIn.push(screen.queryByRole("button", { name: "دخول" }) !== null),
    );

    expect(await screen.findByRole("status", { name: "جاري تجهيز النظام…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "دخول" })).not.toBeInTheDocument();
    await waitFor(() => expect(asked()).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
    expect(screen.getByRole("status", { name: "جاري تجهيز النظام…" })).toBeInTheDocument();

    ready = true;

    expect(await screen.findByRole("heading", { name: "معالج الإعداد الأولي" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "جاري تجهيز النظام…" })).not.toBeInTheDocument();
    expect(seenSignIn.slice(1)).not.toContain(true);
    await waitFor(() => expect(entitlementsAnswered()).toBeGreaterThanOrEqual(1), { timeout: 5_000 });
  }, 20_000);

  it("the pre-update backup is the same waiting state", async () => {
    boot(() => ({ status: 503, body: { error: "STARTUP_BUSY", message: "جارٍ أخذ نسخة احتياطية من قاعدة البيانات قبل تحديثها." } }));
    const waiting = await screen.findByRole("status", { name: "جاري تجهيز النظام…" });
    expect(waiting).toHaveTextContent("جارٍ أخذ نسخة احتياطية من قاعدة البيانات قبل تحديثها.");
  });

  it("an upgrade that rolled back is a screen that says the data is untouched, and it is not retried", async () => {
    const refusal = "تعذّر تحديث قاعدة البيانات إلى هذا الإصدار من ميزان. بياناتك لم تُمَسّ.\nنسخة ما قبل التحديث: /backups/pre-update.mezanbak";
    const { asked } = boot(() => ({ status: 503, body: { error: "SCHEMA_UPGRADE_FAILED", message: refusal, messageEn: "The database could not be upgraded." } }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("بياناتك لم تُمَسّ");
    expect(alert).toHaveTextContent("/backups/pre-update.mezanbak");
    expect(screen.queryByRole("button", { name: "دخول" })).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(asked()).toBe(1);
  });

  it("a backend that simply answers keeps opening the sign-in form as before", async () => {
    boot(() => ({ body: { ...unclaimed, claimed: true } }));
    expect(await screen.findByRole("button", { name: "دخول" })).toBeInTheDocument();
  });
});

describe("AppLayout — nothing tenant-scoped is asked before a company is known (D-SAAS-06)", () => {
  afterEach(() => {
    persistSession(null);
    clearTenantCode();
    localStorage.clear();
  });

  function signedOut(resolve: () => { status?: number; body: unknown }, claimed = true): string[] {
    const requests: string[] = [];
    const answer = stubTransport({
      "GET /platform/resolve": resolve,
      "GET /bootstrap/status": () => ({ body: { accounts: 1, taxRates: 1, branches: 1, warehouses: 1, fiscalPeriods: 1, users: 1, claimed } }),
      "GET /entitlements": () => ({ body: entitlements }),
      "GET /tenant": () => ({ body: { name: "Mezan" } }),
    });
    renderLayout(
      (path, init) => {
        requests.push(path);
        return answer(path, init);
      },
      ["/dashboard"],
      null,
    );
    return requests;
  }

  it("sends nothing but the company lookup from a cloud sign-in screen with no company code, then asks once a code is confirmed", async () => {
    clearTenantCode();
    const requests = signedOut(() => ({ body: { mode: "code", exists: false } }));

    expect(await screen.findByRole("textbox", { name: "رمز المنشأة" })).toBeInTheDocument();
    await waitFor(() => expect(requests).toContain("/platform/resolve"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.filter((path) => !path.startsWith("/platform/resolve"))).toEqual([]);

    act(() => persistTenantCode("acme"));

    await waitFor(() => expect(requests).toContain("/bootstrap/status"));
    expect(requests).toContain("/entitlements");
  });

  it("asks straight away on a subdomain, where the address is the company", async () => {
    clearTenantCode();
    const requests = signedOut(() => ({ body: { mode: "subdomain", exists: true } }));

    await waitFor(() => expect(requests).toContain("/bootstrap/status"));
    expect(requests).toContain("/entitlements");
  });

  it("asks straight away on a single-company backend with no platform in front, and still opens the first-run wizard there", async () => {
    clearTenantCode();
    const requests = signedOut(() => ({ status: 404, body: { error: "NOT_FOUND" } }), false);

    await waitFor(() => expect(requests).toContain("/bootstrap/status"));
    expect(requests).toContain("/entitlements");
    expect(await screen.findByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();
  });

  it.each([
    ["is failing", 503],
    ["is throttling this address", 429],
  ])("opens sign-in at once while the company lookup %s, asks nothing tenant-scoped until a company is known, and goes on by itself once the lookup answers", async (_what, status) => {
    vi.useFakeTimers();
    try {
      clearTenantCode();
      let failing = true;
      const requests = signedOut(() => (failing ? { status, body: { error: "UPSTREAM" } } : { body: { mode: "subdomain", exists: true } }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(screen.getByLabelText(/^كلمة المرور/)).toBeEnabled();
      expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(requests.filter((path) => path === "/bootstrap/status" || path === "/entitlements" || path === "/tenant")).toEqual([]);

      failing = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(PLATFORM_LOOKUP_FIRST_RETRY_MS); });

      await vi.waitFor(() => expect(requests).toContain("/bootstrap/status"));
      expect(requests).toContain("/entitlements");
      expect(requests.filter((path) => path === "/platform/resolve")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the tenant-scoped questions under a company the person confirmed, even though the lookup is still failing", async () => {
    clearTenantCode();
    const requests = signedOut(() => ({ status: 503, body: { error: "UPSTREAM" } }));
    await screen.findByRole("textbox", { name: "رمز المنشأة" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.filter((path) => !path.startsWith("/platform/resolve"))).toEqual([]);

    act(() => persistTenantCode("acme"));

    await waitFor(() => expect(requests).toContain("/bootstrap/status"));
    expect(requests).toContain("/entitlements");
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

describe("AppLayout — a session holding a temporary password", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("shows only the change-password screen and never asks for the page behind it", async () => {
    const asked: string[] = [];
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /users": (_init, path) => {
        asked.push(path);
        return { body: [] };
      },
    });
    renderLayout(transport, [pathForRoute("users")], { ...testAdminSession, mustChangePassword: true });

    expect(await screen.findByRole("heading", { name: "غيّر كلمة المرور المؤقتة" })).toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it("switches to the change-password screen when the server answers PASSWORD_CHANGE_REQUIRED mid-session", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ status: 403, body: { error: PasswordChangeRefusal.Required, message: "يجب تغيير كلمة المرور المؤقتة قبل المتابعة." } }),
    });
    renderLayout(transport, [pathForRoute("users")]);

    expect(await screen.findByRole("heading", { name: "غيّر كلمة المرور المؤقتة" })).toBeInTheDocument();
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

  it("'الإعداد الأولي' on the login screen of an install nobody has claimed opens the first-run wizard, and its own cancel returns to sign-in", async () => {
    const transport = stubTransport({
      "GET /bootstrap/status": () => ({ body: { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0, claimed: false } }),
    });
    renderLayout(transport, ["/dashboard"], null);
    fireEvent.click(await screen.findByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));

    fireEvent.click(await screen.findByRole("button", { name: "الإعداد الأولي" }));
    expect(await screen.findByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(await screen.findByRole("button", { name: "الإعداد الأولي" })).toBeInTheDocument();
  });

  it("offers no first-run wizard on the login screen of an install that already has an owner", async () => {
    const asked: string[] = [];
    const answer = stubTransport({
      "GET /bootstrap/status": () => ({ body: { accounts: 5, taxRates: 2, branches: 1, warehouses: 1, fiscalPeriods: 1, users: 2, claimed: true } }),
    });
    renderLayout((path, init) => (asked.push(path), answer(path, init)), ["/dashboard"], null);

    await waitFor(() => expect(asked).toContain("/bootstrap/status"));
    await screen.findByLabelText(/^كلمة المرور/);
    expect(screen.queryByRole("button", { name: "الإعداد الأولي" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "معالج الإعداد الأولي" })).not.toBeInTheDocument();
  });

  it("walking every wizard step through to 'إنهاء والانتقال إلى النظام' calls onFinish, which lands the app on the real shell", async () => {
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /tenant": () => ({ body: { name: "Cyag" } }),
      "GET /bootstrap/status": () => ({ body: { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0, claimed: false } }),
      "POST /bootstrap/admin": () => ({ body: testAdminSession }),
      "POST /bootstrap/seed": () => ({ body: { accounts: 5, taxRates: 2, branches: 1, warehouses: 1, fiscalPeriods: 1, users: 1 } }),
    });
    renderLayout(transport, ["/dashboard"], null);
    fireEvent.click(await screen.findByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));

    fireEvent.click(await screen.findByRole("button", { name: "الإعداد الأولي" }));

    // Step 1 — the licence, which is a FILE and never blocks the step
    // (guards L-5: the old step reported its own success and gated «التالي»).
    fireEvent.click(await screen.findByRole("button", { name: "التالي" }));

    // Step 2 — admin account.
    fireEvent.change(await screen.findByLabelText("اسم المنشأة", { exact: false }), { target: { value: "متجر الاختبار" } });
    fireEvent.change(screen.getByLabelText("الاسم الكامل"), { target: { value: "مدير النظام" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني", { exact: false }), { target: { value: "admin@cyag.example" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "Cyag@2026" } });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), { target: { value: "Cyag@2026" } });
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

  it("the wizard a fresh install opens by itself runs every step it shows — creating the owner does not drop into the dashboard", async () => {
    let claimed = false;
    const transport = stubTransport({
      ...baseHandlers(),
      "GET /roles": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
      "GET /tenant": () => ({ body: { name: "Cyag" } }),
      "GET /bootstrap/status": () => ({ body: { accounts: 95, taxRates: 3, branches: 1, warehouses: 1, fiscalPeriods: 12, users: 1, roles: 12, claimed } }),
      "POST /bootstrap/admin": () => {
        claimed = true;
        return { body: testAdminSession };
      },
    });
    renderLayout(transport, ["/dashboard"], null);

    const stepper = await screen.findByRole("list", { name: "خطوات معالج الإعداد" });
    const shown = within(stepper).getAllByRole("listitem").length;
    fireEvent.click(await screen.findByRole("button", { name: "التالي" }));
    fireEvent.change(await screen.findByLabelText("اسم المنشأة", { exact: false }), { target: { value: "متجر الاختبار" } });
    fireEvent.change(screen.getByLabelText("الاسم الكامل"), { target: { value: "مدير النظام" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني", { exact: false }), { target: { value: "owner@cyag.example" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "Cyag@2026" } });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), { target: { value: "Cyag@2026" } });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    let visited = 2;
    expect(await screen.findByRole("region", { name: "تهيئة البيانات الأساسية" })).toBeInTheDocument();
    visited += 1;
    expect(screen.queryByRole("button", { name: "ميزان — الذهاب إلى لوحة التحكم" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(await screen.findByRole("button", { name: "إنهاء والانتقال إلى النظام" })).toBeInTheDocument();
    visited += 1;
    expect(visited).toBe(shown);

    fireEvent.click(screen.getByRole("button", { name: "إنهاء والانتقال إلى النظام" }));
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

describe("AppLayout — a branch-restricted session (D111)", () => {
  afterEach(() => {
    cleanup();
    persistSession(null);
  });

  const branchSession: Session = { ...testAdminSession, userId: "USER-ALEX", isCompanyAdmin: false, branchScope: ["BR2"] };
  const CONTRACTING_WORKSPACE = "المقاولات";

  it("a direct address to a company-wide screen shows why it is not available, in Arabic, and does not mount the screen", async () => {
    renderLayout(stubTransport(baseHandlers()), [pathForRoute("projects")], branchSession);
    const state = await screen.findByTestId("branch-unavailable");
    expect(within(state).getByRole("heading")).toHaveTextContent("غير متاحة لحساب مقيّد بفروع");
    expect(screen.queryByTestId("intent-probe")).not.toBeInTheDocument();
  });

  it("the same address opens the screen for a session that holds every branch", async () => {
    renderLayout(stubTransport(baseHandlers()), [pathForRoute("projects")]);
    expect(await screen.findByTestId("intent-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("branch-unavailable")).not.toBeInTheDocument();
  });

  it("a shared configuration screen opens, under a notice that it is read-only for this account", async () => {
    renderLayout(stubTransport(baseHandlers()), [pathForRoute("price-lists")], branchSession);
    expect(await screen.findByTestId("intent-probe")).toBeInTheDocument();
    expect(screen.getByTestId("branch-read-only")).toHaveTextContent("للعرض فقط");
  });

  it("a daily screen opens with neither", async () => {
    renderLayout(stubTransport(baseHandlers()), [pathForRoute("sales-invoices")], branchSession);
    expect(await screen.findByTestId("intent-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("branch-read-only")).not.toBeInTheDocument();
    expect(screen.queryByTestId("branch-unavailable")).not.toBeInTheDocument();
  });

  it("the workspace bar drops the workspace whose every screen is company-wide, and keeps the daily ones", async () => {
    renderLayout(stubTransport(baseHandlers()), ["/dashboard"], branchSession);
    await screen.findByTestId("intent-probe");
    expect(await screen.findByRole("button", { name: "البيع والتحصيل" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CONTRACTING_WORKSPACE })).not.toBeInTheDocument();
  });

  it("and shows that workspace to a session that holds every branch", async () => {
    renderLayout(stubTransport(baseHandlers()), ["/dashboard"]);
    expect(await screen.findByRole("button", { name: CONTRACTING_WORKSPACE })).toBeInTheDocument();
  });

  it("refuses a company-wide read before it leaves the device, with the server's own code", async () => {
    const calls: string[] = [];
    const transport: Transport = (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      return stubTransport(baseHandlers())(path, init);
    };
    function Probe() {
      const { request } = useApi();
      const [answer, setAnswer] = useState("");
      useEffect(() => {
        void (async () => {
          const read = await request("/projects");
          const write = await request("/price-lists", { method: "POST", body: "{}" });
          const body = await read.json<{ error: string; message: string }>();
          setAnswer(`${read.status} ${body.error} ${body.message} | ${write.status}`);
        })();
      }, [request]);
      return <div data-testid="answer">{answer}</div>;
    }
    render(
      <AppProviders transport={transport} initialSession={branchSession}>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("403 COMPANY_WIDE_REPORT"));
    expect(screen.getByTestId("answer")).toHaveTextContent("على مستوى الشركة");
    expect(screen.getByTestId("answer")).toHaveTextContent("| 403");
    expect(calls.filter((call) => call.includes("/projects") || call.includes("/price-lists"))).toEqual([]);
  });
});

describe("AppLayout — page-change progress", () => {
  afterEach(() => {
    persistSession(null);
  });

  it("shows the progress bar only while the next page is still loading", async () => {
    let finish: () => void = () => {};
    const router = createMemoryRouter(
      [
        {
          path: "/",
          Component: AppLayout,
          children: [
            {
              path: "slow/*",
              loader: () => new Promise<null>((resolve) => (finish = () => resolve(null))),
              element: <div data-testid="slow-page" />,
            },
            { path: "*", element: <IntentProbe /> },
          ],
        },
      ],
      { initialEntries: [pathForRoute("dashboard")] },
    );
    render(
      <AppProviders transport={stubTransport(baseHandlers())} initialSession={testAdminSession}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    const bar = await screen.findByRole("progressbar", { hidden: true });
    expect(bar).toHaveAttribute("aria-hidden", "true");

    act(() => void router.navigate("/slow"));
    await waitFor(() => expect(bar).toHaveAttribute("aria-hidden", "false"));

    await act(async () => finish());
    expect(await screen.findByTestId("slow-page")).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-hidden", "true");
  });
});

describe("AppLayout — preloading on intent", () => {
  afterEach(() => {
    persistSession(null);
    vi.mocked(preloadScreen).mockClear();
  });

  it("starts loading a destination when the pointer reaches its tab, home icon or row", async () => {
    renderLayout(stubTransport(baseHandlers()), [pathForRoute("dashboard")]);
    const rail = await screen.findByRole("navigation", { name: "التنقل بين مساحات العمل" });

    fireEvent.pointerEnter(within(rail).getByRole("button", { name: "البيع والتحصيل" }));
    expect(preloadScreen).toHaveBeenLastCalledWith("sales-hub");

    fireEvent.focus(screen.getByRole("button", { name: "لوحة التحكم" }));
    expect(preloadScreen).toHaveBeenLastCalledWith("dashboard");

    fireEvent.click(screen.getByRole("button", { name: "كل الشاشات" }));
    const results = screen.getByRole("dialog", { name: "كل الشاشات" }).querySelector<HTMLElement>('nav[aria-label="تصفية حسب مساحة العمل"] + div')!;
    fireEvent.pointerEnter(within(results).getByRole("button", { name: "العملاء" }));
    expect(preloadScreen).toHaveBeenLastCalledWith("customers");
  });
});
