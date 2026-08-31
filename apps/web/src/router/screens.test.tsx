// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor} from "@testing-library/react";
import { App } from "../App";
import { AppProviders } from "../data/AppProviders";
import { persistSession } from "../data/session";
import { stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";
import { isRoutable, SCREEN_MODULES } from "./screens";

describe("SCREEN_MODULES", () => {
  it("isRoutable recognises every real screen key and rejects an unknown one", () => {
    expect(isRoutable("dashboard")).toBe(true);
    expect(isRoutable("sales-invoices")).toBe(true);
    expect(isRoutable("this-screen-does-not-exist")).toBe(false);
  });

  it("EVERY route in the map resolves to a real screen component — the router never renders a blank match", async () => {
    const keys = Object.keys(SCREEN_MODULES) as (keyof typeof SCREEN_MODULES)[];
    expect(keys.length).toBeGreaterThan(50);
    const failures: string[] = [];
    for (const key of keys) {
      try {
        const mod = await SCREEN_MODULES[key]();
        if (typeof mod.Component !== "function") failures.push(`${key}: Component is not a function`);
      } catch (err) {
        failures.push(`${key}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 30_000);
});

const emptySummary = {
  generatedAt: "2026-08-22T00:00:00.000Z",
  counts: { accounts: 0, customers: 0, suppliers: 0, items: 0, users: 1, journalEntries: 0 },
  gl: { revenue: "0.00", expenses: "0.00", netProfit: "0.00", cash: "0.00", receivables: "0.00", payables: "0.00", inventoryValue: "0.00" },
  recentActivity: [],
};

function appTransport(): Transport {
  return stubTransport({
    "POST /auth/login": () => ({ body: testAdminSession }),
    "GET /dashboard/summary": () => ({ body: emptySummary }),
  });
}

/**
 * A light real-router integration pass, proving screens.ts + routes.tsx +
 * loader.ts + RouteErrorBoundary work together end to end (neither routes.tsx
 * nor App.tsx are individually on this task's file list, so this is the only
 * place that mechanism gets exercised as a whole). Kept to a couple of cases —
 * unit coverage above already proves every route resolves in isolation.
 */
describe("real router integration (App + routes.tsx)", () => {
  afterEach(() => {
    persistSession(null);
    localStorage.clear();
  });

  it("an unknown path renders the not-found boundary — Arabic text, not a blank page or a stack trace", async () => {
    persistSession(testAdminSession);
    render(
      <AppProviders transport={appTransport()}>
        <App initialEntries={["/this/path/does/not/exist"]} />
      </AppProviders>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("الصفحة غير موجودة")).toBeInTheDocument();
  });

  it("a route parameter reaches its screen — /sell/customers/CUST-1 matches the customers splat route and renders the real screen, not the not-found boundary", async () => {
    const transport = stubTransport({
      "POST /auth/login": () => ({ body: testAdminSession }),
      "GET /dashboard/summary": () => ({ body: emptySummary }),
      "GET /customers": () => ({ body: [{ id: "CUST-1", code: "C001", nameAr: "شركة الأمل للتجارة", active: true }] }),
    });
    persistSession(testAdminSession);
    render(
      <AppProviders transport={transport}>
        <App initialEntries={["/sell/customers/CUST-1"]} />
      </AppProviders>,
    );
    // The screen module behind sell/customers/* mounts for the sub-path
    // (the extra "/CUST-1" segment) exactly as it does for the bare list path
    // — its own heading renders rather than the router falling through to the
    // catch-all "*" route.
    expect(await screen.findByRole("heading", { name: "العملاء" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("الصفحة غير موجودة")).not.toBeInTheDocument());
  });

  it("clicking into a known screen from the dashboard actually navigates there (a live route, not just a map entry)", async () => {
    render(
      <AppProviders transport={appTransport()}>
        <App initialEntries={["/"]} />
      </AppProviders>,
    );
    "123456".split("").forEach((digit, index) => {
      fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
    });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await screen.findByRole("heading", { name: /مرحباً/ });

    fireEvent.click(screen.getByRole("button", { name: "المالية والإقفال" }));
    fireEvent.click(screen.getByRole("button", { name: "دليل الحسابات" }));
    expect(await screen.findByRole("heading", { name: "دليل الحسابات" })).toBeInTheDocument();
  });
});
