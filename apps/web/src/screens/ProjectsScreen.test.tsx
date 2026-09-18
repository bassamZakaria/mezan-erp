// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CustomerDTO, ProjectDTO, UserDTO } from "@mezan/contracts";
import { ProjectsScreen } from "./ProjectsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * `Field` renders its `<label>` as a sibling of the control, not wrapping it,
 * and never wires `htmlFor`/`id` — so `getByLabelText` cannot resolve a
 * `TextField`. Locate the control by walking from the visible label text.
 */
function fieldInput(container: HTMLElement, label: string | RegExp): HTMLElement {
  const labelEl = within(container).getByText(label);
  const control = labelEl.parentElement?.querySelector("input, textarea, select");
  if (!control) throw new Error(`no control found for label "${label}"`);
  return control as HTMLElement;
}

const sampleCustomers: CustomerDTO[] = [
  {
    id: "cust-1",
    code: "C-001",
    nameAr: "شركة الأفق",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 0,
    currency: "EGP",
    openingBalance: "0.000000",
    active: true,
    priceListId: null,
    creditLimit: "0.000000",
    taxExempt: false,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  },
];

const sampleUsers: UserDTO[] = [
  {
    id: "user-1",
    nameAr: "أحمد المهندس",
    nameEn: null,
    email: "ahmed@example.com",
    phone: null,
    roleId: null,
    isCompanyAdmin: false,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    photoUrl: null,
    hasPin: false,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const sampleProjects: ProjectDTO[] = [
  {
    id: "prj-1",
    code: "TOWER-A",
    nameAr: "برج الأفق",
    nameEn: null,
    status: "planned",
    customerId: "cust-1",
    managerId: "user-1",
    startDate: "2026-01-01",
    endDate: null,
    budget: "500000.000000",
    siteAddress: "القاهرة الجديدة",
    notes: null,
    costCenterId: "CC-PRJ-TOWER-A",
  },
  {
    id: "prj-2",
    code: "VILLA-B",
    nameAr: "فيلا النخيل",
    nameEn: null,
    status: "active",
    customerId: null,
    managerId: null,
    startDate: null,
    endDate: null,
    budget: "120000.000000",
    siteAddress: null,
    notes: null,
    costCenterId: "CC-PRJ-VILLA-B",
  },
];

function renderScreen(projects: ProjectDTO[] = sampleProjects) {
  let current = [...projects];
  const transport = stubTransport({
    "GET /projects": () => ({ body: current }),
    "GET /customers": () => ({ body: sampleCustomers }),
    "GET /users": () => ({ body: sampleUsers }),
    "POST /projects": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((p) => p.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_PROJECT_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: ProjectDTO = {
        ...body,
        nameEn: body.nameEn ?? null,
        status: "planned",
        customerId: body.customerId ?? null,
        managerId: body.managerId ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        budget: body.budget ?? "0.000000",
        siteAddress: body.siteAddress ?? null,
        notes: body.notes ?? null,
        costCenterId: `CC-PRJ-${body.code}`,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /projects/prj-1": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: ProjectDTO = { ...current[0]!, ...patch };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<ProjectsScreen />, { transport, initialSession: testAdminSession });
}

describe("ProjectsScreen", () => {
  it("lists projects from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "المقاولات" })).toBeInTheDocument();
    expect(await screen.findByText("برج الأفق")).toBeInTheDocument();
    expect(screen.getByText("فيلا النخيل")).toBeInTheDocument();
    expect(screen.getByText("شركة الأفق")).toBeInTheDocument();
    expect(screen.getByText("أحمد المهندس")).toBeInTheDocument();
  });

  it("shows an empty state when there are no projects yet", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد مشاريع/)).toBeInTheDocument();
  });

  it("filters the list by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("برج الأفق");
    fireEvent.click(screen.getByRole("tab", { name: /^نشط/ }));
    await waitFor(() => expect(screen.queryByText("برج الأفق")).not.toBeInTheDocument());
    expect(screen.getByText("فيلا النخيل")).toBeInTheDocument();
  });

  it("creates a new project through the side panel", async () => {
    renderScreen();
    await screen.findByText("برج الأفق");
    fireEvent.click(screen.getByRole("button", { name: "مشروع جديد" }));

    const dialog = screen.getByRole("dialog", { name: "مشروع جديد" });
    fireEvent.change(fieldInput(dialog, /^كود المشروع \*/), { target: { value: "MALL-C" } });
    fireEvent.change(fieldInput(dialog, "اسم المشروع *"), { target: { value: "مول وسط البلد" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("مول وسط البلد")).toBeInTheDocument();
  });

  it("rejects a duplicate project code with an inline error", async () => {
    renderScreen();
    await screen.findByText("برج الأفق");
    fireEvent.click(screen.getByRole("button", { name: "مشروع جديد" }));
    const dialog = screen.getByRole("dialog", { name: "مشروع جديد" });
    fireEvent.change(fieldInput(dialog, /^كود المشروع \*/), { target: { value: "TOWER-A" } });
    fireEvent.change(fieldInput(dialog, "اسم المشروع *"), { target: { value: "نسخة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the project detail panel on row click and changes its status", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("برج الأفق"));

    const detail = screen.getByRole("dialog", { name: /مشروع —/ });
    expect(within(detail).getByText("CC-PRJ-TOWER-A")).toBeInTheDocument();

    // `Select` is a custom combobox whose option list renders in a body portal,
    // outside the dialog's own DOM subtree — open it, then pick from `screen`.
    fireEvent.click(within(detail).getByRole("combobox", { name: "الحالة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "نشط" }));
    fireEvent.click(within(detail).getByRole("button", { name: "حفظ" }));

    expect((await within(detail).findAllByText("نشط")).length).toBeGreaterThan(0);
  });
});

/** guards §4.5 #13 — the error card shows the SERVER's reason, not the screen's fixed sentence. */
describe("ProjectsScreen — a 502 body reaches the error card", () => {
  it("renders the server's own Arabic reason", async () => {
    renderWithProviders(
      <ProjectsScreen />,
      {
        transport: stubTransport({
          "GET /projects": () => ({ status: 502, body: { message: "تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة." } }),
          "GET /customers": () => ({ body: [] }),
          "GET /users": () => ({ body: [] }),
        }),
        initialSession: testAdminSession,
      },
    );

    expect(await screen.findByText("تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة.")).toBeInTheDocument();
  });
});
