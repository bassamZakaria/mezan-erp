// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { HolidayDTO } from "@mezan/contracts";
import { HolidaysScreen } from "./HolidaysScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const currentYear = new Date().getUTCFullYear();

const sampleHolidays: HolidayDTO[] = [
  { id: "h1", date: `${currentYear}-10-06`, nameEn: "National Day", nameAr: "اليوم الوطني", recurringAnnual: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

function renderScreen(holidays: HolidayDTO[] = sampleHolidays) {
  let current = [...holidays];
  const transport = stubTransport({
    [`GET /hr/holidays`]: () => ({ body: current }),
    "POST /hr/holidays": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: HolidayDTO = {
        id: "h-new",
        date: body.date,
        nameEn: body.nameEn,
        nameAr: body.nameAr ?? null,
        recurringAnnual: body.recurringAnnual ?? false,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "DELETE /hr/holidays/h1": () => {
      current = current.filter((h) => h.id !== "h1");
      return { body: { ok: true } };
    },
  });
  return renderWithProviders(<HolidaysScreen />, { transport, initialSession: testAdminSession });
}

describe("HolidaysScreen", () => {
  it("lists holidays for the current year", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الإجازات الرسمية" })).toBeInTheDocument();
    expect(await screen.findByText("اليوم الوطني")).toBeInTheDocument();
    expect(screen.getAllByText("سنوية").length).toBeGreaterThan(0);
  });

  it("adds a new holiday", async () => {
    renderScreen();
    await screen.findByText("اليوم الوطني");
    fireEvent.click(screen.getByRole("button", { name: "إضافة إجازة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة إجازة" });
    fireEvent.change(within(dialog).getByLabelText("التاريخ *"), { target: { value: `${currentYear}-01-07` } });
    fireEvent.change(within(dialog).getByLabelText("الاسم بالإنجليزية *"), { target: { value: "Coptic Christmas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("Coptic Christmas")).toBeInTheDocument();
  });

  it("deletes a holiday", async () => {
    renderScreen();
    await screen.findByText("اليوم الوطني");
    fireEvent.click(screen.getByRole("button", { name: "حذف اليوم الوطني" }));

    expect(await screen.findByText("لا توجد إجازات رسمية لهذا العام")).toBeInTheDocument();
  });
});
