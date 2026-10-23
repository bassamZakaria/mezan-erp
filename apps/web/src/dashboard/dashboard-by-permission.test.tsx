// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { DASHBOARD_REQUESTS, DashboardRequest, MODULE_CATALOG, mayAskDashboard, resolvePermissions } from "@mezan/domain";
import type { EntitlementsDTO } from "@mezan/contracts";
import { DashboardScreen } from "./DashboardScreen";
import { AccountingHubScreen } from "../screens/hubs/AccountingHubScreen";
import { TreasuryHubScreen } from "../screens/hubs/TreasuryHubScreen";
import { renderWithProviders, testAdminSession, TestNavigation } from "../data/test-support";
import type { Session } from "../data/session";
import type { Transport, TransportResponse } from "../data/transport";

const EVERY_MODULE: EntitlementsDTO = { plan: "DEMO", activeModules: [...MODULE_CATALOG], features: {}, seats: 50, expiresAt: null };

const ANY_SESSION_PATHS: ReadonlySet<string> = new Set(["/entitlements", "/dashboard/version", "/preferences"]);

const BODIES: Record<DashboardRequest, unknown> = {
  [DashboardRequest.Summary]: {
    generatedAt: "2026-08-22T00:00:00.000Z",
    counts: { accounts: 30, customers: 2, suppliers: 1, items: 4, users: 3, journalEntries: 5 },
    gl: { revenue: "86240.00", expenses: "61930.00", netProfit: "24310.00", cash: "338.00", receivables: "2782.30", payables: "110.00", inventoryValue: "604950.90" },
    recentActivity: [],
  },
  [DashboardRequest.Cockpit]: null,
  [DashboardRequest.IncomeStatement]: { rows: [], totals: {} },
  [DashboardRequest.VatReturn]: { rows: [], totals: {} },
  [DashboardRequest.CustomerAging]: { rows: [], grandTotals: { current: "10.000000", d31to60: "0", d61to90: "0", d91to120: "0", over120: "0" } },
  [DashboardRequest.SupplierAging]: { rows: [], grandTotals: { current: "20.000000", d31to60: "0", d61to90: "0", d91to120: "0", over120: "0" } },
  [DashboardRequest.StockLevels]: { totalValue: "0", needsAttentionCount: 0, lowCount: 0, attention: [], firstLow: null },
  [DashboardRequest.TopProducts]: { rows: [] },
  [DashboardRequest.SalesInvoices]: [],
  [DashboardRequest.ContractingExceptions]: { total: 0 },
  [DashboardRequest.TreasuryBalances]: { count: 2, active: 2, inactive: 0, openingTotal: "0", openingCash: "0", openingBank: "0", liveTotal: "1500.000000", liveCash: "1200.000000", liveBank: "300.000000" },
  [DashboardRequest.VoucherCounts]: { all: 4, draft: 3, confirmed: 1, pending: 0 },
  [DashboardRequest.LeaveRequestCounts]: { total: 5, pending: 2, approved: 3, rejected: 0, cancelled: 0 },
  [DashboardRequest.MyLeave]: { employeeId: "EMP-1", requests: [] },
};

const TILE_OF: Partial<Record<DashboardRequest, string>> = {
  [DashboardRequest.Summary]: "إجمالي الإيرادات",
  [DashboardRequest.IncomeStatement]: "توزيع المصروفات",
  [DashboardRequest.VatReturn]: "ضريبة القيمة المضافة المستحقة",
  [DashboardRequest.CustomerAging]: "أعمار الأرصدة",
  [DashboardRequest.SupplierAging]: "أعمار الأرصدة",
  [DashboardRequest.StockLevels]: "أصناف عند حد إعادة الطلب",
  [DashboardRequest.TopProducts]: "الأصناف الأعلى مبيعاً",
  [DashboardRequest.SalesInvoices]: "فواتير مبيعات متأخرة",
  [DashboardRequest.TreasuryBalances]: "نقدية الخزائن",
  [DashboardRequest.VoucherCounts]: "سندات مسودة",
  [DashboardRequest.LeaveRequestCounts]: "طلبات إجازة بانتظار القرار",
  [DashboardRequest.MyLeave]: "طلبات إجازتي المعلّقة",
};

