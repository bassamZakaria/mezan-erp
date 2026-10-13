// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DashboardSummaryDTO } from "@mezan/contracts";
import { App } from "./App";
import { AppProviders } from "./data/AppProviders";
import { persistSession } from "./data/session";
import { stubTransport, testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";

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
  fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "admin@cyag.example" } });
  "123456".split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
  fireEvent.click(screen.getByRole("button", { name: "دخول" }));
}

/**
 * Every case renders through the MEMORY router (`initialEntries`), not the
 * browser one. jsdom keeps a single `location` for the whole file, so a
 * pathname router would leave each test on the screen the previous one
 * navigated to — the same isolation problem the old `window.location.hash = ""`
 * cleanup existed to solve, minus the cleanup.
 */
/**
 * `App` builds its own memory/browser router internally (see App.tsx), so it
 * must not be nested inside `renderWithProviders`'s `MemoryRouter` — that
 * throws "You cannot render a <Router> inside another <Router>". Only the
 * data/session providers are needed around it here.
 */
function renderApp(transport: Transport = appTransport()) {
  return render(
    <AppProviders transport={transport}>
      <App initialEntries={["/"]} />
    </AppProviders>,
  );
}

describe("App", () => {
  afterEach(() => {
    persistSession(null);
    // A successful sign-in remembers the device user (see device-users.ts),
    // which would otherwise make the next test's login screen open straight
    // to the "من يعمل الآن؟" face row instead of the plain sign-in heading.
    localStorage.clear();
  });

  it("shows the login screen first, and لوحة التحكم is the landing screen after a real sign-in", async () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();

    login();

    expect(await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "لوحة التحكم" })).toHaveAttribute("aria-current", "page");
    // The rail's footer carries the real signed-in identity from the session
    // (RailFooter renders `user.name`), not a placeholder.
    expect(screen.getByText(testAdminSession.nameAr)).toBeInTheDocument();
  });

  it("routes to another screen and back to لوحة التحكم via the sidebar top item", async () => {
    renderApp();
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    // المحاسبة is now المالية والإقفال. Its "الدليل والتعريفات" shelf used to
    // flatten straight onto row two, because WorkspaceScreensBar flattens a
    // shelf of 4 or fewer; DEC-13 added the simplified-regime screen beside
    // الضرائب, which makes 5, so the shelf is a dropdown again.
    fireEvent.click(screen.getByRole("button", { name: "المالية والإقفال" }));
    fireEvent.click(screen.getByRole("button", { name: "الدليل والتعريفات" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "دليل الحسابات" }));
    // The router resolves the screen's lazy module before it swaps the match,
    // so the assertion has to await it — a synchronous read here still sees
    // the outgoing screen, which is exactly the behaviour that stops the list
    // flashing to a skeleton on every nav click.
    expect(await screen.findByRole("heading", { name: "دليل الحسابات" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).not.toBeInTheDocument();

    // The breadcrumb offers لوحة التحكم too once you are off it; the rail's
    // top item is the first in document order.
    fireEvent.click(screen.getAllByRole("button", { name: "لوحة التحكم" })[0]!);
    expect(await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
  });

  it("reaches the first-run wizard from the login screen and can cancel back to it", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعداد الأولي" }));
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
    renderApp(transport);
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    const navButton = await screen.findByRole("button", { name: /الموافقات/ });
    expect(await screen.findByText("2")).toBeInTheDocument();

    fireEvent.click(navButton);
    expect(await screen.findByRole("heading", { name: "الموافقات" })).toBeInTheDocument();
  });

  it("routes to a report that lives in a section, from row two's own dropdown", async () => {
    renderApp();
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    // Reports are no longer one shared workspace: each workspace (البيع
    // والتحصيل here) carries its own التقارير shelf as a menu on row two —
    // always a dropdown regardless of size (WorkspaceScreensBar's
    // `ALWAYS_A_MENU`) — so a bar that listed only direct items would drop
    // the whole shelf.
    fireEvent.click(screen.getByRole("button", { name: "البيع والتحصيل" }));
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
    renderApp(transport);
    login();
    await screen.findByRole("heading", { name: "مرحباً، محمد · طاب يومك" });

    // The header gear is gone: الإعدادات is a workspace on the rail and nowhere
    // else, so this is now the only route to a settings screen. إعدادات
    // الموافقات hangs off الصلاحيات (5 items, so it stays a dropdown rather
    // than flattening — WorkspaceScreensBar's `isFlattenable`), so the
    // workspace opens first and the section's dropdown carries the screen.
    fireEvent.click(screen.getByRole("button", { name: "الإعداد والصلاحيات" }));
    fireEvent.click(await screen.findByRole("button", { name: "الصلاحيات" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "إعدادات الموافقات" }));
    expect(await screen.findByRole("heading", { name: "إعدادات الموافقات" })).toBeInTheDocument();
  });
});
