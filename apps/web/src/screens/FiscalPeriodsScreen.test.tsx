// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { FiscalPeriodDTO, FiscalPeriodStatusDTO } from "@mezan/contracts";
import { FiscalPeriodsScreen } from "./FiscalPeriodsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const MONTH_LABEL_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function prevMonth(month: number): number {
  return month === 1 ? 12 : month - 1;
}

const now = new Date();
const CURRENT_YEAR = now.getUTCFullYear();
const CURRENT_MONTH = now.getUTCMonth() + 1;
const CLOSED_MONTH = prevMonth(CURRENT_MONTH);
const LOCKED_MONTH = prevMonth(CLOSED_MONTH);

function statusFor(month: number): FiscalPeriodStatusDTO {
  if (month === CURRENT_MONTH) return "open";
  if (month === CLOSED_MONTH) return "closed";
  if (month === LOCKED_MONTH) return "locked";
  return "open";
}

function periodsForYear(year: number): FiscalPeriodDTO[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const endDay = lastDayOfMonth(year, month);
    return {
      id: `fp-${year}-${pad2(month)}`,
      year,
      periodNumber: month,
      startDate: `${year}-${pad2(month)}-01`,
      endDate: `${year}-${pad2(month)}-${pad2(endDay)}`,
      status: year === CURRENT_YEAR ? statusFor(month) : "open",
    };
  });
}

function renderScreen(periods: FiscalPeriodDTO[] = periodsForYear(CURRENT_YEAR)) {
  let current = [...periods];
  const transport = stubTransport({
    "GET /fiscal-periods": () => ({ body: current }),
    "POST /fiscal-periods/generate-year": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const generated = periodsForYear(body.year).map((p) => ({ ...p, status: "open" as const }));
      current = [...current, ...generated];
      return { status: 201, body: generated };
    },
    ...Object.fromEntries(
      current.flatMap((p) => [
        [`POST /fiscal-periods/${p.id}/close`, () => {
          const target = current.find((x) => x.id === p.id)!;
          const updated = { ...target, status: "closed" as const };
          current = current.map((x) => (x.id === p.id ? updated : x));
          return { body: updated };
        }],
        [`POST /fiscal-periods/${p.id}/reopen`, () => {
          const target = current.find((x) => x.id === p.id)!;
          const updated = { ...target, status: "open" as const };
          current = current.map((x) => (x.id === p.id ? updated : x));
          return { body: updated };
        }],
        [`POST /fiscal-periods/${p.id}/lock`, () => {
          const target = current.find((x) => x.id === p.id)!;
          const updated = { ...target, status: "locked" as const };
          current = current.map((x) => (x.id === p.id ? updated : x));
          return { body: updated };
        }],
      ]),
    ),
  });
  return renderWithProviders(<FiscalPeriodsScreen />, { transport, initialSession: testAdminSession });
}

describe("FiscalPeriodsScreen", () => {
  it("renders the period grid from the real backend with a mix of open/closed/locked states", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الفترات المالية" })).toBeInTheDocument();
    expect(await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`)).toBeInTheDocument();
    // Both the banner label and the row's status pill say "الفترة الحالية" for the current period.
    expect(screen.getAllByText("الفترة الحالية").length).toBeGreaterThanOrEqual(2);
  });

  it("filters the grid by status via the chip row", async () => {
    renderScreen();
    await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`);
    fireEvent.click(screen.getByRole("button", { name: /^مقفلة/ }));
    expect(screen.getByText(`${MONTH_LABEL_AR[LOCKED_MONTH - 1]} ${CURRENT_YEAR}`)).toBeInTheDocument();
    expect(screen.queryByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`)).not.toBeInTheDocument();
  });

  it("closes an open period", async () => {
    renderScreen();
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "إغلاق" }));
    expect(await within(row as HTMLElement).findByText("مغلقة")).toBeInTheDocument();
  });

  it("locks a closed period", async () => {
    renderScreen();
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "قفل" }));
    expect(await within(row as HTMLElement).findByText("مقفلة")).toBeInTheDocument();
  });

  it("reopens a closed period", async () => {
    renderScreen();
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "إعادة فتح" }));
    expect(await within(row as HTMLElement).findByText("مفتوحة")).toBeInTheDocument();
  });

  it("generates the next fiscal year's 12 periods and switches to it", async () => {
    renderScreen();
    await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`);
    const nextYear = CURRENT_YEAR + 1;
    fireEvent.click(screen.getByRole("button", { name: "إنشاء السنة التالية" }));
    expect(await screen.findByRole("option", { name: String(nextYear) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "السنة المالية" })).toHaveValue(String(nextYear));
    expect(await screen.findByText(`يناير ${nextYear}`)).toBeInTheDocument();
  });
});
