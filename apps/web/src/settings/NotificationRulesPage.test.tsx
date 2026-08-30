// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationRuleDTO } from "@mezan/contracts";
import { NotificationRulesPage } from "./NotificationRulesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

function chooseSelectOption(triggerLabel: string, optionMatch: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionMatch }));
}

function rule(overrides: Partial<NotificationRuleDTO> = {}): NotificationRuleDTO {
  return {
    id: "rule-1",
    name: "فاتورة مبيعات مؤكدة",
    eventCode: "SALES_INVOICE_CONFIRMED",
    condition: null,
    recipientType: "permission",
    recipientValue: "sales.invoice.view",
    priority: "normal",
    channels: ["in_app"],
    titleAr: null,
    bodyAr: null,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_HANDLERS = {
  "GET /roles": () => ({ body: [] }),
  "GET /users": () => ({ body: [] }),
};

describe("NotificationRulesPage", () => {
  it("renders the real rules list from GET /notification-rules", async () => {
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({ ...BASE_HANDLERS, "GET /notification-rules": () => ({ body: [rule()] }) }),
    });
    expect(await screen.findByText("فاتورة مبيعات مؤكدة")).toBeInTheDocument();
    expect(screen.getByText("تم تأكيد فاتورة مبيعات")).toBeInTheDocument();
    expect(screen.getAllByText("داخل التطبيق").length).toBeGreaterThan(0);
  });

  it("shows the real empty state when there are no rules", async () => {
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({ ...BASE_HANDLERS, "GET /notification-rules": () => ({ body: [] }) }),
    });
    expect(await screen.findByText("لا توجد قواعد إشعارات")).toBeInTheDocument();
  });

  it("creates a new rule through POST /notification-rules and refreshes the list", async () => {
    const user = userEvent.setup();
    let created: NotificationRuleDTO | null = null;
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...BASE_HANDLERS,
        "GET /notification-rules": () => ({ body: created ? [rule(), created] : [rule()] }),
        "POST /notification-rules": (init) => {
          const body = JSON.parse(String(init?.body));
          created = rule({
            id: "rule-2",
            name: body.name,
            eventCode: body.eventCode,
            recipientType: body.recipientType,
            recipientValue: body.recipientValue,
            priority: body.priority,
            channels: body.channels,
          });
          return { status: 201, body: created };
        },
      }),
    });

    await screen.findByText("فاتورة مبيعات مؤكدة");
    await user.click(screen.getByRole("button", { name: "إضافة قاعدة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة قاعدة" });
    await user.type(textboxByLabel(dialog, "اسم القاعدة *"), "نقص مخزون حرج");
    chooseSelectOption("الحدث *", /LOW_STOCK_DETECTED/);
    chooseSelectOption("قيمة المستلم *", /sales\.invoice\.view$/);
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "إضافة قاعدة" })).not.toBeInTheDocument());
    expect(await screen.findByText("نقص مخزون حرج")).toBeInTheDocument();
  });

  it("toggles a rule active/inactive through POST /notification-rules/:id/deactivate", async () => {
    const user = userEvent.setup();
    let active = true;
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...BASE_HANDLERS,
        "GET /notification-rules": () => ({ body: [rule({ active })] }),
        "POST /notification-rules/rule-1/deactivate": () => {
          active = false;
          return { body: rule({ active: false }) };
        },
      }),
    });

    expect(await screen.findByRole("button", { name: "نشط" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "نشط" }));
    expect(await screen.findByRole("button", { name: "غير نشط" })).toBeInTheDocument();
  });

  it("deletes a rule through DELETE /notification-rules/:id after the confirm dialog is accepted", async () => {
    const user = userEvent.setup();
    let deleted: string | null = null;
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...BASE_HANDLERS,
        "GET /notification-rules": () => ({ body: deleted ? [] : [rule()] }),
        "DELETE /notification-rules/rule-1": () => {
          deleted = "rule-1";
          return { status: 204, body: null };
        },
      }),
    });

    await screen.findByText("فاتورة مبيعات مؤكدة");
    await user.click(screen.getByRole("button", { name: "حذف" }));

    const confirmDialog = screen.getByRole("dialog", { name: "حذف قاعدة التنبيه؟" });
    expect(within(confirmDialog).getByText("لن يصل أي تنبيه بعد الآن عن «فاتورة مبيعات مؤكدة».")).toBeInTheDocument();
    await user.click(within(confirmDialog).getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(deleted).toBe("rule-1"));
    expect(await screen.findByText("لا توجد قواعد إشعارات")).toBeInTheDocument();
  });

  it("the status chips filter the list, and activating an inactive rule POSTs to its own .../activate path — the mirror of the deactivate path", async () => {
    const user = userEvent.setup();
    let active = false;
    const rules = () => [rule({ id: "rule-1", name: "قاعدة نشطة", active: true }), rule({ id: "rule-2", name: "قاعدة غير نشطة", active })];
    let seenPath = "";
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...BASE_HANDLERS,
        "GET /notification-rules": () => ({ body: rules() }),
        "POST /notification-rules/rule-2/activate": (_init, path) => {
          seenPath = path;
          active = true;
          return { body: rule({ id: "rule-2", active: true }) };
        },
      }),
    });

    await screen.findByText("قاعدة نشطة");
    expect(screen.getByText("قاعدة غير نشطة")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^نشط\b/ }));
    await waitFor(() => expect(screen.queryByText("قاعدة غير نشطة")).not.toBeInTheDocument());
    expect(screen.getByText("قاعدة نشطة")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^الكل/ }));
    await screen.findByText("قاعدة غير نشطة");
    await user.click(screen.getByRole("button", { name: "غير نشط" }));
    expect(seenPath).toBe("/notification-rules/rule-2/activate");
    // Both rules read «نشط» once this one flips, so the assertion has to be
    // scoped to ITS row — a bare getByRole would be ambiguous, and a
    // getAllByRole would pass even if the wrong row had changed.
    const row = screen.getByText("قاعدة غير نشطة").closest("tr") as HTMLElement;
    expect(await within(row).findByRole("button", { name: "نشط" })).toBeInTheDocument();
    // The other row was already active and must be untouched.
    const otherRow = screen.getByText("قاعدة نشطة").closest("tr") as HTMLElement;
    expect(within(otherRow).getByRole("button", { name: "نشط" })).toBeInTheDocument();
  });

  it("a failed status toggle leaves the row showing its ORIGINAL status, not stuck on the state the click implied", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...BASE_HANDLERS,
        "GET /notification-rules": () => ({ body: [rule({ active: true })] }),
        "POST /notification-rules/rule-1/deactivate": () => ({ status: 500, body: { message: "تعذر تعديل حالة القاعدة" } }),
      }),
    });

    await screen.findByRole("button", { name: "نشط" });
    await user.click(screen.getByRole("button", { name: "نشط" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "نشط" })).not.toBeDisabled());
    expect(screen.queryByRole("button", { name: "غير نشط" })).not.toBeInTheDocument();
  });

  it("cancelling the panel does not create a rule, and LIMITATION (D134): the draft survives the cancel", async () => {
    const user = userEvent.setup();
    let createCalls = 0;
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...BASE_HANDLERS,
        "GET /notification-rules": () => ({ body: [rule()] }),
        "POST /notification-rules": () => {
          createCalls += 1;
          return { status: 201, body: rule({ id: "rule-2" }) };
        },
      }),
    });

    await screen.findByText("فاتورة مبيعات مؤكدة");
    await user.click(screen.getByRole("button", { name: "إضافة قاعدة" }));
    let dialog = screen.getByRole("dialog", { name: "إضافة قاعدة" });
    await user.type(textboxByLabel(dialog, "اسم القاعدة *"), "قاعدة لن تُحفظ");
    await user.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("dialog", { name: "إضافة قاعدة" })).not.toBeInTheDocument();
    expect(createCalls).toBe(0);

    await user.click(screen.getByRole("button", { name: "إضافة قاعدة" }));
    dialog = screen.getByRole("dialog", { name: "إضافة قاعدة" });
    // D134. `resetForm()` runs only after a SUCCESSFUL create — not on
    // «إلغاء», and not on the panel's own close control — so reopening the
    // panel puts the person back inside the draft they just abandoned, with
    // «حفظ» live. The next thing they save is the rule they meant to throw
    // away. It should be "" here; it is not.
    expect(textboxByLabel(dialog, "اسم القاعدة *")).toHaveValue("قاعدة لن تُحفظ");

    await user.clear(textboxByLabel(dialog, "اسم القاعدة *"));
    await user.type(textboxByLabel(dialog, "اسم القاعدة *"), "قاعدة أخرى لن تُحفظ");
    await user.click(within(dialog).getByRole("button", { name: "إغلاق اللوحة" }));
    expect(screen.queryByRole("dialog", { name: "إضافة قاعدة" })).not.toBeInTheDocument();
    // Whatever the draft does, neither exit may ever CREATE the rule. That is
    // the half that matters, and it holds.
    expect(createCalls).toBe(0);
  });

  it("sends every edited field — recipient type/value, priority, channels, title/body, and a condition — as the exact create payload", async () => {
    const user = userEvent.setup();
    let seenBody: Record<string, unknown> | null = null;
    renderWithProviders(<NotificationRulesPage />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /roles": () => ({ body: [{ id: "role-9", code: "ACC", name: "محاسب", description: "", permissions: [], isSystem: false, createdAt: "2026-01-01T00:00:00.000Z" }] }),
        "GET /users": () => ({ body: [] }),
        "GET /notification-rules": () => ({ body: [rule()] }),
        "POST /notification-rules": (init) => {
          seenBody = JSON.parse(String(init?.body));
          return { status: 201, body: rule({ id: "rule-9" }) };
        },
      }),
    });

    await screen.findByText("فاتورة مبيعات مؤكدة");
    await user.click(screen.getByRole("button", { name: "إضافة قاعدة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة قاعدة" });

    await user.type(textboxByLabel(dialog, "اسم القاعدة *"), "تنبيه مخزون منخفض");
    chooseSelectOption("نوع المستلم *", "دور محدد");
    chooseSelectOption("قيمة المستلم *", "محاسب");
    chooseSelectOption("الأولوية *", "عالية");
    await user.click(within(dialog).getByRole("button", { name: "بريد إلكتروني" }));
    await user.type(textboxByLabel(dialog, "عنوان مخصص (عربي)"), "مخزون منخفض");
    await user.type(textboxByLabel(dialog, "نص الإشعار (عربي)"), "الكمية أقل من الحد الأدنى");
    await user.click(within(dialog).getByRole("switch", { name: "إضافة شرط" }));
    await user.type(textboxByLabel(dialog, "حقل الشرط"), "quantity");
    chooseSelectOption("العامل", "أصغر من");
    await user.type(textboxByLabel(dialog, "قيمة الشرط"), "10");

    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));
    await waitFor(() => expect(seenBody).not.toBeNull());

    expect(seenBody).toMatchObject({
      name: "تنبيه مخزون منخفض",
      recipientType: "role",
      recipientValue: "role-9",
      priority: "high",
      titleAr: "مخزون منخفض",
      bodyAr: "الكمية أقل من الحد الأدنى",
      condition: { field: "quantity", operator: "lt", value: "10" },
    });
    expect((seenBody as { channels: string[] }).channels).toEqual(expect.arrayContaining(["in_app", "email"]));
  });
});