const ERROR_CARD = "تعذّر تحميل بيانات لوحة التحكم.";
const NOTHING_TO_SHOW = "لا توجد على لوحتك بيانات ضمن صلاحياتك الحالية.";

const REQUEST_BY_PATH = new Map(Object.values(DashboardRequest).map((request) => [DASHBOARD_REQUESTS[request].path, request]));

function sessionHolding(permissions: readonly string[]): Session {
  return { ...testAdminSession, userId: "USER-ROLE", isCompanyAdmin: false, permissions: [...permissions] };
}

function recordingTransport(session: Session, entitlements: EntitlementsDTO): { transport: Transport; asked: string[]; refused: string[] } {
  const asked: string[] = [];
  const refused: string[] = [];
  const held = session.permissions.includes("*") ? null : resolvePermissions(session.permissions);
  const holds = (permission: string) => held === null || held.has(permission);
  const transport: Transport = (path) => {
    const bare = path.split("?")[0] ?? path;
    asked.push(bare);
    const request = REQUEST_BY_PATH.get(bare);
    let status = 404;
    let body: unknown = { error: "NOT_FOUND" };
    if (bare === "/entitlements") [status, body] = [200, entitlements];
    else if (bare === "/dashboard/version") [status, body] = [200, { bookVersion: "1" }];
    else if (request !== undefined) {
      if (mayAskDashboard(request, holds, entitlements)) [status, body] = [200, BODIES[request]];
      else {
        refused.push(bare);
        [status, body] = [403, { error: "PERMISSION_DENIED" }];
      }
    }
    const response: TransportResponse = { status, ok: status >= 200 && status < 400, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) };
    return Promise.resolve(response);
  };
  return { transport, asked, refused };
}

async function openDashboard(session: Session, entitlements: EntitlementsDTO = EVERY_MODULE) {
  const recorded = recordingTransport(session, entitlements);
  renderWithProviders(
    <TestNavigation>
      <DashboardScreen />
    </TestNavigation>,
    { transport: recorded.transport, initialSession: session },
  );
  await waitFor(() => expect(recorded.asked).toContain("/entitlements"));
  await screen.findByRole("heading", { level: 1 });
  return recorded;
}

const withTiles = Object.values(DashboardRequest).filter((request) => TILE_OF[request] !== undefined);

