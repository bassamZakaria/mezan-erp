// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { LeadDTO, PipelineStageDTO } from "@mezan/contracts";
import { LeadsScreen } from "./LeadsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

const sampleLeads: LeadDTO[] = [
  {
    id: "lead-1",
    name: "أحمد سالم",
    company: "شركة النور",
    email: "ahmed@example.com",
    phone: "01000000000",
    source: "website",
    expectedValue: "5000.000000",
    interest: "نظام محاسبي",
    notes: null,
    status: "new",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "lead-2",
    name: "منى فتحي",
    company: "مؤسسة الأمل",
    email: null,
    phone: null,
    source: "referral",
    expectedValue: null,
    interest: null,
    notes: null,
    status: "qualified",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-02T00:00:00.000Z",
  },
  {
    id: "lead-3",
    name: "سارة عادل",
    company: null,
    email: null,
    phone: null,
    source: "phone",
    expectedValue: null,
    interest: null,
    notes: "تحتاج متابعة أسبوعية",
    status: "converted",
    convertedCustomerId: "cust-9",
    convertedOpportunityId: "opp-9",
    createdAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "lead-4",
    name: "كريم عادل",
    company: "متجر الوفاء",
    email: null,
    phone: null,
    source: "other",
    expectedValue: null,
    interest: null,
    notes: null,
    status: "new",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-04T00:00:00.000Z",
  },
];

