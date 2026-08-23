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

    fireEvent.click(screen.getByRole("button", { name: "دليل الحسابات" }));
    expect(screen.queryByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "لوحة التحكم" }));
    expect(screen.getByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
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
});
