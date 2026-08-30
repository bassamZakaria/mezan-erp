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
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { EntitlementsDTO, RoleDTO, UserDTO } from "@mezan/contracts";
import { AppLayout } from "./AppLayout";
import { AppProviders } from "./data/AppProviders";
import { persistSession } from "./data/session";
import { stubTransport, testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";
import { useNavigation } from "./navigation";
import { pathForRoute } from "./routing";

function IntentProbe() {
  const nav = useNavigation();
  return <div data-testid="intent-probe">{JSON.stringify(nav.intent)}</div>;
}

function renderLayout(transport: Transport, initialEntries: string[] = ["/dashboard"]) {
  const router = createMemoryRouter(
    [{ path: "/", Component: AppLayout, children: [{ path: "*", element: <IntentProbe /> }] }],
    { initialEntries },
  );
  return render(
    <AppProviders transport={transport} initialSession={testAdminSession}>
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
  activeModules: ["sales", "purchasing", "inventory", "accounting", "treasury", "hr", "manufacturing", "crm", "assets"],
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
    expect((seenBody as { branchScope: unknown }).branchScope).toBe("*");

    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم آخر" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني *", { exact: false }), { target: { value: "another@cyag.test" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "الفرع الرئيسي" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    await screen.findByRole("button", { name: "إضافة مستخدم" });
    expect((seenBody as { branchScope: unknown }).branchScope).toEqual(["MAIN"]);
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
    fireEvent.click(screen.getByRole("button", { name: "حفظ الدور" }));

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
});