const sampleStages: PipelineStageDTO[] = [
  { id: "stage-1", name: "عميل محتمل", order: 1, defaultProbability: 10, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-2", name: "تم الإغلاق", order: 6, defaultProbability: 100, color: "#22c55e", isWinStage: true, isLossStage: false, active: true },
];

interface RenderOptions {
  leads?: LeadDTO[];
  stages?: PipelineStageDTO[];
  extraHandlers?: Record<string, (init: RequestInit | undefined, path: string) => StubResult>;
  route?: string;
}

function renderScreen(options: RenderOptions = {}) {
  let current = [...(options.leads ?? sampleLeads)];
  const calls: Record<string, number> = {};
  function track(key: string) {
    calls[key] = (calls[key] ?? 0) + 1;
  }
  function transitionHandler(id: string) {
    return (init: RequestInit | undefined): StubResult => {
      track(`${id}-transition`);
      const body = JSON.parse((init?.body as string) ?? "{}");
      current = current.map((l) => (l.id === id ? { ...l, status: body.status } : l));
      return { body: current.find((l) => l.id === id)! };
    };
  }
  const transport = stubTransport({
    "GET /crm/leads": () => ({ body: current }),
    "GET /crm/pipeline-stages": () => ({ body: options.stages ?? sampleStages }),
    "POST /crm/leads": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: LeadDTO = {
        id: body.id,
        name: body.name,
        company: body.company ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        source: body.source ?? "other",
        expectedValue: body.expectedValue ?? null,
        interest: body.interest ?? null,
        notes: body.notes ?? null,
        status: "new",
        convertedCustomerId: null,
        convertedOpportunityId: null,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /crm/leads/lead-1/transition": transitionHandler("lead-1"),
    "POST /crm/leads/lead-2/transition": transitionHandler("lead-2"),
    "POST /crm/leads/lead-4/transition": transitionHandler("lead-4"),
    "POST /crm/leads/lead-2/convert": () => {
      track("lead-2-convert");
      const updated = { ...current.find((l) => l.id === "lead-2")!, status: "converted" as const, convertedCustomerId: "cust-1", convertedOpportunityId: "opp-1" };
      current = current.map((l) => (l.id === "lead-2" ? updated : l));
      return { body: { lead: updated, customerId: "cust-1", opportunityId: "opp-1" } };
    },
    ...(options.extraHandlers ?? {}),
  });
  const view = renderWithProviders(<LeadsScreen />, { transport, initialSession: testAdminSession, route: options.route });
  return { ...view, getCurrent: () => current, getCalls: () => calls };
}

describe("LeadsScreen — create form validation", () => {
  it("requires a name before creating a lead", async () => {
    let createCalls = 0;
    renderScreen({
      extraHandlers: {
        "POST /crm/leads": () => {
          createCalls += 1;
          return { status: 201, body: sampleLeads[0] };
        },
      },
    });
    await screen.findByText("أحمد سالم");
    fireEvent.click(screen.getByRole("button", { name: "عميل محتمل جديد" }));
    const dialog = screen.getByRole("dialog", { name: "عميل محتمل جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("leads.nameRequired");
    expect(createCalls).toBe(0);
  });

  it("shows a server error message when creating a lead fails", async () => {
    renderScreen({
      extraHandlers: {
        "POST /crm/leads": () => ({ status: 400, body: { message: "تعذّر إنشاء العميل المحتمل — الحد الأقصى وصل." } }),
      },
    });
    await screen.findByText("أحمد سالم");
    fireEvent.click(screen.getByRole("button", { name: "عميل محتمل جديد" }));
    const dialog = screen.getByRole("dialog", { name: "عميل محتمل جديد" });
    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "هالة كريم" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("تعذّر إنشاء العميل المحتمل — الحد الأقصى وصل.");
    expect(dialog).toBeInTheDocument();
  });

  it("creates a lead with every optional field filled in", async () => {
    let posted: Record<string, unknown> | null = null;
    renderScreen({
      extraHandlers: {
        "POST /crm/leads": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { status: 201, body: { ...sampleLeads[0]!, id: "lead-new" } };
        },
      },
    });
    await screen.findByText("أحمد سالم");
    fireEvent.click(screen.getByRole("button", { name: "عميل محتمل جديد" }));
    const dialog = screen.getByRole("dialog", { name: "عميل محتمل جديد" });

    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "هالة كريم" } });
    fireEvent.change(within(dialog).getByLabelText("الشركة"), { target: { value: "شركة الفجر" } });
    fireEvent.change(within(dialog).getByLabelText("البريد الإلكتروني"), { target: { value: "hala@example.com" } });
    fireEvent.change(within(dialog).getByLabelText("الهاتف"), { target: { value: "01099999999" } });

    const money = within(dialog).getByLabelText("القيمة المتوقعة");
    fireEvent.focus(money);
    fireEvent.change(money, { target: { value: "250" } });
    fireEvent.blur(money);

    fireEvent.change(within(dialog).getByLabelText("الاهتمام"), { target: { value: "نظام مخزون" } });
    fireEvent.change(within(dialog).getByLabelText("ملاحظات"), { target: { value: "تابعنا عبر الموقع" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      name: "هالة كريم",
      company: "شركة الفجر",
      email: "hala@example.com",
      phone: "01099999999",
      expectedValue: "250.000000",
      interest: "نظام مخزون",
      notes: "تابعنا عبر الموقع",
    });
  });
});

describe("LeadsScreen — filtering", () => {
  it("searches leads by name or company", async () => {
    renderScreen();
    await screen.findByText("أحمد سالم");
    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الشركة..."), { target: { value: "الأمل" } });
    await waitFor(() => expect(screen.queryByText("أحمد سالم")).not.toBeInTheDocument());
    expect(screen.getByText("منى فتحي")).toBeInTheDocument();
  });

  it("offers a retry when the lead list fails to load", async () => {
    let attempt = 0;
    renderScreen({
      extraHandlers: {
        "GET /crm/leads": () => {
          attempt += 1;
          return attempt === 1 ? { status: 500, body: { error: "INTERNAL" } } : { body: sampleLeads };
        },
      },
    });
    expect(await screen.findByText("تعذّر تحميل العملاء المحتملين. (رمز 500)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("أحمد سالم")).toBeInTheDocument();
  });
});

describe("LeadsScreen — lead detail fallbacks", () => {
  it("shows a company dash, an added note and a closed-pipeline message for a lead with no next actions", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("سارة عادل"));
    const dialog = screen.getByRole("dialog", { name: "سارة عادل" });
    expect(within(dialog).getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText("تحتاج متابعة أسبوعية")).toBeInTheDocument();
    expect(within(dialog).getByText("لا توجد إجراءات متاحة على هذا العميل المحتمل.")).toBeInTheDocument();
  });
});

describe("LeadsScreen — status transitions", () => {
  it("reports a server error when a status transition is rejected", async () => {
    renderScreen({
      extraHandlers: {
        "POST /crm/leads/lead-1/transition": () => ({
          status: 409,
          body: { message: "لا يمكن تغيير حالة هذا العميل المحتمل الآن." },
        }),
      },
    });
    fireEvent.click(await screen.findByText("أحمد سالم"));
    const dialog = screen.getByRole("dialog", { name: "أحمد سالم" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تم التواصل" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent === "لا يمكن تغيير حالة هذا العميل المحتمل الآن.")).toBe(true);
    // Both the page-level banner and the panel's own copy render while the panel is open.
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    // The pending guard cleared afterwards — the same transition can be retried.
    expect(within(dialog).getByRole("button", { name: "تم التواصل" })).not.toBeDisabled();
  });

  it("ignores a second transition click on a different lead while the first is still in flight", async () => {
    const { getCalls } = renderScreen();
    await screen.findByText("أحمد سالم");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات أحمد سالم" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تم التواصل" }));
    fireEvent.click(screen.getByRole("button", { name: "إجراءات كريم عادل" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تم التواصل" }));

    await waitFor(() => expect(getCalls()["lead-1-transition"]).toBe(1));
    expect(getCalls()["lead-4-transition"]).toBeUndefined();
  });
});

describe("LeadsScreen — converting a lead", () => {
  it("surfaces a server error without closing the dialog when a conversion is refused", async () => {
    renderScreen({
      extraHandlers: {
        "POST /crm/leads/lead-2/convert": () => ({
          status: 422,
          body: { message: "لا يمكن تحويل هذا العميل المحتمل حاليا." },
        }),
      },
    });
    fireEvent.click(await screen.findByText("منى فتحي"));
    const detailDialog = screen.getByRole("dialog", { name: "منى فتحي" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "تحويل" }));

    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));

    expect(await within(convertDialog).findByRole("alert")).toHaveTextContent("لا يمكن تحويل هذا العميل المحتمل حاليا.");
    expect(screen.getByRole("dialog", { name: "تحويل العميل المحتمل" })).toBeInTheDocument();
    expect(within(convertDialog).getByRole("button", { name: "تحويل" })).not.toBeDisabled();
  });

  it("requires a customer code before creating a customer from a lead", async () => {
    let convertCalls = 0;
    renderScreen({
      extraHandlers: {
        "POST /crm/leads/lead-2/convert": () => {
          convertCalls += 1;
          return { body: { lead: sampleLeads[1], customerId: "cust-1", opportunityId: null } };
        },
      },
    });
    fireEvent.click(await screen.findByText("منى فتحي"));
    const detailDialog = screen.getByRole("dialog", { name: "منى فتحي" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "تحويل" }));

    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    fireEvent.change(within(convertDialog).getByLabelText("كود العميل *"), { target: { value: "" } });
    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));

    expect(await within(convertDialog).findByRole("alert")).toHaveTextContent("كود العميل مطلوب لإنشاء عميل جديد.");
    expect(convertCalls).toBe(0);
  });

  it("blocks converting into a pipeline with no active stages", async () => {
    renderScreen({ leads: [sampleLeads[1]!], stages: [] });
    fireEvent.click(await screen.findByText("منى فتحي"));
    const detailDialog = screen.getByRole("dialog", { name: "منى فتحي" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "تحويل" }));

    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));

    expect(await within(convertDialog).findByRole("alert")).toHaveTextContent("عنوان الفرصة والمرحلة مطلوبان لإنشاء فرصة جديدة.");
  });

  it("converts a lead without creating a customer or an opportunity", async () => {
    let posted: Record<string, unknown> | null = null;
    renderScreen({
      extraHandlers: {
        "POST /crm/leads/lead-2/convert": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { body: { lead: { ...sampleLeads[1]!, status: "converted" }, customerId: null, opportunityId: null } };
        },
      },
    });
    fireEvent.click(await screen.findByText("منى فتحي"));
    const detailDialog = screen.getByRole("dialog", { name: "منى فتحي" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "تحويل" }));

    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    expect(within(convertDialog).getByLabelText("كود العميل *")).toBeInTheDocument();
    expect(within(convertDialog).getByLabelText("عنوان الفرصة *")).toBeInTheDocument();

    fireEvent.click(within(convertDialog).getByRole("switch", { name: "إنشاء عميل" }));
    fireEvent.click(within(convertDialog).getByRole("switch", { name: "إنشاء فرصة" }));

    expect(within(convertDialog).queryByLabelText("كود العميل *")).not.toBeInTheDocument();
    expect(within(convertDialog).queryByLabelText("عنوان الفرصة *")).not.toBeInTheDocument();

    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ createCustomer: false, createOpportunity: false });
    expect("customer" in (posted as unknown as Record<string, unknown>)).toBe(false);
    expect("opportunity" in (posted as unknown as Record<string, unknown>)).toBe(false);
  });

  it("converts a lead with an opportunity that has an expected close date", async () => {
    let posted: Record<string, unknown> | null = null;
    renderScreen({
      extraHandlers: {
        "POST /crm/leads/lead-2/convert": (init) => {
          posted = JSON.parse((init?.body as string) ?? "{}");
          return { body: { lead: { ...sampleLeads[1]!, status: "converted" }, customerId: "cust-1", opportunityId: "opp-1" } };
        },
      },
    });
    fireEvent.click(await screen.findByText("منى فتحي"));
    const detailDialog = screen.getByRole("dialog", { name: "منى فتحي" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "تحويل" }));

    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    fireEvent.change(within(convertDialog).getByLabelText("تاريخ الإغلاق المتوقع"), { target: { value: "2026-09-01" } });
    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));

    await waitFor(() => expect(posted).not.toBeNull());
    const opportunity = (posted as unknown as { opportunity: { expectedCloseDate: string } }).opportunity;
    expect(opportunity.expectedCloseDate).toBe("2026-09-01");
  });

  it("refuses to submit a conversion after the lead vanishes from a background refresh", async () => {
    let removeLead2 = false;
    let convertCalls = 0;
    renderScreen({
      extraHandlers: {
        "GET /crm/leads": () => ({ body: removeLead2 ? sampleLeads.filter((l) => l.id !== "lead-2") : sampleLeads }),
        "POST /crm/leads/lead-1/transition": () => {
          removeLead2 = true;
          return { body: { ...sampleLeads[0]!, status: "contacted" } };
        },
        "POST /crm/leads/lead-2/convert": () => {
          convertCalls += 1;
          return { body: { lead: sampleLeads[1], customerId: "cust-1", opportunityId: null } };
        },
      },
    });
    await screen.findByText("منى فتحي");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات منى فتحي" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تحويل" }));
    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });

    fireEvent.click(screen.getByRole("button", { name: "إجراءات أحمد سالم" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تم التواصل" }));

    await waitFor(() => expect(screen.queryByText("منى فتحي")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "تحويل العميل المحتمل" })).toBeInTheDocument();

    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(convertCalls).toBe(0);
    expect(screen.getByRole("dialog", { name: "تحويل العميل المحتمل" })).toBeInTheDocument();
  });
});
