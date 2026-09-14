// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "../../App";
import { AppProviders } from "../../data/AppProviders";
import { persistSession } from "../../data/session";
import { stubTransport, testAdminSession } from "../../data/test-support";
import type { Transport } from "../../data/transport";
import { navGroupSpecs } from "../../nav-config";
import { routePathForScreen } from "../../routing";

/**
 * D91 — the four exception reports were served, mounted and complete on the
 * server, and referenced NOWHERE in the client. These tests drive the address
 * a user reaches them at, not the props: the route resolves, the screen calls
 * the real endpoint, and what the server said reaches the DOM.
 */

const exceptionsBody = {
  id: "security.exceptions",
  titleAr: "تقرير الاستثناءات الأمنية",
  params: { from: "2026-08-01", to: "2026-09-01", actor: null, action: null, severity: null },
  columns: [
    { key: "actor", labelAr: "المستخدم" },
    { key: "actionLabelAr", labelAr: "الحدث" },
    { key: "count", labelAr: "العدد", format: "qty" },
  ],
  rows: [
    {
      actor: "USER-CLERK",
      action: "ESCALATION_DENIED",
      actionLabelAr: "محاولة توسيع صلاحيات",
      module: "admin",
      count: 4,
      critical: 4,
      error: 0,
      warning: 0,
      info: 0,
      firstAt: "2026-08-03T09:00:00.000Z",
      lastAt: "2026-08-20T18:00:00.000Z",
    },
  ],
  groups: [],
  grandTotals: { count: 4, critical: 4 },
  watchlist: [{ action: "LOGIN_FAILED", labelAr: "محاولات دخول فاشلة", count: 7, actorCount: 2, lastAt: "2026-08-20T18:00:00.000Z" }],
  kpis: [{ key: "escalationDenied", labelAr: "محاولات توسيع صلاحيات مرفوضة", value: 4, tone: "danger" }],
  recent: [],
  coverage: { matched: 4, scanned: 4, truncated: false, scanLimit: 5000 },
  gaps: [{ key: "device", labelAr: "الجهاز/المصدر", detailAr: "لا يوجد سجل لجهاز محدد." }],
};

const postPostingBody = {
  id: "security.post_posting_changes",
  titleAr: "تقرير التعديلات بعد الترحيل",
  params: { from: "2026-08-01", to: "2026-09-01", actor: null, entityType: null, changeType: null },
  columns: [
    { key: "actor", labelAr: "المستخدم" },
    { key: "changeTypeLabelAr", labelAr: "نوع التعديل" },
    { key: "docNo", labelAr: "رقم المستند" },
    { key: "reason", labelAr: "السبب" },
  ],
  rows: [
    {
      rowKey: "2026-08-11T10:00:00.000Z|USER-CLERK|VOID|SalesInvoice|INV-9",
      timestamp: "2026-08-11T10:00:00.000Z",
      actor: "USER-CLERK",
      module: "sales",
      entityType: "SalesInvoice",
      entityId: "INV-9",
      docNo: "INV-000009",
      action: "VOID",
      changeType: "VOID",
      changeTypeLabelAr: "إلغاء",
      severity: "WARNING",
      branchId: null,
      reversalId: null,
      reason: null,
    },
  ],
  groups: [],
  grandTotals: { count: 1, withoutReason: 1 },
  kpis: [{ key: "voids", labelAr: "إلغاءات", value: 1, tone: "warning" }],
  coverage: { matched: 1, scanned: 1, truncated: false, scanLimit: 5000 },
  gaps: [],
};

