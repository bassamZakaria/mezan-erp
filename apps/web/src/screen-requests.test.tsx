// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MODULE_CATALOG, SCREEN_REQUESTS, ScreenRequest } from "@mezan/domain";
import { AppProviders } from "./data/AppProviders";
import {
  useAccounts,
  useAssets,
  useAttendance,
  useBoms,
  useCheques,
  useConfigurableProducts,
  useContracts,
  useCostCenters,
  useDepartments,
  useExchangeRates,
  useFiscalPeriods,
  useGoodsReceipts,
  useLeaveBalances,
  useLeaveRequests,
  usePriceLists,
  useProductTemplates,
  usePurchaseOrders,
  useSalesQuotes,
  useSuppliers,
  useTreasuryAccounts,
  useVouchers,
  useYearEndClosePreview,
} from "./data/hooks";
import { useWorksContracts } from "./data/contracting-contracts-hooks";
import { useFinancialReport } from "./data/financial-reports-hooks";
import { useEmployeeAdvances, usePayrollComponents, usePayrollStatutoryFlag } from "./data/hr-payroll-hooks";
import { useSupplierAging } from "./data/partner-detail-hooks";
import { useSupplierAging as useDashboardSupplierAging } from "./dashboard/dashboard-hooks";
import { persistSession, sessionHolds, type Session } from "./data/session";
import { testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";

const EVERY_MODULE: readonly string[] = MODULE_CATALOG;
const PREVIEWED_YEAR = 2026;
const SCREEN_PATHS = Object.values(SCREEN_REQUESTS).map((gate) => gate.path);
const EVERY_SCREEN_PERMISSION = [...new Set(Object.values(SCREEN_REQUESTS).map((gate) => gate.permission))];

function recordingTransport(activeModules: readonly string[]): { transport: Transport; asked: string[] } {
  const asked: string[] = [];
  const transport: Transport = (path) => {
    const bare = path.split("?")[0] ?? path;
    asked.push(bare);
    const body = bare === "/entitlements" ? { plan: "pro", activeModules, features: {}, seats: 10, expiresAt: null } : bare.startsWith("/reports") ? { columns: [], rows: [], totals: {} } : [];
    return Promise.resolve({ status: 200, ok: true, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)), headers: new Headers() } as Awaited<ReturnType<Transport>>);
  };
  return { transport, asked };
}

function InvoicePageReads() {
  useAccounts();
  useTreasuryAccounts();
  useVouchers({ type: "customer_collection", status: "confirmed" });
  useSupplierAging();
  useDashboardSupplierAging();
  useSuppliers();
  usePurchaseOrders();
  useGoodsReceipts();
  usePriceLists();
  useCostCenters();
  useFiscalPeriods();
  useExchangeRates();
  useProductTemplates();
  useConfigurableProducts();
  useBoms();
  useDepartments();
  useContracts();
  useEmployeeAdvances();
  usePayrollStatutoryFlag();
  usePayrollComponents();
  useCheques();
  useSalesQuotes();
  useAssets();
  useWorksContracts();
  useFinancialReport("trial-balance", "/trial-balance", {});
  useAttendance({});
  useLeaveBalances(null, PREVIEWED_YEAR);
  useLeaveRequests({ employeeId: null, status: null, leaveType: null, from: null, to: null });
  useYearEndClosePreview(PREVIEWED_YEAR);
  return <div data-testid="page" />;
}

function renderPage(session: Session, activeModules: readonly string[] = EVERY_MODULE) {
  const recorded = recordingTransport(activeModules);
  render(
    <AppProviders transport={recorded.transport} initialSession={session}>
      <MemoryRouter>
        <InvoicePageReads />
      </MemoryRouter>
    </AppProviders>,
  );
  return recorded;
}

const restricted = (permissions: string[]): Session => ({ ...testAdminSession, userId: "USER-RESTRICTED", isCompanyAdmin: false, permissions, roleCode: "RESTRICTED" });
const askedOf = (asked: readonly string[]) => SCREEN_PATHS.filter((path) => asked.includes(path));

describe("a document screen asks for its side lists only where the session may read them", () => {
  afterEach(() => persistSession(null));

  it("a role that may only print its own invoices sends none of them", async () => {
    const { asked } = renderPage(restricted(["sales.invoice.view_own"]));

    await waitFor(() => expect(asked).toContain("/entitlements"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(askedOf(asked)).toEqual([]);
  });

  it.each(Object.values(ScreenRequest))("a session holding only the permission behind «%s» sends it and none it does not hold", async (request) => {
    const session = restricted([SCREEN_REQUESTS[request].permission]);
    const held = Object.values(SCREEN_REQUESTS).filter((gate) => sessionHolds(session, gate.permission)).map((gate) => gate.path);
    const { asked } = renderPage(session);

    await waitFor(() => expect(asked).toContain(SCREEN_REQUESTS[request].path));
    await waitFor(() => expect(askedOf(asked)).toEqual(SCREEN_PATHS.filter((path) => held.includes(path))));

    expect(held.length).toBeLessThan(SCREEN_PATHS.length);
  });

  it("a session holding every permission sends none of the treasury lists when the licence has no treasury module", async () => {
    const { asked } = renderPage(restricted(EVERY_SCREEN_PERMISSION), EVERY_MODULE.filter((module) => module !== "treasury"));

    await waitFor(() => expect(asked).toContain("/accounts"));
    await waitFor(() => expect(asked).toContain("/reports/aging/suppliers"));

    expect(asked).not.toContain("/treasury-accounts");
    expect(asked).not.toContain("/vouchers");
  });

  it("a session that may read a list still asks for it on a plan without its module, so the screen can show the server's refusal", async () => {
    const { asked } = renderPage(restricted(["hr.department.view"]), EVERY_MODULE.filter((module) => module !== "hr"));

    await waitFor(() => expect(asked).toContain("/entitlements"));
    await waitFor(() => expect(asked).toContain(SCREEN_REQUESTS[ScreenRequest.Departments].path));
  });

  it("the administrator still gets every one of them", async () => {
    const { asked } = renderPage(testAdminSession);

    await waitFor(() => expect(askedOf(asked)).toEqual(SCREEN_PATHS));
  });
});