describe("the dashboard asks only for what the session may read", () => {
  it.each(withTiles)("a session holding only what «%s» needs is served its tile, is refused nothing, and sees no error", async (request) => {
    const gate = DASHBOARD_REQUESTS[request];
    const session = sessionHolding(["dashboard.view", ...gate.allOf, ...(gate.anyOf?.slice(0, 1) ?? [])]);
    const recorded = await openDashboard(session);

    expect(await screen.findAllByText(TILE_OF[request]!)).not.toHaveLength(0);
    await waitFor(() => expect(recorded.asked).toContain(gate.path));
    expect(recorded.refused).toEqual([]);
    expect(recorded.asked.filter((path) => !REQUEST_BY_PATH.has(path) && !ANY_SESSION_PATHS.has(path))).toEqual([]);
    expect(screen.queryByText(ERROR_CARD)).not.toBeInTheDocument();
    expect(screen.queryByText(NOTHING_TO_SHOW)).not.toBeInTheDocument();
  });

  it("a session that may read nothing the dashboard shows is asked for nothing and told so calmly", async () => {
    const recorded = await openDashboard(sessionHolding(["dashboard.view"]));

    expect(await screen.findByText(NOTHING_TO_SHOW)).toBeInTheDocument();
    expect(recorded.asked.filter((path) => REQUEST_BY_PATH.has(path))).toEqual([]);
    expect(screen.queryByText(ERROR_CARD)).not.toBeInTheDocument();
    expect(screen.queryByText("إجمالي الإيرادات")).not.toBeInTheDocument();
  });

  it("the cashier's desk shows the drawers and the drafts waiting, with no accounting figure beside them", async () => {
    const recorded = await openDashboard(sessionHolding(["dashboard.view", "treasury.account.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create"]));

    expect(await screen.findByText("1,200.00")).toBeInTheDocument();
    expect(screen.getByText("300.00")).toBeInTheDocument();
    expect(await screen.findByText("سندات مسودة")).toBeInTheDocument();
    expect(recorded.refused).toEqual([]);
    expect(screen.queryByText("إجمالي الإيرادات")).not.toBeInTheDocument();
    expect(screen.queryByText("بيانات النظام")).not.toBeInTheDocument();
  });

  it("a plan without the treasury module withholds the cashier's treasury requests", async () => {
    const plan: EntitlementsDTO = { ...EVERY_MODULE, activeModules: MODULE_CATALOG.filter((id) => id !== "treasury") };
    const recorded = await openDashboard(sessionHolding(["dashboard.view", "treasury.account.view", "treasury.cash_voucher.view"]), plan);

    expect(await screen.findByText(NOTHING_TO_SHOW)).toBeInTheDocument();
    expect(recorded.asked.filter((path) => REQUEST_BY_PATH.has(path))).toEqual([]);
  });

  it("a role holding every dashboard read is refused nothing, and is sent every request with a tile", async () => {
    const everything = withTiles.flatMap((request) => [...DASHBOARD_REQUESTS[request].allOf, ...(DASHBOARD_REQUESTS[request].anyOf ?? [])]);
    const recorded = await openDashboard(sessionHolding(["dashboard.view", ...everything]));

    expect((await screen.findAllByText("86,240.00")).length).toBeGreaterThan(0);
    const expected = withTiles.filter((request) => request !== DashboardRequest.TreasuryBalances).map((request) => DASHBOARD_REQUESTS[request].path);
    await waitFor(() => expect([...new Set(recorded.asked.filter((path) => REQUEST_BY_PATH.has(path)))].sort()).toEqual([...expected].sort()));
    expect(recorded.refused).toEqual([]);
  });
});

describe("the hubs that borrow the dashboard's summary", () => {
  it.each([
    ["the treasury hub", TreasuryHubScreen, ["treasury.account.view", "treasury.cash_voucher.view"]],
    ["the accounting hub", AccountingHubScreen, ["accounting.coa.view"]],
  ] as const)("%s does not ask for it on behalf of a session that may not read it", async (_name, Hub, reads) => {
    const session = sessionHolding(["dashboard.view", ...reads]);
    const recorded = recordingTransport(session, EVERY_MODULE);
    renderWithProviders(
      <TestNavigation>
        <Hub />
      </TestNavigation>,
      { transport: recorded.transport, initialSession: session },
    );

    await waitFor(() => expect(recorded.asked).toContain("/entitlements"));
    await waitFor(() => expect(recorded.asked.length).toBeGreaterThan(1));
    expect(recorded.asked).not.toContain(DASHBOARD_REQUESTS[DashboardRequest.Summary].path);
    expect(recorded.refused).toEqual([]);
  });

  it("the accounting hub still asks for it for a session that may", async () => {
    const session = sessionHolding(["dashboard.view", "accounting.journal.view"]);
    const recorded = recordingTransport(session, EVERY_MODULE);
    renderWithProviders(
      <TestNavigation>
        <AccountingHubScreen />
      </TestNavigation>,
      { transport: recorded.transport, initialSession: session },
    );

    await waitFor(() => expect(recorded.asked).toContain(DASHBOARD_REQUESTS[DashboardRequest.Summary].path));
  });
});