const afterHoursBody = {
  id: "security.after_hours",
  titleAr: "نشاط خارج أوقات العمل",
  params: { from: "2026-08-01", to: "2026-09-01", actor: null, stream: null, severity: null },
  workingHours: {
    timezone: "Africa/Cairo",
    timezoneResolved: true,
    startHour: 8,
    endHour: 16,
    standardDailyWorkHours: 8,
    weekendDays: [5, 6],
    weekStartDay: 6,
    startHourSource: "default",
    weekendSource: "settings",
  },
  columns: [
    { key: "localDate", labelAr: "التاريخ", format: "date" },
    { key: "localTime", labelAr: "الوقت" },
    { key: "outsideReasonLabelAr", labelAr: "سبب الاستثناء" },
    { key: "actor", labelAr: "المستخدم" },
  ],
  rows: [
    {
      rowKey: "2026-08-14T23:10:00.000Z|USER-CLERK|CONFIRM",
      timestamp: "2026-08-14T23:10:00.000Z",
      localDate: "2026-08-15",
      localTime: "01:10",
      weekday: 6,
      weekdayLabelAr: "السبت",
      outsideReason: "WEEKEND",
      outsideReasonLabelAr: "يوم عطلة",
      actor: "USER-CLERK",
      stream: "sensitive",
      module: "sales",
      entityType: "SalesInvoice",
      entityId: "INV-12",
      action: "CONFIRM",
      severity: "WARNING",
      branchId: null,
    },
  ],
  groups: [],
  grandTotals: { count: 1, weekend: 1, critical: 0 },
  kpis: [{ key: "weekend", labelAr: "في أيام العطلة", value: 1, tone: "danger" }],
  coverage: { matched: 1, scanned: 1, truncated: false, scanLimit: 5000 },
  gaps: [],
};

const newAccountsBody = {
  id: "security.new_accounts",
  titleAr: "حسابات أُنشئت حديثاً",
  params: { days: 90, since: "2026-06-09", createdBy: null },
  columns: [
    { key: "nameAr", labelAr: "الاسم" },
    { key: "createdBy", labelAr: "أنشأه" },
    { key: "status", labelAr: "الحالة" },
    { key: "postedDocumentCount", labelAr: "مستندات رحّلها", format: "qty" },
  ],
  rows: [
    {
      userId: "USER-NEW",
      nameAr: "سامي فؤاد",
      email: "sami@cyag.example",
      status: "active",
      isCompanyAdmin: true,
      roleId: null,
      createdAt: "2026-08-02T08:00:00.000Z",
      lastLoginAt: null,
      createdBy: null,
      createdByEventAt: null,
      postedDocumentCount: 3,
      voidedDocumentCount: 0,
      credentialResetCount: 1,
      firstActivityAt: null,
      lastActivityAt: null,
    },
  ],
  groups: [],
  grandTotals: { count: 1, postedDocumentCount: 3, voidedDocumentCount: 0 },
  kpis: [{ key: "admins", labelAr: "بصلاحية مسؤول منشأة", value: 1, tone: "danger" }],
  coverage: { matched: 1, scanned: 1, truncated: false, scanLimit: 5000 },
  gaps: [],
};

const emptySummary = {
  generatedAt: "2026-08-22T00:00:00.000Z",
  counts: { accounts: 0, customers: 0, suppliers: 0, items: 0, users: 1, journalEntries: 0 },
  gl: { revenue: "0.00", expenses: "0.00", netProfit: "0.00", cash: "0.00", receivables: "0.00", payables: "0.00", inventoryValue: "0.00" },
  recentActivity: [],
};

function transport(capture: { paths: string[] } = { paths: [] }): Transport {
  return stubTransport({
    "POST /auth/login": () => ({ body: testAdminSession }),
    "GET /dashboard/summary": () => ({ body: emptySummary }),
    "GET /security-reports/exceptions": (_init, path) => {
      capture.paths.push(path);
      return { body: exceptionsBody };
    },
    "GET /security-reports/post-posting-changes": (_init, path) => {
      capture.paths.push(path);
      return { body: postPostingBody };
    },
    "GET /security-reports/after-hours": (_init, path) => {
      capture.paths.push(path);
      return { body: afterHoursBody };
    },
    "GET /security-reports/new-accounts": (_init, path) => {
      capture.paths.push(path);
      return { body: newAccountsBody };
    },
  });
}

function renderAt(path: string, capture?: { paths: string[] }) {
  persistSession(testAdminSession);
  return render(
    <AppProviders transport={transport(capture)}>
      <App initialEntries={[path]} />
    </AppProviders>,
  );
}

