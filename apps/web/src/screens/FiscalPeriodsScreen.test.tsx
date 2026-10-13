// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { PeriodCloseErrorCodeDTO, type FiscalPeriodDTO, type FiscalPeriodStatusDTO } from "@mezan/contracts";
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderScreen(periods: FiscalPeriodDTO[] = periodsForYear(CURRENT_YEAR), blocked: readonly string[] = []) {
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
          if (blocked.includes(p.id)) return { status: 409, body: BLOCKED_REFUSAL };
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
          if (blocked.includes(p.id)) return { status: 409, body: BLOCKED_REFUSAL };
          const target = current.find((x) => x.id === p.id)!;
          const updated = { ...target, status: "locked" as const };
          current = current.map((x) => (x.id === p.id ? updated : x));
          return { body: updated };
        }],
      ]),
    ),
  });
  return renderWithProviders(
    <>
      <FiscalPeriodsScreen />
      <LocationProbe />
    </>,
    { transport, initialSession: testAdminSession, route: "/money/fiscal-periods" },
  );
}

const BLOCKED_REFUSAL = { error: PeriodCloseErrorCodeDTO.Blocked, message: "لا يمكن إقفال الفترة المحاسبية: فحوص الإقفال غير مكتملة.", failedChecks: ["drafts"] };

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
    fireEvent.click(screen.getByRole("radio", { name: /^مقفلة/ }));
    await waitFor(() => expect(screen.queryByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`)).not.toBeInTheDocument());
    expect(screen.getByText(`${MONTH_LABEL_AR[LOCKED_MONTH - 1]} ${CURRENT_YEAR}`)).toBeInTheDocument();
  });

  it("closes an open period", async () => {
    renderScreen();
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr") as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: `إجراءات ${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}` }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "إغلاق" }));
    expect(await within(row).findByText("مغلقة")).toBeInTheDocument();
  });

  it("locks a closed period", async () => {
    renderScreen();
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr") as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: `إجراءات ${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}` }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "قفل" }));
    expect(await within(row).findByText("مقفلة")).toBeInTheDocument();
  });

  it("reopens a closed period", async () => {
    renderScreen();
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr") as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: `إجراءات ${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}` }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "إعادة فتح" }));
    expect(await within(row).findByText("مفتوحة")).toBeInTheDocument();
  });

  it("shows an error banner with a retry action when periods fail to load", async () => {
    const transport = stubTransport({ "GET /fiscal-periods": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    renderWithProviders(<FiscalPeriodsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل الفترات المالية.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("generates the next fiscal year's 12 periods and switches to it", async () => {
    renderScreen();
    await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`);
    const nextYear = CURRENT_YEAR + 1;
    fireEvent.click(screen.getByRole("button", { name: "إنشاء السنة التالية" }));
    const combobox = await screen.findByRole("combobox", { name: "السنة المالية" });
    expect(combobox).toHaveTextContent(String(nextYear));
    expect(await screen.findByText(`يناير ${nextYear}`)).toBeInTheDocument();

    fireEvent.click(combobox);
    expect(screen.getByRole("option", { name: String(nextYear) })).toHaveAttribute("aria-selected", "true");
  });
  it("a close the pre-close checks refuse sends the user to the close workspace for that month", async () => {
    const currentId = `fp-${CURRENT_YEAR}-${pad2(CURRENT_MONTH)}`;
    renderScreen(periodsForYear(CURRENT_YEAR), [currentId]);
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: `إجراءات ${MONTH_LABEL_AR[CURRENT_MONTH - 1]} ${CURRENT_YEAR}` }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "إغلاق" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/money/period-close?period=${currentId}`));
  });

  it("a lock the pre-close checks refuse goes to the close workspace too", async () => {
    const closedId = `fp-${CURRENT_YEAR}-${pad2(CLOSED_MONTH)}`;
    renderScreen(periodsForYear(CURRENT_YEAR), [closedId]);
    const row = (await screen.findByText(`${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}`)).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: `إجراءات ${MONTH_LABEL_AR[CLOSED_MONTH - 1]} ${CURRENT_YEAR}` }));
    fireEvent.click(within(row).getByRole("menuitem", { name: /قفل/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/money/period-close?period=${closedId}`));
  });
});
