// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ActivityDTO } from "@mezan/contracts";
import { ActivitiesScreen } from "./ActivitiesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleActivities: ActivityDTO[] = [
  {
    id: "act-1",
    subject: "متابعة عرض السعر",
    type: "call",
    relatedLeadId: null,
    relatedOpportunityId: null,
    dueDate: "2026-08-25",
    status: "pending",
    notes: null,
    createdAt: "2026-08-20T00:00:00.000Z",
  },
  {
    id: "act-2",
    subject: "اجتماع توقيع العقد",
    type: "meeting",
    relatedLeadId: null,
    relatedOpportunityId: null,
    dueDate: null,
    status: "completed",
    notes: null,
    createdAt: "2026-08-18T00:00:00.000Z",
  },
];

function renderScreen(activities: ActivityDTO[] = sampleActivities) {
  let current = [...activities];
  const transport = stubTransport({
    "GET /crm/activities": () => ({ body: current }),
    "POST /crm/activities": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: ActivityDTO = {
        id: body.id,
        subject: body.subject,
        type: body.type ?? "call",
        relatedLeadId: null,
        relatedOpportunityId: null,
        dueDate: body.dueDate ?? null,
        status: "pending",
        notes: body.notes ?? null,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /crm/activities/act-1/complete": () => {
      const updated: ActivityDTO = { ...current[0]!, status: "completed" };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
    "POST /crm/activities/act-1/cancel": () => {
      const updated: ActivityDTO = { ...current[0]!, status: "cancelled" };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<ActivitiesScreen />, { transport, initialSession: testAdminSession });
}

describe("ActivitiesScreen", () => {
  it("lists activities from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الأنشطة" })).toBeInTheDocument();
    expect(await screen.findByText("متابعة عرض السعر")).toBeInTheDocument();
    expect(screen.getByText("اجتماع توقيع العقد")).toBeInTheDocument();
  });

  it("shows an empty state when there are no activities yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد أنشطة")).toBeInTheDocument();
  });

  it("filters the list by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("متابعة عرض السعر");
    fireEvent.click(screen.getByRole("tab", { name: /مكتمل/ }));
    expect(screen.getByText("اجتماع توقيع العقد")).toBeInTheDocument();
    expect(screen.queryByText("متابعة عرض السعر")).not.toBeInTheDocument();
  });

  it("adds a new activity through the side panel", async () => {
    renderScreen();
    await screen.findByText("متابعة عرض السعر");
    fireEvent.click(screen.getByRole("button", { name: "نشاط جديد" }));

    const dialog = screen.getByRole("dialog", { name: "نشاط جديد" });
    fireEvent.change(within(dialog).getByLabelText("الموضوع *"), { target: { value: "مهمة تجريبية" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("مهمة تجريبية")).toBeInTheDocument();
  });

  it("completes a pending activity via the row action", async () => {
    renderScreen();
    await screen.findByText("متابعة عرض السعر");
    fireEvent.click(screen.getByRole("button", { name: "إكمال" }));

    await screen.findByText("متابعة عرض السعر");
    expect(screen.getAllByText("مكتمل").length).toBeGreaterThan(0);
  });
});