describe("D91 — the four exception reports are reachable screens", () => {
  afterEach(() => {
    persistSession(null);
    localStorage.clear();
  });

  it("lists all four in the navigation tree, under الإعداد", () => {
    const setup = navGroupSpecs.find((group) => group.key === "setup");
    const keys = [...(setup?.itemKeys ?? []), ...(setup?.sections ?? []).flatMap((s) => s.itemKeys)];
    expect(keys).toContain("security-exceptions");
    expect(keys).toContain("security-post-posting-changes");
    expect(keys).toContain("security-after-hours");
    expect(keys).toContain("security-new-accounts");
  });

  it("gives each one a real address that survives a reload", () => {
    expect(routePathForScreen("security-exceptions")).toBe("setup/security-exceptions");
    expect(routePathForScreen("security-post-posting-changes")).toBe("setup/security-post-posting-changes");
    expect(routePathForScreen("security-after-hours")).toBe("setup/security-after-hours");
    expect(routePathForScreen("security-new-accounts")).toBe("setup/security-new-accounts");
  });

  it("تقرير الاستثناءات الأمنية loads from /security-reports/exceptions and shows the actor, the KPI, the watch list and the gaps", async () => {
    const capture = { paths: [] as string[] };
    renderAt("/setup/security-exceptions", capture);

    expect(await screen.findByRole("heading", { name: "تقرير الاستثناءات الأمنية" })).toBeInTheDocument();
    await waitFor(() => expect(capture.paths.some((p) => p.startsWith("/security-reports/exceptions"))).toBe(true));
    await waitFor(() => expect(screen.getByText("USER-CLERK")).toBeInTheDocument());
    expect(screen.getByText("محاولة توسيع صلاحيات")).toBeInTheDocument();
    expect(screen.getByText("محاولات دخول فاشلة")).toBeInTheDocument();
    expect(screen.getByText("الجهاز/المصدر")).toBeInTheDocument();
  });

  it("تقرير التعديلات بعد الترحيل loads its own endpoint and says out loud that no reason was recorded", async () => {
    const capture = { paths: [] as string[] };
    renderAt("/setup/security-post-posting-changes", capture);

    expect(await screen.findByRole("heading", { name: "تقرير التعديلات بعد الترحيل" })).toBeInTheDocument();
    await waitFor(() => expect(capture.paths.some((p) => p.startsWith("/security-reports/post-posting-changes"))).toBe(true));
    await waitFor(() => expect(screen.getByText("INV-000009")).toBeInTheDocument());
    expect(screen.getByText("بدون سبب مسجَّل")).toBeInTheDocument();
  });

  it("نشاط خارج أوقات العمل warns that the working day it measured against was assumed, not configured", async () => {
    const capture = { paths: [] as string[] };
    renderAt("/setup/security-after-hours", capture);

    expect(await screen.findByRole("heading", { name: "نشاط خارج أوقات العمل" })).toBeInTheDocument();
    await waitFor(() => expect(capture.paths.some((p) => p.startsWith("/security-reports/after-hours"))).toBe(true));
    await waitFor(() => expect(screen.getByText(/يوم العمل هنا مفترَض/)).toBeInTheDocument());
    expect(screen.getByText("يوم عطلة")).toBeInTheDocument();
  });

  it("حسابات أُنشئت حديثاً flags a new account that carries company-admin rights", async () => {
    const capture = { paths: [] as string[] };
    renderAt("/setup/security-new-accounts", capture);

    expect(await screen.findByRole("heading", { name: "حسابات أُنشئت حديثاً" })).toBeInTheDocument();
    await waitFor(() => expect(capture.paths.some((p) => p.startsWith("/security-reports/new-accounts"))).toBe(true));
    await waitFor(() => expect(screen.getByText("سامي فؤاد")).toBeInTheDocument());
    expect(screen.getByText("مسؤول منشأة")).toBeInTheDocument();
    expect(screen.getByText("بدون منشئ مسجَّل")).toBeInTheDocument();
  });
});
