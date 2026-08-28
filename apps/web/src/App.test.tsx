// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DashboardSummaryDTO } from "@mezan/contracts";
import { App } from "./App";
import { AppProviders } from "./data/AppProviders";
import { persistSession } from "./data/session";
import { renderWithProviders, stubTransport, testAdminSession } from "./data/test-support";

const emptySummary: DashboardSummaryDTO = {
  generatedAt: "2026-08-22T00:00:00.000Z",
  counts: { accounts: 30, customers: 0, suppliers: 0, items: 0, users: 1, journalEntries: 0 },
  gl: {
    revenue: "0.00",
    expenses: "0.00",
    netProfit: "0.00",
    cash: "0.00",
    receivables: "0.00",
    payables: "0.00",
    inventoryValue: "0.00",
  },
  recentActivity: [],
};

function appTransport() {
  return stubTransport({
    "POST /auth/login": () => ({ body: testAdminSession }),
    "GET /dashboard/summary": () => ({ body: emptySummary }),
  });
}

function login() {
  "1234".split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
  fireEvent.click(screen.getByRole("button", { name: "دخول" }));
}

describe("App", () => {
  afterEach(() => {
    persistSession(null);
    // The shell routes on the hash, and jsdom keeps one location per file —
    // without this a test that navigates leaves the next one on its screen.
    window.location.hash = "";
  });

  it("shows the login screen first, and لوحة التحكم is the landing screen after a real sign-in", async () => {
    renderWithProviders(<App />, { transport: appTransport() });
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();

    login();

    expect(await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "لوحة التحكم" })).toHaveAttribute("aria-current", "page");
    // The shell surfaces the real tenant name from the session (server-resolved from settings).
    expect(screen.getByText("Cyag")).toBeInTheDocument();
  });

  it("routes to another screen and back to لوحة التحكم via the sidebar top item", async () => {
    renderWithProviders(<App />, { transport: appTransport() });
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    fireEvent.click(screen.getByRole("button", { name: "المحاسبة" }));
    fireEvent.click(screen.getByRole("button", { name: "دليل الحسابات" }));
    // Navigation goes through the hash, and jsdom delivers `hashchange` on a
    // later tick — a synchronous assertion here reads the previous screen.
    expect(await screen.findByRole("heading", { name: "دليل الحسابات" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).not.toBeInTheDocument();

    // The breadcrumb offers لوحة التحكم too once you are off it; the rail's
    // top item is the first in document order.
    fireEvent.click(screen.getAllByRole("button", { name: "لوحة التحكم" })[0]!);
    expect(await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
  });

  it("reaches the first-run wizard from the login screen and can cancel back to it", () => {
    renderWithProviders(<App />, { transport: appTransport() });
    fireEvent.click(screen.getByRole("button", { name: "أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي" }));
    expect(screen.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
  });

  it("stays signed in when a persisted session is restored on load", async () => {
    persistSession(testAdminSession);
    render(
      <AppProviders transport={appTransport()}>
        <App />
      </AppProviders>,
    );

    expect(await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "تسجيل الدخول" })).not.toBeInTheDocument();
  });

  it("routes to the real الموافقات inbox, with a pending-count badge on its nav item", async () => {
    const transport = stubTransport({
      "POST /auth/login": () => ({ body: testAdminSession }),
      "GET /dashboard/summary": () => ({ body: emptySummary }),
      "GET /workflow/requests/pending-count": () => ({ body: { count: 2 } }),
      "GET /workflow/requests/pending": () => ({ body: [] }),
    });
    renderWithProviders(<App />, { transport });
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    const navButton = await screen.findByRole("button", { name: /الموافقات/ });
    expect(await screen.findByText("2")).toBeInTheDocument();

    fireEvent.click(navButton);
    expect(await screen.findByRole("heading", { name: "الموافقات" })).toBeInTheDocument();
  });

  it("routes to a report that lives in a section, from row two's own dropdown", async () => {
    renderWithProviders(<App />, { transport: appTransport() });
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    // A section is a MENU on row two, not a row in the column: التقارير carries
    // every one of its screens in sections and none directly, so a bar that
    // listed only direct items would drop the whole shelf.
    fireEvent.click(screen.getByRole("button", { name: "التقارير" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "المبيعات حسب الفترة" }));
    expect(await screen.findByRole("heading", { name: "المبيعات حسب الفترة" })).toBeInTheDocument();
  });

  it("routes to إعدادات الموافقات from the sidebar — the only way in now that the gear is gone", async () => {
    const transport = stubTransport({
      "POST /auth/login": () => ({ body: testAdminSession }),
      "GET /dashboard/summary": () => ({ body: emptySummary }),
      "GET /workflow/configs": () => ({ body: [] }),
    });
    renderWithProviders(<App />, { transport });
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    // The header gear is gone: الإعدادات is a workspace on the rail and nowhere
    // else, so this is now the only route to a settings screen. إعدادات
    // الموافقات hangs off a section rather than the group itself, so the
    // workspace opens first and the section's dropdown carries the screen.
    fireEvent.click(screen.getByRole("button", { name: "الإعداد والصلاحيات" }));
    fireEvent.click(await screen.findByRole("button", { name: "سير العمل" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "إعدادات الموافقات" }));
    expect(await screen.findByRole("heading", { name: "إعدادات الموافقات" })).toBeInTheDocument();
  });
});
