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
});
