// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { CollectionFollowUpDTO, CustomerDTO } from "@mezan/contracts";
import { InstallmentFollowUpsScreen } from "./InstallmentFollowUpsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null,
    taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true,
    priceListId: null, creditLimit: "0", taxExempt: false, etaBuyerType: "business", nationalId: null,
  },
];

function followUp(overrides: Partial<CollectionFollowUpDTO> = {}): CollectionFollowUpDTO {
  return {
    id: "fu-1",
    customerId: "cust-1",
    installmentPlanId: null,
    type: "CALL",
    followUpDate: "2026-08-20",
    assignedTo: null,
    notes: "تذكير بالدفعة القادمة",
    status: "pending",
    outcome: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

function baseHandlers(followUps: CollectionFollowUpDTO[]) {
  return {
    "GET /customers": () => ({ body: customers }),
    "GET /installments/follow-ups": () => ({ body: followUps }),
  };
}

describe("InstallmentFollowUpsScreen", () => {
  it("shows the empty state when there are no follow-ups", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<InstallmentFollowUpsScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "متابعة التحصيل" })).toBeInTheDocument();
    expect(await screen.findByText("لم يتم إنشاء أي متابعات بعد")).toBeInTheDocument();
  });

  it("lists follow-ups from the real API", async () => {
    const transport = stubTransport(baseHandlers([followUp()]));
    renderWithProviders(<InstallmentFollowUpsScreen />, { transport, initialSession: testAdminSession });
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(within(table).getByText("اتصال")).toBeInTheDocument();
  });

  it("creates a new follow-up for a customer", async () => {
    let current: CollectionFollowUpDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /installments/follow-ups": () => ({ body: current }),
      "POST /installments/follow-ups": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = followUp({ id: body.id, customerId: body.customerId, type: body.type, followUpDate: body.followUpDate, notes: body.notes });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<InstallmentFollowUpsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("لم يتم إنشاء أي متابعات بعد");
    fireEvent.click(screen.getByRole("button", { name: "متابعة جديدة" }));
    const dialog = await screen.findByRole("dialog", { name: "متابعة جديدة" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  // Completing/cancelling closes the detail panel back to the list (matching the
  // screen's own `setPanel("none")` after the mutation), so the outcome is asserted
  // against the updated list row, not the (now-closed) dialog.
  it("completes a pending follow-up and reflects it in the list", async () => {
    let current: CollectionFollowUpDTO[] = [followUp()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /installments/follow-ups": () => ({ body: current }),
      "POST /installments/follow-ups/fu-1/complete": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        current = current.map((f) => (f.id === "fu-1" ? { ...f, status: "completed" as const, outcome: body.outcome } : f));
        return { body: current[0] };
      },
    });
    renderWithProviders(<InstallmentFollowUpsScreen />, { transport, initialSession: testAdminSession });
    const table = await screen.findByRole("table");
    fireEvent.click(await within(table).findByText("شركة الأمل للتجارة"));
    const dialog = screen.getByRole("dialog", { name: "شركة الأمل للتجارة" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إكمال المتابعة" }));
    expect(await within(table).findByText("مكتمل")).toBeInTheDocument();
  });

  it("cancels a pending follow-up and reflects it in the list", async () => {
    let current: CollectionFollowUpDTO[] = [followUp()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /installments/follow-ups": () => ({ body: current }),
      "POST /installments/follow-ups/fu-1/cancel": () => {
        current = current.map((f) => (f.id === "fu-1" ? { ...f, status: "cancelled" as const } : f));
        return { body: current[0] };
      },
    });
    renderWithProviders(<InstallmentFollowUpsScreen />, { transport, initialSession: testAdminSession });
    const table = await screen.findByRole("table");
    fireEvent.click(await within(table).findByText("شركة الأمل للتجارة"));
    const dialog = screen.getByRole("dialog", { name: "شركة الأمل للتجارة" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(await within(table).findByText("ملغي")).toBeInTheDocument();
  });
});
